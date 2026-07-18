/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7. Pièges projet : agent/doc/memo.md. Voir AGENTS.md § PRÉALABLE POCKETBASE.

/**
 * Hook déclenché après la mise à jour d'une occurrence
 *
 * Envoie des notifications push et email aux participants concernés quand:
 * - Une occurrence est annulée
 * - L'horaire ou la date d'une occurrence est modifiée
 *
 * Les notifications sont envoyées uniquement aux participants qui ont
 * activé les préférences onCancellation ou onTimeChange dans leurs
 * préférences de planning.
 */

onRecordAfterUpdateSuccess((e) => {
	const { sendPushNotification, sendGroupedEmail, formatDateFR } = require(
		`${__hooks}/notify-utils.js`
	);

	const rec = e.record;
	const orig = rec.original();

	e.app
		.logger()
		.info(
			'[Notif-DBG] Hook start',
			'occId',
			rec.get('id'),
			'isCanceled',
			rec.getBool('isCanceled'),
			'origIsCanceled',
			orig.getBool('isCanceled'),
			'startTime',
			rec.getString('startTime'),
			'origStartTime',
			orig.getString('startTime'),
			'date',
			rec.getString('date'),
			'origDate',
			orig.getString('date')
		);

	// Détecter les changements
	const isCanceled = rec.getBool('isCanceled');
	const wasCanceled = isCanceled && !orig.getBool('isCanceled');

	const timeChanged =
		!isCanceled &&
		(rec.getString('startTime') !== orig.getString('startTime') ||
			rec.getString('date') !== orig.getString('date'));

	// Si pas de changement pertinent, on sort
	if (!wasCanceled && !timeChanged) {
		e.app.logger().info('[Notif-DBG] Early return: no relevant change', 'occId', rec.get('id'));
		return e.next();
	}

	// Trouver les participants notifiables pour CE planning
	const masterId = rec.getString('master');
	let participants;
	try {
		participants = e.app.findRecordsByFilter(
			'planning_participants',
			`planning = {:masterId} && (onCancellation = true || onTimeChange = true)`,
			'-created',
			-1,
			0,
			{ masterId }
		);
		e.app.expandRecords(participants, ['user'], null);
	} catch (err) {
		e.app
			.logger()
			.error(
				'[Notif-DBG] Early return: failed to load participants',
				'occId',
				rec.get('id'),
				'masterId',
				masterId,
				'err',
				err?.message || err
			);
		return e.next();
	}

	if (participants.length === 0) {
		e.app
			.logger()
			.info(
				'[Notif-DBG] Early return: no participants',
				'occId',
				rec.get('id'),
				'masterId',
				masterId
			);
		return e.next();
	}

	// Charger le master pour obtenir le titre et le token
	let master;
	try {
		master = e.app.findRecordById('planning_masters', masterId);
	} catch (err) {
		e.app
			.logger()
			.error(
				'[Notif-DBG] Early return: master not found',
				'occId',
				rec.get('id'),
				'masterId',
				masterId,
				'err',
				err?.message || err
			);
		return e.next();
	}

	const notifUrl = `/p/${master.getString('participantToken')}`;
	const masterTitle = master.getString('title');
	const occDate = formatDateFR(rec.getString('date'));

	// Déterminer le type de notification
	const [notifTitle, notifBody, relevantField] = wasCanceled
		? [`Annulation — ${masterTitle}`, `L'occurrence du ${occDate} a été annulée.`, 'onCancellation']
		: [
				`Changement — ${masterTitle}`,
				`La date ou l'horaire d'un événement a été modifié.`,
				'onTimeChange'
			];

	// Grouper par type de notification
	const pushUsers = [];
	const emailUsers = [];

	for (const p of participants) {
		// Vérifier que le participant a activé CE type de notification
		if (!p.getBool(relevantField)) continue;

		const user = p.expandedOne('user');
		if (!user) continue;

		if (p.getBool('push')) pushUsers.push(user);
		if (p.getBool('email')) emailUsers.push(user);
	}

	e.app
		.logger()
		.info(
			'[Notif-DBG] Sending notifications',
			'occId',
			rec.get('id'),
			'pushUsers',
			pushUsers.length,
			'emailUsers',
			emailUsers.length,
			'type',
			wasCanceled ? 'cancellation' : 'timeChange'
		);

	// Envoyer les notifications (JSVM synchrone — boucle simple, pas Promise.all)
	try {
		for (const user of pushUsers) {
			sendPushNotification(e.app, user, notifTitle, notifBody, notifUrl);
		}

		if (emailUsers.length > 0) {
			sendGroupedEmail(e.app, emailUsers, notifTitle, notifBody, notifUrl);
		}
	} catch (err) {
		e.app.logger().error('[Notification] Occurrence update error', 'err', err?.message || err);
	}

	e.next();
}, 'planning_occurrences');
