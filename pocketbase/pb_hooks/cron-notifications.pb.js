/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7.

/**
 * Cron notifications — cron quotidien 00h UTC.
 *
 * Phase 1 — Calcul et insertion des events J-X (rappels, missings, confirmation).
 *   Parcourt les occurrences dans la fenêtre à venir (today → today+20 jours) et
 *   insère dans `notification_events` les faits notifiables liés au timing.
 *
 * Phase 2 — Envoi agrégé.
 *   Consomme les events non traités, calcule les destinataires au runtime selon
 *   la matrice brainstorm § 3 + prefs individuelles, construit 1 email agrégé
 *   par (user, master) et envoie via SMTP. Push 1 par event J-X pour les users
 *   qui ont activé `push`. Circuit breaker SMTP après 3 échecs consécutifs.
 *
 * La fusion des deux phases dans un seul cron garantit l'ordre séquentiel
 * (insertion → envoi) sans scheduling parallèle, et produit un seul log
 * zerolog final.
 *
 * `notifications-purge` : cron hebdomadaire lundi 00h30 UTC, supprime les
 * rows `notification_events` traitées de plus de 60 jours.
 *
 * Tous les helpers nécessaires sont importés via `require()` au début du
 * handler : les fonctions top-level d'un `.pb.js` ne sont PAS visibles depuis
	 * les callbacks JSVM (scope isolé — voir skill pocketbase-jsvm § "Fonctions locales inaccessibles").
 */

