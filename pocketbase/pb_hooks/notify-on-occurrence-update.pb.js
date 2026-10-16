/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7.

/**
 * Hook occurrence-update — brique producteur du pipeline de notifications,
 * avec envoi push immédiat pour les change events.
 *
 * Toute modification pertinente d'une occurrence future est :
 *   1) enregistrée comme une row dans `notification_events` (pour email au cron)
 *   2) envoyée immédiatement en push aux participants avec push:true
 *      et onOccurrenceChange:true (best-effort, non bloquant)
 *
 * Un master soft-deleté (ou introuvable) ne produit ni event ni push — gate
 * unique sur le contexte master, seul garde du chemin programmatique.
 *
 * Le cron quotidien agrège les rows non traitées pour produire les emails,
 * et sert de fallback si le push échoue.
 *
 * Pourquoi un hook `*After*Success` plutôt qu'un hook `*Request` :
 *   - il se déclenche aussi bien depuis une route API que depuis un batch SDK,
 *     une commande console, ou tout autre `$app.save()`;
 *   - il ne s'exécute qu'après le commit transactionnel, donc l'event reflète
 *     un état réellement persisté.
 * Contrepartie acceptée : pas d'accès au contexte HTTP (`e.auth`, headers...).
 * L'auteur de l'action est lu depuis `occurrence.lastModifiedBy`, alimenté côté
 * client par `pb.authStore.record?.id`.
 */

