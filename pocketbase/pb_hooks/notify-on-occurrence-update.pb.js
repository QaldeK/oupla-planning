/// <reference path="../pb_data/types.d.ts" />

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
	const { sendPushNotification, sendGroupedEmail } = require(`${__hooks}/notify-utils.js`);

	const rec = e.record;
	const orig = rec.original();

	// Détecter les changements
	const isCanceled = rec.getBool('isCanceled');
	const wasCanceled = isCanceled && !orig.getBool('isCanceled');

	const timeChanged =
		!isCanceled &&
		(rec.getString('startTime') !== orig.getString('startTime') ||
			rec.getString('date') !== orig.getString('date'));

	// Si pas de changement pertinent, on sort
	if (!wasCanceled && !timeChanged) return e.next();

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
		// Pas de participants ou erreur
		return e.next();
	}

	if (participants.length === 0) return e.next();

	// Charger le master pour obtenir le titre et le token
	let master;
	try {
		master = e.app.findRecordById('planning_masters', masterId);
	} catch (err) {
		return e.next();
	}

	const notifUrl = `/p/${master.getString('participantToken')}`;
	const masterTitle = master.getString('title');
	const occDate = rec.getString('date');
	const occTime = rec.getString('startTime');

	// Déterminer le type de notification
	const [notifTitle, notifBody, relevantField] = wasCanceled
		? [`Annulation — ${masterTitle}`, `L'occurrence du ${occDate} a été annulée.`, 'onCancellation']
		: [
				`Changement d'horaire — ${masterTitle}`,
				`L'occurrence du ${occDate} est maintenant à ${occTime}.`,
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

	// Envoyer les notifications
	if (pushUsers.length > 0) {
		const pushPromises = pushUsers.map((user) =>
			sendPushNotification(e.app, user, notifTitle, notifBody, notifUrl)
		);
		Promise.all(pushPromises).catch((err) => {
			e.app
				.logger()
				.error(
					'[Notification] Occurrence update push error',
					err?.message || err,
					'users',
					pushUsers.length
				);
		});
	}

	if (emailUsers.length > 0) {
		sendGroupedEmail(e.app, emailUsers, notifTitle, notifBody, notifUrl);
	}

	e.next();
}, 'planning_occurrences');
