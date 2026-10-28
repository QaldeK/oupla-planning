/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7.

/**
 * Cron notifications — cron quotidien 08h UTC (9h à 10h à Paris selon la saison).
 *
 * Phase 1 — Calcul et insertion des events J-X (rappels, missings, confirmation).
 *   Parcourt les occurrences dans la fenêtre à venir (today → today+20 jours) et
 *   insère dans `notification_events` les faits notifiables liés au timing.
 *
 * Phase 2 — Consommation via le registre de livraison `notification_deliveries`
 *   (une ligne par paire event/destinataire, créée au fan-out) :
 *   1. classification + clôture résiduelle (delivery due sur event terminal → waive) ;
 *   2. fan-out (upsert des lignes manquantes, filtré aux destinataires avec au
 *      moins un canal actif) + reaper (waive pour départ durable uniquement) ;
 *   3. vague push J-X, avant et indépendamment de l'email ;
 *   4. buckets email agrégés par (user, master), succès → emailSentAt ;
 *   5. dérivation terminale : event consommé quand toutes ses deliveries ont
 *      les deux canaux réglés — uniquement pour les events passés par le
 *      fan-out de CE run (garde N3 : un event au fan-out sauté ne serait pas
 *      consommé d'emblée) ;
 *   6. clôture à la mort : event mort → bulk-waive de ses deliveries dues.
 *
 *   Contrat de `processedAt` (notification-consumer.js) : état TERMINAL, tenu
 *   en cohérence avec le ledger : tout event vivant sort du run consommé ou
 *   mort ; le seul état pending résiduel est l'attente de retry email (SMTP
 *   down), borné par le garde d'obsolescence.
 *
 * La fusion des deux phases dans un seul cron garantit l'ordre séquentiel
 * (insertion → envoi) sans scheduling parallèle, et produit un seul log
 * zerolog final.
 *
 * `notifications-purge` : cron hebdomadaire lundi 00h30 UTC, supprime en
 * natif (`app.delete()`) les events terminaux de plus de 60 jours — les
 * cascades du schéma emportent leurs deliveries. Un DELETE SQL brut ne
 * cascade pas : les cascades de relation sont appliquées par le runtime sur
 * app.delete(), pas par des FK SQLite.
 *
 * Tous les helpers nécessaires sont importés via `require()` au début du
 * handler : les fonctions top-level d'un `.pb.js` ne sont PAS visibles depuis
	 * les callbacks JSVM (scope isolé — voir skill pocketbase-jsvm § "Fonctions locales inaccessibles").
 */