onRecordAfterUpdateSuccess((e) => {
	const record = e.record;
	const original = record.original();
	const { detectOccurrenceChange } = require(`${__hooks}/occurrence-change-detector.js`);
	const { detectCommentChanges } = require(`${__hooks}/new-comment-detector.js`);
	const { computeRecipients } = require(`${__hooks}/notification-recipients.js`);
	const { buildPushTitle, buildPushBody } = require(`${__hooks}/notification-cron-utils.js`);
	const { sendPushNotification } = require(`${__hooks}/notify-utils.cjs`);
	const { dispatchPushForEvent } = require(`${__hooks}/push-dispatch.js`);
	const { insertEvent, createMasterContextResolver, resolveUserName } = require(
		`${__hooks}/notification-events.cjs`
	);

	// Filtre temporel : les occurrences passées ne génèrent plus d'events.
	// S'applique aux deux chemins (change events ET new_comment). Comparaison en
	// UTC pour éviter les décalages de fuseau. Le guard doit retourner au niveau
	// du handler (et non inside une IIFE) pour réellement court-circuiter la
	// suite : un `return` d'IIFE ne fait que quitter l'IIFE.
	const rawDate = record.getString('date');
	if (rawDate) {
		const day = rawDate.split(' ')[0].split('T')[0];
		if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
			const occDate = new Date(`${day}T00:00:00Z`).getTime();
			if (!Number.isNaN(occDate)) {
				const today = new Date();
				const todayUtcMidnight = Date.UTC(
					today.getUTCFullYear(),
					today.getUTCMonth(),
					today.getUTCDate()
				);
				if (occDate < todayUtcMidnight) {
					e.next();
					return;
				}
			}
		}
	}
	const occId = record.get('id');
	if (!occId) {
		e.next();
		return;
	}

	const resolveUser = (uid) => {
		try {
			return e.app.findRecordById('users', uid);
		} catch {
			return null;
		}
	};

	// Détection d'abord : pas de fetch master si rien n'est produit.
	const descriptor = detectOccurrenceChange(record, original);
	const commentChanges = detectCommentChanges(record, original);

	// ========================================================================
	// Cleanup — marquer processedAt sur les events new_comment non-consommés
	// liés aux commentaires supprimés, pour qu'aucun email ne parte sur un
	// message qui n'existe plus. Filtrage en JS (volume faible par occ, et le
	// support de json_extract en JSVM est incertain). Hors gate : hygiène de
	// rows existantes, ne produit aucun event.
	// ========================================================================
	if (commentChanges.removed.length > 0) {
		try {
			const removedSet = new Set(commentChanges.removed);
			const ts = new Date().toISOString().replace('T', ' ');
			const pending = e.app.findRecordsByFilter(
				'notification_events',
				"type = {:type} && occurrence = {:occ} && processedAt = ''",
				'',
				0,
				0,
				{ type: 'new_comment', occ: occId }
			);
			for (const ev of pending) {
				let payload;
				try {
					payload = JSON.parse(ev.getString('payload') || '{}');
				} catch {
					continue;
				}
				if (!payload || !removedSet.has(payload.commentId)) continue;
				try {
					ev.set('processedAt', ts);
					e.app.save(ev);
				} catch (saveErr) {
					e.app.logger().error(
						'[Notification] comment cleanup processedAt save failed',
						'err', saveErr?.message || String(saveErr),
						'occurrenceId', occId
					);
				}
			}
		} catch (err) {
			e.app.logger().error(
				'[Notification] comment event cleanup failed',
				'err', err?.message || String(err),
				'occurrenceId', occId
			);
		}
	}

	// ========================================================================
	// Gate contexte — un master supprimé (ou introuvable) ne produit ni event
	// ni push. Seul garde du chemin programmatique : les gardes request ne
	// voient pas les saves programmatiques (routes custom, batch, superuser).
	// ========================================================================
	const getCtx = createMasterContextResolver(e.app);
	let masterCtx = null;
	if (descriptor || commentChanges.added.length > 0) {
		masterCtx = getCtx(record.getString('master'));
		if (!masterCtx) {
			e.next();
			return;
		}
	}

	// Push seulement si les destinataires sont connus : `participants: null`
	// (lecture échouée, déjà loggée par le resolver) saute le push sans priver
	// l'event de son écriture — le cron rattrapera l'email.
	const pushCtx = masterCtx && masterCtx.participants ? masterCtx : null;

	// ========================================================================
	// Path 1 — change events (schedule_change, status_*, …)
	// ========================================================================
	if (descriptor) {
		// Insertion dans notification_events : l'échec est loggué sans remonter
		// pour ne pas casser la réponse API à un update qui a pourtant réussi.
		try {
			insertEvent(e.app, {
				type: descriptor.type,
				master: record.getString('master'),
				occurrence: occId,
				reminderValue: 0,
				changedBy: record.getString('lastModifiedBy'),
				payload: descriptor.payload || null
			});
		} catch (err) {
			e.app
				.logger()
				.error(
					'[Notification] Failed to insert notification_events row',
					'err',
					err?.message || String(err),
					'occurrenceId',
					occId,
					'type',
					descriptor.type
				);
		}

		// Push immédiat pour les change events (best-effort). Si l'envoi échoue,
		// l'event est déjà dans notification_events → l'email partira au prochain cron.
		try {
			if (pushCtx) {
				const eventPlain = { type: descriptor.type, reminderValue: 0 };
				const recipients = computeRecipients(eventPlain, pushCtx.master, pushCtx.participants, record);
				dispatchPushForEvent(e.app, {
					event: eventPlain,
					master: pushCtx.master,
					occ: record,
					recipients,
					resolveUser,
					buildPushTitle,
					buildPushBody,
					sendPushNotification
				});
			}
		} catch (err) {
			e.app
				.logger()
				.error(
					'[Notification] Push immédiat failed',
					'err',
					err?.message || String(err),
					'occurrenceId',
					occId,
					'type',
					descriptor.type
				);
		}
	}

	// ========================================================================
	// Path 2 — new_comment events (ajouts) ; le cleanup des suppressions a
	// tourné plus haut, hors gate. 1 commentaire = 1 event = 1 push.
	// ========================================================================
	if (commentChanges.added.length > 0) {
		const authorUserId = record.getString('lastModifiedBy');
		// Le détecteur dépose lastModifiedBy (userId) comme authorName faute
		// d'accès aux noms ; on résout le nom affichable ici via le user.
		const resolvedAuthorName = resolveUserName(e.app, authorUserId, authorUserId);

		for (const added of commentChanges.added) {
			const payload = {
				commentId: added.commentId,
				commentCreatedAt: added.commentCreatedAt,
				authorName: resolvedAuthorName,
				contentPreview: added.contentPreview
			};

			try {
				insertEvent(e.app, {
					type: 'new_comment',
					master: record.getString('master'),
					occurrence: occId,
					reminderValue: 0,
					changedBy: authorUserId,
					payload
				});
			} catch (err) {
				e.app
					.logger()
					.error(
						'[Notification] Failed to insert new_comment event',
						'err',
						err?.message || String(err),
						'occurrenceId',
						occId,
						'commentId',
						added.commentId
					);
			}

			// Push immédiat best-effort — l'auteur est exclu via excludeUserId.
			try {
				if (pushCtx) {
					const eventPlain = { type: 'new_comment', reminderValue: 0, payload };
					const recipients = computeRecipients(
						eventPlain,
						pushCtx.master,
						pushCtx.participants,
						record,
						authorUserId
					);
					dispatchPushForEvent(e.app, {
						event: eventPlain,
						master: pushCtx.master,
						occ: record,
						recipients,
						resolveUser,
						buildPushTitle,
						buildPushBody,
						sendPushNotification
					});
				}
			} catch (err) {
				e.app
					.logger()
					.error(
						'[Notification] new_comment push failed',
						'err',
						err?.message || String(err),
						'occurrenceId',
						occId,
						'commentId',
						added.commentId
					);
			}
		}
	}

	e.next();
}, 'planning_occurrences');
