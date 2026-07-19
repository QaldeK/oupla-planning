/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7. Pièges projet : agent/doc/memo.md. Voir AGENTS.md § PRÉALABLE POCKETBASE.

/**
 * Hook occurrence-update — brique producteur du pipeline de notifications.
 *
 * Toute modification pertinente d'une occurrence future est enregistrée comme
 * une row dans `notification_events`. Le cron quotidien agrège ces rows pour
 * produire les emails et push, en calculant les destinataires au runtime
 * selon les prefs de chaque participant.
 *
 * Rôle strictement producteur : aucune logique de destinataire, de préférence
 * ou d'envoi SMTP/push ici. Cela garantit un coût constant par update (1 INSERT)
 * indépendant du nombre de participants au planning.
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

	e.next();
}, 'planning_occurrences');