cronAdd('notifications-daily', '0 8 * * *', () => {
	const { detectJxEvents } = require(`${__hooks}/notification-jx-detector.js`);
	const { computeRecipients } = require(`${__hooks}/notification-recipients.js`);
	const cronUtils = require(`${__hooks}/notification-cron-utils.js`);
	const { sendIndividualEmail, sendPushNotification } = require(`${__hooks}/notify-utils.cjs`);
	const { buildSubject, buildHtmlEmail, buildTextEmail } = require(
		`${__hooks}/notify-templates.js`
	);
	const { dispatchPushForEvent } = require(`${__hooks}/push-dispatch.js`);
	const { insertEvent, createMasterContextResolver, resolveUserName } = require(
		`${__hooks}/notification-events.cjs`
	);
	const { classifyPendingEvent, isDeliverySettled, isDepartureDurable, isEventTerminal } = require(
		`${__hooks}/notification-consumer.js`
	);
	const deliveryStore = require(`${__hooks}/notification-deliveries.cjs`);
	const { UNKNOWN_AUTHOR } = require(`${__hooks}/notification-core.cjs`);

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

	// Résolveur mémoïsé (cache sur l'instance, partagé entre les phases 1 et 2
	// du run) — un master supprimé ou introuvable → null, dans les deux phases.
	const getMasterContext = createMasterContextResolver($app);

	let scanned = 0;
	let inserted = 0;
	let skippedDuplicate = 0;
	let skippedNoMaster = 0;
	let skippedUnreadableCtx = 0;
	const now = new Date();

	for (const occ of occs) {
		scanned++;
		const masterId = occ.getString('master');
		const ctx = getMasterContext(masterId);
		if (!ctx) {
			skippedNoMaster++;
			continue;
		}
		if (ctx.participants === null) {
			// Opt-in inconnus : détecter un J-X sur une liste indéterminée
			// produirait un faux « rien à faire » (cf. atLeastOneParticipantWithDay).
			skippedUnreadableCtx++;
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
				insertEvent($app, {
					type: d.type,
					master: masterId,
					occurrence: occId,
					reminderValue: d.reminderValue,
					changedBy: '',
					payload: null
				});
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
	// PHASE 2 — Consommation via le registre de livraison
	// ========================================================================

	// Sélectionner les events non traités. `attempts` est ignoré (champ DB
	// conservé pour compat, sans aucune logique de retry).
	const pendingEvents = $app.findRecordsByFilter(
		'notification_events',
		"processedAt = ''",
		'created',
		0,
		0
	);
	const pendingIds = new Set(pendingEvents.map((e) => e.get('id')));
	const processedAt = nowIsoCompat();

	// Cache user partagé par tout le run : reaper, vague push, buckets et
	// résolution des noms passent par le même lookup (un même user peut être
	// destinataire de plusieurs events).
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

	// ------------------------------------------------------------------
	// Clôture résiduelle : toute delivery dont un canal est dû alors que
	// son event a quitté l'état pending est waivée. Défend la seconde porte
	// d'écriture de `processedAt` (cleanup `new_comment` du hook
	// occurrence-update, hors cron) et rattrape les saves de clôture échoués.
	// Les events encore pending sont sautés : le flux de CE run les règle.
	// ------------------------------------------------------------------
	let residualWaived = 0;
	try {
		const dueRows = $app.findRecordsByFilter(
			'notification_deliveries',
			"(emailSentAt = '' && emailWaivedAt = '') || (pushSentAt = '' && pushWaivedAt = '')",
			'',
			0,
			0
		);
		const terminalEventCache = new Map();
		for (const row of dueRows) {
			const evId = row.getString('event');
			if (pendingIds.has(evId)) continue;
			let ev = terminalEventCache.get(evId);
			if (ev === undefined) {
				try {
					ev = $app.findRecordById('notification_events', evId);
				} catch {
					// Orpheline structurellement impossible (cascade sur event) :
					// ne pas waiver à l'aveugle, la purge finira par l'emporter.
					ev = null;
				}
				terminalEventCache.set(evId, ev);
			}
			if (!ev || ev.getString('processedAt') === '') continue;
			try {
				deliveryStore.closePending($app, row, processedAt);
				residualWaived++;
			} catch (err) {
				$app
					.logger()
					.error(
						'[Notif] Phase 2 — residual waive failed',
						'cron',
						'notifications-daily',
						'eventId',
						evId,
						'err',
						err?.message || String(err)
					);
			}
		}
	} catch (err) {
		$app
			.logger()
			.error(
				'[Notif] Phase 2 — residual due lookup failed',
				'cron',
				'notifications-daily',
				'err',
				err?.message || String(err)
			);
	}

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

	// Pré-calcul des items : pour chaque event, classification (mort-né /
	// obsolète → marquage direct + clôture du ledger) puis résolution
	// {record, eventPlain, master, occ, recipients}. Le payload event-level
	// (missings counts) est enrichi une seule fois par event.
	const eventItems = [];
	const deadItems = [];
	let phase2Unreadable = 0;
	for (const eventRecord of pendingEvents) {
		const masterId = eventRecord.getString('master');
		const occId = eventRecord.getString('occurrence');
		const type = eventRecord.getString('type');

		const masterCtx = getMasterContext(masterId);
		const occ = getOcc(occId);
		const cls = classifyPendingEvent({ type, occ, masterCtx, now });
		if (cls.kind === 'dead') {
			deadItems.push({ record: eventRecord, reason: cls.reason });
			continue;
		}
		// Destinataires indéterminés (lecture participants échouée, loggée par
		// le resolver) : panne transitoire → retry au prochain cron, borné par
		// le garde d'obsolescence (l'event meurt quand l'occurrence passe).
		if (masterCtx.participants === null) {
			phase2Unreadable++;
			continue;
		}

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
			participants: masterCtx.participants,
			isJx: JX_EVENT_TYPES.has(type)
		});
	}

	// ------------------------------------------------------------------
	// Fan-out : upsert des deliveries (event, user) manquantes, filtré aux
	// destinataires ayant au moins un canal actif (prefs lues à chaud, donc
	// réévaluées chaque run — un muted n'a jamais de ligne). Le fan-out a
	// lieu à la consommation, pas à l'insertion : le jeu de destinataires
	// reste dynamique jusqu'à l'envoi. Les types non-J-X naissent avec
	// pushWaivedAt posé : leur push immédiat est fait par le hook
	// occurrence-update, les re-pousser depuis le cron serait un doublon.
	//
	// Puis reaper au prédicat étroit : une delivery due d'un user parti
	// durablement (hasQuit, userId retiré du master, user supprimé) est
	// waivée — jamais pour une response ou une pref réversible.
	// ------------------------------------------------------------------
	let fanoutCreated = 0;
	let fanoutExisting = 0;
	let reaperWaived = 0;
	// eventId → lignes du registre (fetchées après upsert, réutilisées par la
	// vague push et les buckets).
	const deliveriesByEvent = new Map();
	for (const item of eventItems) {
		const eventId = item.record.get('id');
		item.fanoutFailed = 0;
		for (const r of item.recipients) {
			if (!r.email && !r.push) continue;
			try {
				const { created } = deliveryStore.upsertDelivery(
					$app,
					{ eventId, userId: r.userId, masterId: item.event.master },
					processedAt,
					!item.isJx
				);
				if (created) fanoutCreated++;
				else fanoutExisting++;
			} catch (err) {
				item.fanoutFailed++;
				$app
					.logger()
					.error(
						'[Notif] Phase 2 — fan-out upsert failed',
						'cron',
						'notifications-daily',
						'eventId',
						eventId,
						'userId',
						r.userId,
						'err',
						err?.message || String(err)
					);
			}
		}

		let rows = [];
		try {
			rows = deliveryStore.findByEvent($app, eventId);
		} catch (err) {
			$app
				.logger()
				.error(
					'[Notif] Phase 2 — deliveries lookup failed',
					'cron',
					'notifications-daily',
					'eventId',
					eventId,
					'err',
					err?.message || String(err)
				);
		}
		deliveriesByEvent.set(eventId, rows);

		const masterParticipants = parseJsonArray(item.master, 'participants');
		for (const row of rows) {
			if (isDeliverySettled(deliveryStore.toPlain(row))) continue;
			const userId = row.getString('user');
			const departed =
				isDepartureDurable(masterParticipants, userId) || !getUser(userId);
			if (!departed) continue;
			try {
				deliveryStore.closePending($app, row, processedAt);
				reaperWaived++;
			} catch (err) {
				$app
					.logger()
					.error(
						'[Notif] Phase 2 — reaper waive failed',
						'cron',
						'notifications-daily',
						'eventId',
						eventId,
						'userId',
						userId,
						'err',
						err?.message || String(err)
					);
			}
		}
	}

	// ------------------------------------------------------------------
	// Vague push J-X — avant et indépendamment de la boucle email (un SMTP
	// down ne la retarde pas). Unique par destinataire : seules les lignes
	// dont le canal push est encore dû partent — un destinataire apparu au
	// run 2 sur un event encore vivant reçoit SON push au run 2 (fan-out
	// dynamique), ce n'est pas un doublon.
	// ------------------------------------------------------------------
	let pushMarkedSent = 0;
	let pushMarkedWaived = 0;
	let pushMarkedFailed = 0;
	for (const item of eventItems) {
		if (!item.isJx) continue;
		const rows = deliveriesByEvent.get(item.record.get('id')) || [];
		const recByUser = new Map(item.recipients.map((r) => [r.userId, r]));
		const pendingWave = [];
		for (const row of rows) {
			if (row.getString('pushSentAt') || row.getString('pushWaivedAt')) continue;
			const r = recByUser.get(row.getString('user'));
			if (!r || !r.push || !getUser(r.userId)) {
				// Hors cible de la vague (pref push off, sorti du jeu de
				// destinataires, user disparu) → waive explicite, pas de
				// ligne push dûe qui traîne.
				try {
					if (deliveryStore.settlePush($app, row, processedAt, false)) {
						pushMarkedWaived++;
					}
				} catch (err) {
					$app
						.logger()
						.error(
							'[Notif] Phase 2 — push waive failed',
							'cron',
							'notifications-daily',
							'eventId',
							item.record.get('id'),
							'err',
							err?.message || String(err)
						);
				}
				continue;
			}
			pendingWave.push({ row, r });
		}
		if (pendingWave.length === 0) continue;

		const rowByUser = new Map(pendingWave.map((p) => [p.r.userId, p.row]));
		try {
			dispatchPushForEvent($app, {
				event: item.event,
				master: item.master,
				occ: item.occ,
				recipients: pendingWave.map((p) => p.r),
				resolveUser: getUser,
				buildPushTitle,
				buildPushBody,
				sendPushNotification,
				onResult: (userId, ok, reason) => {
					const row = rowByUser.get(userId);
					if (!row) return;
					try {
						if (deliveryStore.settlePush($app, row, processedAt, ok)) {
							if (ok) pushMarkedSent++;
							else if (reason === 'failed') pushMarkedFailed++;
							else pushMarkedWaived++;
						}
					} catch (err) {
						// Fenêtre résiduelle (symétrique de S6 email) : le push
						// est parti, la marque n'est pas passée — la ligne
						// restera dûe et repartira au prochain run.
						$app
							.logger()
							.error(
								'[Notif] Phase 2 — push mark failed',
								'cron',
								'notifications-daily',
								'eventId',
								item.record.get('id'),
								'userId',
								userId,
								'err',
								err?.message || String(err)
							);
					}
				}
			});
		} catch (err) {
			$app
				.logger()
				.error(
					'[Notif] Phase 2 — push wave failed',
					'cron',
					'notifications-daily',
					'eventId',
					item.record.get('id'),
					'err',
					err?.message || String(err)
				);
		}
	}

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

	// ------------------------------------------------------------------
	// Buckets email : deliveries dont l'email est dû, portées par un
	// destinataire dont la pref live dit email:true et non filtrées « déjà
	// lu ». Opt-out et déjà lu sont waivées d'emblée (le waive ne dépend
	// pas du succès SMTP). Un destinataire sorti du jeu de destinataires
	// pour une raison réversible (response absente…) reste dû — l'event
	// survit jusqu'au garde d'obsolescence, la clôture à la mort règle la
	// ligne.
	// ------------------------------------------------------------------
	let optOutWaived = 0;
	let readWaived = 0;
	// Buffer (userId|masterId) → { userId, masterId, master, items: [{delivery, event, occ}] }
	// Une entrée du buffer = 1 email agrégé à envoyer.
	const buffer = new Map();
	for (const item of eventItems) {
		const occTasks = parseJsonArray(item.occ, 'tasks');
		const recByUser = new Map(item.recipients.map((r) => [r.userId, r]));
		const rows = deliveriesByEvent.get(item.record.get('id')) || [];
		for (const row of rows) {
			if (row.getString('emailSentAt') || row.getString('emailWaivedAt')) continue;
			const r = recByUser.get(row.getString('user'));
			if (!r) continue;

			// Opt-out email : renoncer est le comportement voulu (l'opt-out
			// est par planning) — waive immédiat, l'event n'attend pas.
			if (!r.email) {
				try {
					if (deliveryStore.settleEmail($app, row, processedAt, false)) {
						optOutWaived++;
					}
				} catch (err) {
					$app
						.logger()
						.error(
							'[Notif] Phase 2 — opt-out waive failed',
							'cron',
							'notifications-daily',
							'eventId',
							item.record.get('id'),
							'userId',
							r.userId,
							'err',
							err?.message || String(err)
						);
				}
				continue;
			}

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
						try {
							if (deliveryStore.settleEmail($app, row, processedAt, false)) {
								readWaived++;
							}
						} catch (err) {
							$app
								.logger()
								.error(
									'[Notif] Phase 2 — read waive failed',
									'cron',
									'notifications-daily',
									'eventId',
									item.record.get('id'),
									'userId',
									r.userId,
									'err',
									err?.message || String(err)
								);
						}
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
				delivery: row,
				event: enrichedEvent,
				occ: item.occ
			});
		}
	}

	// Envoi des emails avec circuit breaker SMTP.
	// Le marquage de terminalité des events n'a pas lieu ici : il se dérive
	// du registre après la boucle (un bucket en échec laisse ses lignes
	// dues, donc l'event non terminal → retry au prochain cron).
	let emailsSent = 0;
	let consecutiveSmtpFailures = 0;
	let smtpErrors = 0;
	let bufferSkipped = 0;

	for (const bucket of buffer.values()) {
		if (consecutiveSmtpFailures >= MAX_SMTP_FAILURES) {
			bufferSkipped++;
			continue;
		}

		let user;
		try {
			user = $app.findRecordById('users', bucket.userId);
		} catch {
			// User supprimé entre-temps : waive des lignes du bucket — un
			// compte disparu ne gardera jamais une delivery dûe.
			for (const it of bucket.items) {
				try {
					deliveryStore.settleEmail($app, it.delivery, processedAt, false);
				} catch (err) {
					$app
						.logger()
						.error(
							'[Notif] Phase 2 — deleted-user waive failed',
							'cron',
							'notifications-daily',
							'userId',
							bucket.userId,
							'err',
							err?.message || String(err)
						);
				}
			}
			bufferSkipped++;
			continue;
		}

		// Résolution des noms pour `changedBy` — fallback UNKNOWN_AUTHOR : un
		// user supprimé produit le même label que le template.
		const userNamesById = new Map();
		const changedBySet = new Set();
		for (const it of bucket.items) {
			if (it.event.changedBy) changedBySet.add(it.event.changedBy);
		}
		for (const uid of changedBySet) {
			userNamesById.set(uid, resolveUserName($app, uid, UNKNOWN_AUTHOR));
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
			// Le rendu restera en échec tant que la donnée n'est pas corrigée :
			// le bucket attend le retry, borné par le garde d'obsolescence.
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
			// Marquage après envoi : l'email parti ne repart pas. Fenêtre
			// résiduelle assumée si un save échoue (identique à celle du
			// marquage processedAt) — la clôture résiduelle du run suivant
			// règle la ligne.
			for (const it of bucket.items) {
				try {
					deliveryStore.settleEmail($app, it.delivery, processedAt, true);
				} catch (err) {
					$app
						.logger()
						.error(
							'[Notif] Phase 2 — email mark failed',
							'cron',
							'notifications-daily',
							'userId',
							bucket.userId,
							'err',
							err?.message || String(err)
						);
				}
			}
		} catch (err) {
			// sendIndividualEmail rethrow sur SMTP fail — les lignes du bucket
			// restent dues et l'event non terminal : retry au prochain cron
			// (seule survie pending autorisée).
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
	// Dérivation terminale — un event vivant est consommé quand toutes ses
	// deliveries ont les deux canaux réglés (envoyé ou waivé) ; un espace
	// vide de destinataires est consommé d'emblée. Garde N3 : la terminalité
	// ne se déduit QUE pour les events passés par le fan-out de CE run —
	// jamais d'un simple « 0 deliveries dues », sinon un event au fan-out
	// sauté (participants illisibles) serait consommé à tort ; et pas non
	// plus pour un fan-out en échec (un tableau vide produit par des
	// écritures ratées n'est pas un espace vide de destinataires).
	// ========================================================================
	let markedTerminal = 0;
	let pendingRetry = phase2Unreadable;
	for (const item of eventItems) {
		let rows;
		try {
			rows = deliveryStore.findByEvent($app, item.record.get('id'));
		} catch (err) {
			$app
				.logger()
				.error(
					'[Notif] Phase 2 — terminality lookup failed',
					'cron',
					'notifications-daily',
					'eventId',
					item.record.get('id'),
					'err',
					err?.message || String(err)
				);
			pendingRetry++;
			continue;
		}
		if (!isEventTerminal(rows.map((row) => deliveryStore.toPlain(row)), {
			fanoutFailed: item.fanoutFailed
		})) {
			// Un email dû reste dû : retry du run suivant (seule survie
			// pending autorisée, bornée par le garde d'obsolescence).
			pendingRetry++;
			continue;
		}
		try {
			item.record.set('processedAt', processedAt);
			$app.save(item.record);
			markedTerminal++;
		} catch (err) {
			$app
				.logger()
				.error(
					'[Notif] Phase 2 — terminal mark failed',
					'cron',
					'notifications-daily',
					'eventId',
					item.record.get('id'),
					'err',
					err?.message || String(err)
				);
			pendingRetry++;
		}
	}

	// ========================================================================
	// Clôture à la mort — event marqué mort → bulk-waive de ses deliveries
	// dues : le ledger reste véridique, aucun email ne sortira jamais d'un
	// event mort. Un save de clôture qui échoue est rattrapé par la clôture
	// résiduelle du run suivant (l'event n'est alors plus pending).
	// ========================================================================
	let markedDead = 0;
	let ledgerClosed = 0;
	const deadReasons = {
		master_gone: 0,
		occ_missing: 0,
		occ_deleted: 0,
		occ_canceled: 0,
		stale_occurrence: 0
	};
	for (const d of deadItems) {
		try {
			d.record.set('processedAt', processedAt);
			$app.save(d.record);
			markedDead++;
			deadReasons[d.reason] = (deadReasons[d.reason] || 0) + 1;
			const dueRows = $app.findRecordsByFilter(
				'notification_deliveries',
				"event = {:ev} && ((emailSentAt = '' && emailWaivedAt = '') || (pushSentAt = '' && pushWaivedAt = ''))",
				'',
				0,
				0,
				{ ev: d.record.get('id') }
			);
			for (const row of dueRows) {
				deliveryStore.closePending($app, row, processedAt);
				ledgerClosed++;
			}
		} catch (err) {
			$app
				.logger()
				.error(
					'[Notif] Phase 2 — dead mark failed',
					'cron',
					'notifications-daily',
					'reason',
					d.reason,
					'err',
					err?.message || String(err)
				);
		}
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
			'phase1_skippedUnreadableCtx',
			skippedUnreadableCtx,
			'phase2_eventsProcessed',
			eventItems.length,
			'phase2_fanoutCreated',
			fanoutCreated,
			'phase2_fanoutExisting',
			fanoutExisting,
			'phase2_residualWaived',
			residualWaived,
			'phase2_reaperWaived',
			reaperWaived,
			'phase2_pushMarkedSent',
			pushMarkedSent,
			'phase2_pushMarkedWaived',
			pushMarkedWaived,
			'phase2_pushMarkedFailed',
			pushMarkedFailed,
			'phase2_optOutWaived',
			optOutWaived,
			'phase2_readWaived',
			readWaived,
			'phase2_emailsSent',
			emailsSent,
			'phase2_smtpErrors',
			smtpErrors,
			'phase2_bufferSkipped',
			bufferSkipped,
			'phase2_circuitBreaker',
			consecutiveSmtpFailures >= MAX_SMTP_FAILURES ? 1 : 0,
			'phase2_markedDead',
			markedDead,
			'phase2_deadMasterGone',
			deadReasons.master_gone,
			'phase2_deadOccMissing',
			deadReasons.occ_missing,
			'phase2_deadOccDeleted',
			deadReasons.occ_deleted,
			'phase2_deadOccCanceled',
			deadReasons.occ_canceled,
			'phase2_deadStale',
			deadReasons.stale_occurrence,
			'phase2_ledgerClosed',
			ledgerClosed,
			'phase2_markedTerminal',
			markedTerminal,
			'phase2_pendingRetry',
			pendingRetry
		);
});