cronAdd('notifications-daily', '0 0 * * *', () => {
	const { detectJxEvents } = require(`${__hooks}/notification-jx-detector.js`);
	const { computeRecipients } = require(`${__hooks}/notification-recipients.js`);
	const cronUtils = require(`${__hooks}/notification-cron-utils.js`);
	const { sendIndividualEmail, sendPushNotification } = require(`${__hooks}/notify-utils.cjs`);
	const { buildSubject, buildHtmlEmail, buildTextEmail } = require(
		`${__hooks}/notify-templates.js`
	);
	const { dispatchPushForEvent } = require(`${__hooks}/push-dispatch.js`);

	const {
		MAX_SMTP_FAILURES,
		publicBaseUrl,
		JX_EVENT_TYPES,
		nowIsoCompat,
		parseJsonArray,
		buildEventPayload,
		resolveUserTaskNames,
		buildPushTitle,
		buildPushBody
	} = cronUtils;

	// ========================================================================
	// PHASE 1 — Insertion des events J-X
	// ========================================================================

	// Fenêtre 20 jours : couvre tous les J-X possibles (max 15 pour missings).
	// Les filtres `findRecordsByFilter` n'acceptent PAS `datetime()` (fonction SQL
	// brute) — il faut calculer les bornes en JS et les binder via placeholders.
	// Les macros `@` (@todayStart, @now) existent mais ne supportent pas l'arithmétique
	// additive native ; on privilégie des bornes explicites YYYY-MM-DD (UTC minuit).
	const windowStart = new Date();
	windowStart.setUTCHours(0, 0, 0, 0);
	const windowEnd = new Date(windowStart.getTime());
	windowEnd.setUTCDate(windowEnd.getUTCDate() + 20);
	const startDate = windowStart.toISOString().split('T')[0];
	const endDate = windowEnd.toISOString().split('T')[0];

	const occs = $app.findRecordsByFilter(
		'planning_occurrences',
		'date >= {:start} && date <= {:end} && deleted = false && isCanceled = false',
		'date',
		0,
		0,
		{ start: startDate, end: endDate }
	);

	const masterCtxCache = new Map();
	const getMasterContext = (masterId) => {
		let ctx = masterCtxCache.get(masterId);
		if (ctx !== undefined) return ctx;
		let master;
		try {
			master = $app.findRecordById('planning_masters', masterId);
		} catch {
			master = null;
		}
		if (!master || master.getBool('deleted')) {
			ctx = null;
		} else {
			const participants = $app.findRecordsByFilter(
				'planning_participants',
				'planning = {:masterId}',
				'',
				0,
				0,
				{ masterId }
			);
			ctx = { master, participants };
		}
		masterCtxCache.set(masterId, ctx);
		return ctx;
	};

	let scanned = 0;
	let inserted = 0;
	let skippedDuplicate = 0;
	let skippedNoMaster = 0;
	const now = new Date();

	for (const occ of occs) {
		scanned++;
		const masterId = occ.getString('master');
		const ctx = getMasterContext(masterId);
		if (!ctx) {
			skippedNoMaster++;
			continue;
		}

		const descriptors = detectJxEvents(occ, ctx.master, ctx.participants, now);
		if (descriptors.length === 0) continue;

		const occId = occ.get('id');

		for (const d of descriptors) {
			let existing;
			try {
				existing = $app.findFirstRecordByFilter(
					'notification_events',
					'occurrence = {:occ} && type = {:type} && reminderValue = {:value}',
					{ occ: occId, type: d.type, value: d.reminderValue }
				);
			} catch {
				/* not found — on insère */
			}
			if (existing) {
				skippedDuplicate++;
				continue;
			}

			try {
				const collection = $app.findCollectionByNameOrId('notification_events');
				const event = new Record(collection);
				event.set('type', d.type);
				event.set('master', masterId);
				event.set('occurrence', occId);
				event.set('reminderValue', d.reminderValue);
				event.set('changedBy', '');
				event.set('payload', null);
				$app.save(event);
				inserted++;
			} catch (err) {
				$app
					.logger()
					.error(
						'[Notif] Phase 1 — insert failed',
						'cron',
						'notifications-daily',
						'occurrenceId',
						occId,
						'type',
						d.type,
						'err',
						err?.message || String(err)
					);
			}
		}
	}

	// ========================================================================
	// PHASE 2 — Envoi agrégé
	// ========================================================================

	// Sélectionner les events non traités. `attempts` est ignoré (champ DB conservé
	// pour compat, mais la logique de retry est remplacée par le circuit breaker).
	const pendingEvents = $app.findRecordsByFilter(
		'notification_events',
		"processedAt = ''",
		'created',
		0,
		0
	);

	// Cache des occurrences réutilisées entre events du même master/occ.
	const occCache = new Map();
	const getOcc = (occId) => {
		if (occCache.has(occId)) return occCache.get(occId);
		let occ = null;
		try {
			occ = $app.findRecordById('planning_occurrences', occId);
		} catch {
			/* deleted */
		}
		occCache.set(occId, occ);
		return occ;
	};

	// Pré-calcul des items : pour chaque event, on résout {record, eventPlain,
	// master, occ, recipients}. Le payload event-level (missings counts) est
	// enrichi une seule fois par event.
	const processedAt = nowIsoCompat();
	const eventItems = [];
	for (const eventRecord of pendingEvents) {
		const masterId = eventRecord.getString('master');
		const occId = eventRecord.getString('occurrence');
		const type = eventRecord.getString('type');

		const masterCtx = getMasterContext(masterId);
		if (!masterCtx) continue;

		const occ = getOcc(occId);
		if (!occ || occ.getBool('deleted') || occ.getBool('isCanceled')) continue;

		// `new_comment` porte son payload dans la DB (inséré par le hook) ; les
		// autres types le calculent à l'envoi via buildEventPayload (missings).
		let eventPayload;
		if (type === 'new_comment') {
			const raw = eventRecord.getString('payload');
			try {
				eventPayload = raw && raw !== 'null' ? JSON.parse(raw) : null;
			} catch {
				eventPayload = null;
			}
		} else {
			eventPayload = buildEventPayload({ type }, masterCtx.master, occ);
		}

		const eventPlain = {
			type,
			reminderValue: eventRecord.getInt('reminderValue'),
			occurrence: occId,
			master: masterId,
			changedBy: eventRecord.getString('changedBy'),
			payload: eventPayload
		};

		const recipients = computeRecipients(eventPlain, masterCtx.master, masterCtx.participants, occ, eventPlain.changedBy || undefined);

		eventItems.push({
			record: eventRecord,
			event: eventPlain,
			master: masterCtx.master,
			occ,
			recipients,
			participants: masterCtx.participants
		});
	}

	// Buffer (userId|masterId) → { userId, masterId, master, items: [{record, event, occ}] }
	// Une entrée du buffer = 1 email agrégé à envoyer.

	// Filtre "déjà lu" côté email : un destinataire qui a déjà lu le message
	// (commentReadState[occId] ≥ commentCreatedAt) ne le reçoit pas dans l'email
	// agrégé. Le push immédiat (temps réel) reste inchangé — ce filtre ne
	// s'applique qu'au canal email.
	const readStateByMasterUser = new Map();
	const getCommentReadState = (participants, masterId, userId) => {
		const key = `${masterId}|${userId}`;
		if (readStateByMasterUser.has(key)) return readStateByMasterUser.get(key);
		let rs = null;
		for (const pp of participants) {
			if (pp.getString('user') === userId) {
				const raw = pp.getString('commentReadState');
				if (raw && raw !== 'null') {
					try {
						rs = JSON.parse(raw);
					} catch {
						rs = null;
					}
				}
				break;
			}
		}
		readStateByMasterUser.set(key, rs);
		return rs;
	};

	const buffer = new Map();
	for (const item of eventItems) {
		const occTasks = parseJsonArray(item.occ, 'tasks');
		for (const r of item.recipients) {
			// Filtre canal email : r.email vient de computeRecipients (booléen
			// de la row planning_participants).
			if (!r.email) continue;

			// Filtre "déjà lu" par message (uniquement new_comment, uniquement
			// email) : compare le timestamp de lecture de l'occ au timestamp de
			// création du message stocké dans le payload.
			if (item.event.type === 'new_comment') {
				const readState = getCommentReadState(item.participants, item.event.master, r.userId);
				const readAt = readState ? readState[item.event.occurrence] : null;
				if (readAt) {
					const createdAt = item.event.payload && item.event.payload.commentCreatedAt;
					if (
						createdAt &&
						new Date(readAt).getTime() >= new Date(createdAt).getTime()
					) {
						continue;
					}
				}
			}

			const key = `${r.userId}|${item.event.master}`;
			let bucket = buffer.get(key);
			if (!bucket) {
				bucket = {
					userId: r.userId,
					masterId: item.event.master,
					master: item.master,
					items: []
				};
				buffer.set(key, bucket);
			}
			const enrichedEvent = {
				...item.event,
				payload: {
					...(item.event.payload || {}),
					userResponse: r.response,
					userTasks: resolveUserTaskNames(r.tasks, occTasks)
				}
			};
			bucket.items.push({
				record: item.record,
				event: enrichedEvent,
				occ: item.occ
			});
		}
	}

	// Envoi des emails avec circuit breaker SMTP.
	let emailsSent = 0;
	let pushSent = 0;
	let consecutiveSmtpFailures = 0;
	let smtpErrors = 0;
	let bufferSkipped = 0;

	for (const [, bucket] of buffer) {
		if (consecutiveSmtpFailures >= MAX_SMTP_FAILURES) {
			bufferSkipped++;
			continue;
		}

		let user;
		try {
			user = $app.findRecordById('users', bucket.userId);
		} catch {
			// User supprimé entre-temps — abandonner ce bucket silencieusement.
			bufferSkipped++;
			continue;
		}

		// Résolution des noms pour `changedBy` (lookup users).
		const userNamesById = new Map();
		const changedBySet = new Set();
		for (const it of bucket.items) {
			if (it.event.changedBy) changedBySet.add(it.event.changedBy);
		}
		for (const uid of changedBySet) {
			try {
				const u = $app.findRecordById('users', uid);
				userNamesById.set(uid, u.getString('name') || u.getString('email') || 'admin');
			} catch {
				/* changedBy introuvable — le template fallback sur UNKNOWN_AUTHOR */
			}
		}

		// occCache local au bucket : les events ne sont pas tous sur la même occ.
		const localOccCache = new Map();
		for (const it of bucket.items) {
			if (!localOccCache.has(it.event.occurrence)) {
				localOccCache.set(it.event.occurrence, getOcc(it.event.occurrence));
			}
		}

		const ctx = {
			occCache: localOccCache,
			userNamesById,
			master: bucket.master,
			baseUrl: publicBaseUrl()
		};

		const eventsForTemplate = bucket.items.map((it) => it.event);

		let subject;
		let html;
		let text;
		try {
			subject = buildSubject(bucket.master, eventsForTemplate, ctx);
			html = buildHtmlEmail(bucket.master, eventsForTemplate, user, ctx);
			text = buildTextEmail(bucket.master, eventsForTemplate, user, ctx);
		} catch (err) {
			$app
				.logger()
				.error(
					'[Notif] Phase 2 — template rendering failed',
					'cron',
					'notifications-daily',
					'userId',
					bucket.userId,
					'err',
					err?.message || String(err)
				);
			bufferSkipped++;
			continue;
		}

		try {
			sendIndividualEmail($app, user, subject, html, text, {
				headers: {
					'X-Entity-Ref-ID': `notif-${bucket.masterId}-${processedAt.slice(0, 10)}`
				}
			});
			emailsSent++;
			consecutiveSmtpFailures = 0;

			// Tous les events du bucket sont marqués traités (envoi agrégé réussi).
			for (const it of bucket.items) {
				try {
					it.record.set('processedAt', processedAt);
					$app.save(it.record);
				} catch (saveErr) {
					$app
						.logger()
						.error(
							'[Notif] Phase 2 — processedAt save failed',
							'cron',
							'notifications-daily',
							'err',
							saveErr?.message || String(saveErr)
						);
				}
			}
		} catch (err) {
			// sendIndividualEmail rethrow sur SMTP fail — on log et on compte.
			consecutiveSmtpFailures++;
			smtpErrors++;
			$app
				.logger()
				.error(
					'[Notif] Phase 2 — SMTP send failed',
					'cron',
					'notifications-daily',
					'userId',
					bucket.userId,
					'consecutive',
					consecutiveSmtpFailures,
					'err',
					err?.message || String(err)
				);
		}
	}

	if (consecutiveSmtpFailures >= MAX_SMTP_FAILURES) {
		$app
			.logger()
			.error(
				'[Notif] Phase 2 — circuit breaker triggered',
				'cron',
				'notifications-daily',
				'reason',
				`${MAX_SMTP_FAILURES} SMTP failures consécutives — SMTP probablement down`,
				'bucketsSkipped',
				bufferSkipped
			);
	}

	// ========================================================================
	// PUSH J-X — dispatch unifié avec le hook update (push-dispatch.js)
	// ========================================================================
	// Cache user partagé entre events : un même user peut être destinataire
	// de plusieurs events du même cron run.
	const userCache = new Map();
	const getUser = (userId) => {
		if (userCache.has(userId)) return userCache.get(userId);
		let u = null;
		try {
			u = $app.findRecordById('users', userId);
		} catch {
			/* deleted */
		}
		userCache.set(userId, u);
		return u;
	};

	for (const item of eventItems) {
		if (!JX_EVENT_TYPES.has(item.event.type)) continue;

		pushSent += dispatchPushForEvent($app, {
			event: item.event,
			master: item.master,
			occ: item.occ,
			recipients: item.recipients,
			resolveUser: getUser,
			buildPushTitle,
			buildPushBody,
			sendPushNotification
		});
	}

	// ========================================================================
	// Log final unifié
	// ========================================================================

	$app
		.logger()
		.info(
			'[Notif] Cron done',
			'cron',
			'notifications-daily',
			'phase1_scanned',
			scanned,
			'phase1_inserted',
			inserted,
			'phase1_skippedDuplicate',
			skippedDuplicate,
			'phase1_skippedNoMaster',
			skippedNoMaster,
			'phase2_eventsProcessed',
			eventItems.length,
			'phase2_emailsSent',
			emailsSent,
			'phase2_pushSent',
			pushSent,
			'phase2_smtpErrors',
			smtpErrors,
			'phase2_bufferSkipped',
			bufferSkipped,
			'phase2_circuitBreaker',
			consecutiveSmtpFailures >= MAX_SMTP_FAILURES ? 1 : 0
		);
});

cronAdd('notifications-purge', '30 0 * * 1', () => {
	try {
		const where = "processedAt != '' AND processedAt < datetime('now', '-60 days')";

		const counter = new DynamicModel({ total: 0 });
		$app
			.db()
			.newQuery(`SELECT COUNT(*) as total FROM notification_events WHERE ${where}`)
			.one(counter);

		$app.db().newQuery(`DELETE FROM notification_events WHERE ${where}`).execute();

		$app
			.logger()
			.info(
				'[Notif] Purge notification_events',
				'cron',
				'notifications-purge',
				'deleted',
				counter.total || 0
			);
	} catch (err) {
		$app
			.logger()
			.error(
				'[Notif] Purge notification_events failed',
				'cron',
				'notifications-purge',
				'err',
				err?.message || String(err)
			);
	}
});
