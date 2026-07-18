/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7. Pièges projet : agent/doc/memo.md. Voir AGENTS.md § PRÉALABLE POCKETBASE.

/**
 * Cron principal pour les notifications
 * Exécuté tous les jours à 8h du matin
 *
 * Ce cron:
 * 1. Récupère tous les participants avec des notifications activées
 * 2. Groupe les participants par planning
 * 3. Trouve les occurrences correspondant aux J-X configurés par les participants
 * 4. Envoie les rappels pour les participants "present"
 * 5. Envoie les alertes "participants manquants"
 */

cronAdd('notifications-check', '0 8 * * *', (e) => {
	const notifyUtils = require(`${__hooks}/notify-utils.js`);

	// 1. Trouver tous les participants avec des notifications activées
	let notifiableParticipants;
	try {
		notifiableParticipants = e.app.findRecordsByFilter(
			'planning_participants',
			'push = true || email = true',
			'-created',
			-1,
			0,
			{}
		);

		// EXPAND : Charger tous les users en UNE SEULE requête
		e.app.expandRecords(notifiableParticipants, ['user'], null);
	} catch (err) {
		e.app
			.logger()
			.error(
				'[Notification] Cron: failed to load notifiable participants',
				'err',
				err?.message || err
			);
		return;
	}

	if (notifiableParticipants.length === 0) {
		e.app.logger().info('[Notification] Cron: no notifiable participants, exiting');
		return;
	}

	// 2. Grouper par planning
	const participantsByPlanning = new Map();

	for (const p of notifiableParticipants) {
		const planningId = p.getString('planning');
		const user = p.expandedOne('user');
		if (!user) continue;

		if (!participantsByPlanning.has(planningId)) {
			participantsByPlanning.set(planningId, []);
		}

		participantsByPlanning.get(planningId).push({
			participant: p,
			user: user
		});
	}

	const planningIds = Array.from(participantsByPlanning.keys());

	e.app
		.logger()
		.info(
			'[Notification] Cron start',
			'participants',
			notifiableParticipants.length,
			'plannings',
			planningIds.length
		);

	// 3. Calculer les dates cibles à partir des valeurs réellement configurées
	//    par les participants (reminderDays / missingParticipantsDays).
	//    On évite ainsi le bug où une valeur UI (ex: 15) n'est jamais traitée
	//    par le cron. Si personne n'a configuré de rappel, on sort tôt.
	const configuredDays = new Set();
	for (const p of notifiableParticipants) {
		const r = p.getInt('reminderDays');
		const m = p.getInt('missingParticipantsDays');
		if (r > 0) configuredDays.add(r);
		if (m > 0) configuredDays.add(m);
	}

	if (configuredDays.size === 0) {
		e.app.logger().info('[Notification] Cron: no configured days, exiting');
		return;
	}

	const dates = Array.from(configuredDays).map((days) => {
		const d = new Date();
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().split('T')[0];
	});

	const dateFilters = dates.map((d, i) => `date = {:date_${i}}`).join(' || ');
	const dateParams = {};
	dates.forEach((d, i) => {
		dateParams[`date_${i}`] = d;
	});

	// IMPORTANT: Utiliser des placeholders nommés pour master (éviter injection SQL)
	const planningParams = {};
	planningIds.forEach((id, i) => {
		planningParams[`planning_${i}`] = id;
	});
	const planningFilters = planningIds.map((id, i) => `master = {:planning_${i}}`).join(' || ');

	// 4. Trouver les occurrences
	let occurrences;
	try {
		occurrences = e.app.findRecordsByFilter(
			'planning_occurrences',
			`(${planningFilters}) && (${dateFilters}) && isCanceled = false`,
			'date ASC',
			500,
			0,
			{ ...dateParams, ...planningParams }
		);
	} catch (err) {
		e.app
			.logger()
			.error('[Notification] Cron: failed to load occurrences', 'err', err?.message || err);
		return;
	}

	// 5. Traiter chaque occurrence
	const today = new Date().toISOString().split('T')[0];
	const masterCache = new Map();

	for (const occ of occurrences) {
		const masterId = occ.getString('master');
		const occDate = occ.getString('date');

		// Calcul UTC pour éviter les problèmes de fuseau horaire
		const occDateObj = new Date(occDate + 'T00:00:00Z');
		const todayDateObj = new Date(today + 'T00:00:00Z');
		const daysUntil = Math.ceil((occDateObj - todayDateObj) / (1000 * 60 * 60 * 24));

		// Charger le master (avec cache)
		let master = masterCache.get(masterId);
		if (!master) {
			try {
				master = e.app.findRecordById('planning_masters', masterId);
				masterCache.set(masterId, master);
			} catch (err) {
				e.app
					.logger()
					.error(
						'[Notification] Cron: failed to load master',
						'masterId',
						masterId,
						'err',
						err?.message || err
					);
				continue;
			}
		}

		const participants = participantsByPlanning.get(masterId) || [];
		const notifUrl = `/p/${master.getString('participantToken')}`;
		const occTime = occ.getString('startTime');
		const masterTitle = master.getString('title');

		// 5a. Check reminders (rappels pour les participants "present")
		const reminderGroups = notifyUtils.groupByNotificationType(
			participants,
			'reminderDays',
			daysUntil
		);
		notifyUtils.processReminders(
			e.app,
			occ,
			reminderGroups,
			notifUrl,
			daysUntil,
			occTime,
			masterTitle
		);

		// 5b. Check missing participants (alertes si pas assez de monde)
		const missingGroups = notifyUtils.groupByNotificationType(
			participants,
			'missingParticipantsDays',
			daysUntil
		);
		notifyUtils.processMissingParticipants(
			e.app,
			occ,
			missingGroups,
			notifUrl,
			daysUntil,
			masterTitle
		);
	}

	e.app.logger().info('[Notification] Cron done', 'occurrences', occurrences.length);
});