cronAdd('notifications-purge', '30 0 * * 1', () => {
	// Purge native : boucle app.delete() pour que les cascades du schéma
	// emportent les notification_deliveries de chaque event. Un DELETE SQL
	// brut ne cascade pas (les cascades de relation sont appliquées par le
	// runtime, pas par des FK SQLite). Même pattern de bornes bindées que la
	// fenêtre de la phase 1 ; précédent : planning-purge.
	const cutoffDate = new Date();
	cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 60);
	const cutoff = cutoffDate.toISOString().replace('T', ' ');

	let deleted = 0;
	let failed = 0;
	try {
		const candidates = $app.findRecordsByFilter(
			'notification_events',
			"processedAt != '' && processedAt < {:cutoff}",
			'',
			0,
			0,
			{ cutoff }
		);
		for (const ev of candidates) {
			try {
				$app.delete(ev);
				deleted++;
			} catch (err) {
				failed++;
				$app
					.logger()
					.error(
						'[Notif] Purge notification_events — delete failed',
						'cron',
						'notifications-purge',
						'eventId',
						ev.get('id'),
						'err',
						err?.message || String(err)
					);
			}
		}
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

	$app
		.logger()
		.info(
			'[Notif] Purge notification_events',
			'cron',
			'notifications-purge',
			'deleted',
			deleted,
			'failed',
			failed
		);
});
