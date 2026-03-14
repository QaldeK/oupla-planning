/**
 * Utilitaires de notification pour les hooks PocketBase
 *
 * Ce module exporte une fonction notifyUser qui envoie des notifications
 * push et email aux utilisateurs selon leurs préférences.
 */

module.exports = {
	/**
	 * Envoyer une notification à un utilisateur
	 * @param {Object} app - L'instance PocketBase (e.app)
	 * @param {Object} http - Le client HTTP (e.http ou $http)
	 * @param {string} userId - ID de l'utilisateur (UUID)
	 * @param {string} title - Titre de la notification
	 * @param {string} body - Corps de la notification
	 * @param {string} url - URL vers laquelle rediriger (ex: /p/abc123)
	 */
	notifyUser(app, http, userId, title, body, url) {
		let user;
		try {
			user = app.findRecordById('users', userId);
		} catch (err) {
			return;
		}

		const ns = user.get('notificationsSubscription');
		if (!ns) {
			return;
		}

		// Notification Push
		if (ns.push) {
			const sub = user.get('push_subscription');
			if (sub) {
				try {
					http.send({
						method: 'POST',
						url: 'http://notify-service:3001',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							subscription: sub,
							title,
							body,
							url: `https://planning.oupla.net${url}`
						})
					});
				} catch (err) {
					// Silently fail - push notifications are not critical
				}
			}
		}

		// Notification Email
		if (ns.email) {
			try {
				const settings = app.settings();
				const message = new MailerMessage({
					from: {
						address: settings.meta.senderAddress,
						name: settings.meta.senderName || 'Oupla Planning'
					},
					to: [{ address: user.email() }],
					subject: title,
					html: `
						<p>${body}</p>
						<p style="margin-top: 20px;">
							<a href="https://planning.oupla.net${url}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 6px;">
								Voir le planning
							</a>
						</p>
					`
				});
				app.newMailClient().send(message);
			} catch (err) {
				// Silently fail - email errors are logged by PocketBase
			}
		}
	}
};
