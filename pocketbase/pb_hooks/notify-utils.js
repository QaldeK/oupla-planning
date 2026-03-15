/**
 * Utilitaires partagés pour les notifications
 *
 * Ce module fournit tous les helpers nécessaires pour l'envoi de notifications
 * push et email, ainsi que le traitement de la logique de notifications.
 *
 * NOTE: Les notifications push nécessitent le service Bun (notify-service)
 * qui sera déployé dans la Phase 5.
 */

module.exports = {
	// ============================================================================
	// ENVOI DE NOTIFICATIONS
	// ============================================================================

	/**
	 * Envoyer une notification push à un user
	 */
	sendPushNotification(app, user, title, body, url) {
		const sub = user.get('push_subscription');
		if (!sub) return Promise.resolve();

		return $http
			.send({
				method: 'POST',
				url: 'http://services-notifyservice-rbwdvg:3001/notify',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					subscription: sub,
					title,
					body,
					url: `https://planning.oupla.net${url}`
				})
			})
			.catch((err) => {
				// Logger l'erreur avec l'API PocketBase
				app.logger().error('[Notification] Push error', err?.message || err, 'url', url);
			});
	},

	/**
	 * Envoyer un email groupé (TO + CC)
	 * Permet d'envoyer un seul email à plusieurs destinataires
	 */
	sendGroupedEmail(app, users, title, body, notifUrl) {
		if (users.length === 0) return;

		const settings = app.settings();

		// Premier destinataire dans TO, les autres en CC
		const to = users[0].email();
		const cc = users.slice(1).map((u) => ({ address: u.email() }));

		const message = new MailerMessage({
			from: {
				address: settings.meta.senderAddress,
				name: settings.meta.senderName || 'Oupla Planning'
			},
			to: [{ address: to }],
			cc: cc,
			subject: title,
			html: `
				<p>${body}</p>
				<p style="margin-top: 20px;">
					<a href="https://planning.oupla.net${notifUrl}"
					   style="display: inline-block; padding: 12px 24px;
						  background-color: #007bff; color: white;
						  text-decoration: none; border-radius: 6px;">
						Voir le planning
					</a>
				</p>
			`
		});

		app.newMailClient().send(message);
	},

	// ============================================================================
	// TRAITEMENT DES NOTIFICATIONS
	// ============================================================================

	/**
	 * Groupe les participants par type de notification (push/email)
	 * selon qu'ils ont activé une notification à un nombre de jours donné
	 */
	groupByNotificationType(participants, dayField, targetDays) {
		const filtered = participants.filter((p) => p.participant.getInt(dayField) === targetDays);

		const pushUsers = [];
		const emailUsers = [];

		for (const p of filtered) {
			if (p.participant.getBool('push')) pushUsers.push(p.user);
			if (p.participant.getBool('email')) emailUsers.push(p.user);
		}

		return { pushUsers, emailUsers };
	},

	/**
	 * Traite les rappels pour une occurrence
	 * N'envoie qu'aux participants qui ont répondu "present"
	 */
	processReminders(app, occ, groups, notifUrl, daysUntil, occTime) {
		const responses = occ.get('responses') || [];

		// Filtrer: uniquement les users qui ont répondu "present"
		const presentPushUsers = groups.pushUsers.filter((u) =>
			responses.some((r) => r.id === u.getId() && r.response === 'present')
		);
		const presentEmailUsers = groups.emailUsers.filter((u) =>
			responses.some((r) => r.id === u.getId() && r.response === 'present')
		);

		if (presentPushUsers.length === 0 && presentEmailUsers.length === 0) return;

		const occDate = occ.getString('date');
		const title = `Rappel — Événement`;
		const body = `Vous avez un événement ${daysUntil === 1 ? 'demain' : `dans ${daysUntil} jours`} (${occDate} à ${occTime}).`;

		// Webpush: Promise.all en parallèle
		if (presentPushUsers.length > 0) {
			const pushPromises = presentPushUsers.map((user) =>
				this.sendPushNotification(app, user, title, body, notifUrl)
			);
			Promise.all(pushPromises).catch((err) => {
				app
					.logger()
					.error(
						'[Notification] Batch push error',
						err?.message || err,
						'count',
						presentPushUsers.length
					);
			});
		}

		// Email: 1 seul email avec CC
		if (presentEmailUsers.length > 0) {
			this.sendGroupedEmail(app, presentEmailUsers, title, body, notifUrl);
		}
	},

	/**
	 * Traite les alertes de participants manquants pour une occurrence
	 * N'envoie que si le nombre de présents est inférieur au minRequired
	 */
	processMissingParticipants(app, occ, groups, notifUrl, daysUntil) {
		const responses = occ.get('responses') || [];
		const presentCount = responses.filter((r) => r.response === 'present').length;
		const minRequired = occ.getInt('minPresentRequired') || 0;

		if (minRequired === 0 || presentCount >= minRequired) return;
		if (groups.pushUsers.length === 0 && groups.emailUsers.length === 0) return;

		const occDate = occ.getString('date');
		const title = `Il manque des participants — Événement`;
		const body = `Occurrence du ${occDate} : ${presentCount}/${minRequired} présents.`;

		// Webpush
		if (groups.pushUsers.length > 0) {
			const pushPromises = groups.pushUsers.map((user) =>
				this.sendPushNotification(app, user, title, body, notifUrl)
			);
			Promise.all(pushPromises).catch((err) => {
				app
					.logger()
					.error(
						'[Notification] Batch push error',
						err?.message || err,
						'count',
						groups.pushUsers.length
					);
			});
		}

		// Email groupé
		if (groups.emailUsers.length > 0) {
			this.sendGroupedEmail(app, groups.emailUsers, title, body, notifUrl);
		}
	}
};
