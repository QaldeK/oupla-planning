/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7. Voir pocketbase/pb_hooks/AGENTS.md (préalable source-first + conventions projet).

/**
 * Hook occurrence-update — brique producteur du pipeline de notifications,
 * avec envoi push immédiat pour les change events.
 *
 * Toute modification pertinente d'une occurrence future est :
 *   1) enregistrée comme une row dans `notification_events` (pour email au cron)
 *   2) envoyée immédiatement en push aux participants avec push:true
 *      et onOccurrenceChange:true (best-effort, non bloquant)
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
	const { sendPushNotification } = require(`${__hooks}/notify-utils.js`);
	const { dispatchPushForEvent } = require(`${__hooks}/push-dispatch.js`);

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

	// master + planning_participants : nécessaires uniquement pour le push
	// (pas pour l'insert). Résolution paresseuse et mutualisée entre les deux
	// chemins pour éviter un double fetch quand un même update porte à la fois
	// un change event et un nouveau commentaire.
	let masterCtx = null;
	const getMasterCtx = () => {
		if (masterCtx) return masterCtx;
		try {
			const masterId = record.getString('master');
			const master = e.app.findRecordById('planning_masters', masterId);
			const planningParticipants = e.app.findRecordsByFilter(
				'planning_participants',
				'planning = {:masterId}',
				'',
				0,
				0,
				{ masterId }
			);
			masterCtx = { master, planningParticipants };
		} catch (err) {
			e.app.logger().error(
				'[Notification] master/participants lookup failed',
				'err', err?.message || String(err),
				'occurrenceId', occId
			);
			masterCtx = null;
		}
		return masterCtx;
	};

	const resolveUser = (uid) => {
		try {
			return e.app.findRecordById('users', uid);
		} catch {
			return null;
		}
	};

	// ========================================================================
	// Path 1 — change events (schedule_change, status_*, …)
	// ========================================================================
	const descriptor = detectOccurrenceChange(record, original);
	if (descriptor) {
		// Insertion dans notification_events : l'échec est loggué sans remonter
		// pour ne pas casser la réponse API à un update qui a pourtant réussi.
		try {
			const collection = e.app.findCollectionByNameOrId('notification_events');
			const event = new Record(collection);
			event.set('type', descriptor.type);
			event.set('master', record.getString('master'));
			event.set('occurrence', occId);
			event.set('reminderValue', 0);
			event.set('changedBy', record.getString('lastModifiedBy'));
			event.set('payload', descriptor.payload || null);
			e.app.save(event);
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
			const ctx = getMasterCtx();
			if (ctx) {
				const eventPlain = { type: descriptor.type, reminderValue: 0 };
				const recipients = computeRecipients(eventPlain, ctx.master, ctx.planningParticipants, record);
				dispatchPushForEvent(e.app, {
					event: eventPlain,
					master: ctx.master,
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
	// Path 2 — new_comment events (ajouts) + cleanup (suppressions)
	// ========================================================================
	const commentChanges = detectCommentChanges(record, original);

	// 2a. Cleanup : marquer processedAt sur les events new_comment non-consommés
	// liés aux commentaires supprimés, pour qu'aucun email ne parte sur un
	// message qui n'existe plus. Filtrage en JS (volume faible par occ, et le
	// support de json_extract en JSVM est incertain).
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

	// 2b. Pour chaque commentaire ajouté : INSERT event new_comment + push
	// immédiat (auteur exclu). 1 commentaire = 1 event = 1 push.
	if (commentChanges.added.length > 0) {
		const ctx = getMasterCtx();
		if (ctx) {
			const authorUserId = record.getString('lastModifiedBy');
			// Le détecteur dépose lastModifiedBy (userId) comme authorName faute
			// d'accès aux noms ; on résout le nom affichable ici via le user.
			const resolveAuthorName = (uid) => {
				if (!uid) return '';
				try {
					const u = e.app.findRecordById('users', uid);
					return u.getString('name') || u.getString('email') || uid;
				} catch {
					return uid;
				}
			};
			const resolvedAuthorName = resolveAuthorName(authorUserId);

			for (const added of commentChanges.added) {
				const payload = {
					commentId: added.commentId,
					commentCreatedAt: added.commentCreatedAt,
					authorName: resolvedAuthorName,
					contentPreview: added.contentPreview
				};

				try {
					const collection = e.app.findCollectionByNameOrId('notification_events');
					const event = new Record(collection);
					event.set('type', 'new_comment');
					event.set('master', record.getString('master'));
					event.set('occurrence', occId);
					event.set('reminderValue', 0);
					event.set('changedBy', authorUserId);
					event.set('payload', payload);
					e.app.save(event);
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
					const eventPlain = { type: 'new_comment', reminderValue: 0, payload };
					const recipients = computeRecipients(
						eventPlain,
						ctx.master,
						ctx.planningParticipants,
						record,
						authorUserId
					);
					dispatchPushForEvent(e.app, {
						event: eventPlain,
						master: ctx.master,
						occ: record,
						recipients,
						resolveUser,
						buildPushTitle,
						buildPushBody,
						sendPushNotification
					});
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
	}

	e.next();
}, 'planning_occurrences');
