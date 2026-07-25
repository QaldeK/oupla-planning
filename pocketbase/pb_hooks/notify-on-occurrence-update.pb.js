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
	const { computeRecipients } = require(`${__hooks}/notification-recipients.js`);
	const { buildPushTitle, buildPushBody } = require(`${__hooks}/notification-cron-utils.js`);
	const { sendPushNotification } = require(`${__hooks}/notify-utils.js`);
	const { dispatchPushForEvent } = require(`${__hooks}/push-dispatch.js`);

	// Filtre temporel : les occurrences passées ne génèrent plus d'events.
	// Comparaison en UTC pour éviter les décalages de fuseau. Le guard doit
	// retourner au niveau du handler (et non inside une IIFE) pour réellement
	// court-circuiter la suite : un `return` d'IIFE ne fait que quitter l'IIFE.
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
	if (!record.get('id')) {
		e.next();
		return;
	}

	const descriptor = detectOccurrenceChange(record, original);
	if (!descriptor) {
		e.next();
		return;
	}

	// Insertion dans notification_events : l'échec est loggué sans remonter
	// pour ne pas casser la réponse API à un update qui a pourtant réussi.
	try {
		const collection = e.app.findCollectionByNameOrId('notification_events');
		const event = new Record(collection);
		event.set('type', descriptor.type);
		event.set('master', record.getString('master'));
		event.set('occurrence', record.get('id'));
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
				record.get('id'),
				'type',
				descriptor.type
			);
	}

	// ======================================================================
	// PUSH IMMÉDIAT pour les change events (meilleur effort)
	// ======================================================================
	// Si l'envoi échoue, l'event est déjà dans notification_events → l'email
	// partira au prochain cron (fallback fiable).
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

		const eventPlain = { type: descriptor.type, reminderValue: 0 };
		const recipients = computeRecipients(eventPlain, master, planningParticipants, record);

		dispatchPushForEvent(e.app, {
			event: eventPlain,
			master,
			occ: record,
			recipients,
			resolveUser: (uid) => {
				try {
					return e.app.findRecordById('users', uid);
				} catch {
					return null;
				}
			},
			buildPushTitle,
			buildPushBody,
			sendPushNotification
		});
	} catch (err) {
		// Ne jamais casser l'API update pour un push qui échoue.
		e.app
			.logger()
			.error(
				'[Notification] Push immédiat failed',
				'err',
				err?.message || String(err),
				'occurrenceId',
				record.get('id'),
				'type',
				descriptor.type
			);
	}

	e.next();
}, 'planning_occurrences');
