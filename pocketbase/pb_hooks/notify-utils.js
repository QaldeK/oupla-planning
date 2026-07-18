// @ts-nocheck — Fichier JSVM PocketBase, les globaux ($http, MailerMessage, etc.) sont injectés par le runtime
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7. Pièges projet : agent/doc/memo.md. Voir AGENTS.md § PRÉALABLE POCKETBASE.

/**
 * Utilitaires partagés pour les notifications
 *
 * Ce module fournit tous les helpers nécessaires pour l'envoi de notifications
 * push et email, ainsi que le traitement de la logique de notifications.
 */

module.exports = {
	// ============================================================================
	// FORMATTAGE
	// ============================================================================

	/**
	 * Formater une date ISO en format court français.
	 * "2026-03-31" → "mar. 31 mars"
	 */
	formatDateFR(dateStr) {
		try {
			const date = new Date(dateStr + 'T00:00:00Z');
			return date.toLocaleDateString('fr-FR', {
				weekday: 'short',
				day: 'numeric',
				month: 'short'
			});
		} catch {
			return dateStr;
		}
	},

	// ============================================================================
	// ENVOI DE NOTIFICATIONS
	// ============================================================================

	/**
	 * Envoyer une notification push à un user.
	 * $http.send() est synchrone dans la JSVM PocketBase — pas de Promise.
	 * Si la subscription est expirée (410/404), elle est nettoyée dans PocketBase.
	 */
	sendPushNotification(app, user, title, body, url) {
		const sub = user.get('push_subscription');
		if (!sub) return;

		let res;
		try {
			res = $http.send({
				method: 'POST',
				url: 'http://services-notifyservice-rbwdvg:3001/notify',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					subscription: sub,
					title,
					body,
					url: `https://planning.oupla.net${url}`
				}),
				timeout: 10
			});
		} catch (err) {
			app
				.logger()
				.error(
					'[Notification] Push HTTP error',
					'err',
					err?.message || err,
					'userId',
					user.get('id')
				);
			return;
		}

		// Subscription expirée ou révoquée — nettoyer dans PocketBase
		if (res.statusCode === 410 || res.statusCode === 404) {
			app.logger().info('[Notification] Subscription expirée, nettoyage', 'userId', user.get('id'));
			try {
				user.set('push_subscription', null);
				app.save(user);
			} catch (cleanupErr) {
				app
					.logger()
					.error(
						'[Notification] Erreur nettoyage subscription',
						'err',
						cleanupErr?.message || cleanupErr,
						'userId',
						user.get('id')
					);
			}
			return;
		}

		if (res.statusCode !== 200) {
			app
				.logger()
				.error(
					'[Notification] Push error',
					'status',
					res.statusCode,
					'userId',
					user.get('id'),
					'url',
					url
				);
			return;
		}

		app.logger().info('[Notification] Push sent', 'userId', user.get('id'));
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

		try {
			app.newMailClient().send(message);
			app.logger().info('[Notification] Email sent', 'recipients', users.length, 'subject', title);
		} catch (err) {
			app
				.logger()
				.error(
					'[Notification] SMTP send failed',
					err?.message || err,
					'recipients',
					users.length,
					'subject',
					title
				);
		}
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
	 * Traite les rappels pour une occurrence.
	 * N'envoie qu'aux participants qui ont répondu "present".
	 */
	processReminders(app, occ, groups, notifUrl, daysUntil, occTime, masterTitle) {
		const responses = occ.get('responses') || [];

		// Filtrer: uniquement les users qui ont répondu "present".
		// ⚠️ responses utilise `participantId` (cf. main.pb.js / planning.types.ts),
		// pas `id`. Un filtre sur `r.id` ne matche jamais → aucun rappel envoyé.
		const presentPushUsers = groups.pushUsers.filter((u) =>
			responses.some((r) => r.participantId === u.get('id') && r.response === 'present')
		);
		const presentEmailUsers = groups.emailUsers.filter((u) =>
			responses.some((r) => r.participantId === u.get('id') && r.response === 'present')
		);

		if (presentPushUsers.length === 0 && presentEmailUsers.length === 0) return;

		const occDate = occ.getString('date');
		const title = `Rappel — ${masterTitle}`;
		const body = `Vous avez un événement ${daysUntil === 1 ? 'demain' : `dans ${daysUntil} jours`} (${occDate} à ${occTime}).`;

		// Push: séquentiel (JSVM synchrone)
		for (const user of presentPushUsers) {
			this.sendPushNotification(app, user, title, body, notifUrl);
		}

		// Email: 1 seul email avec CC
		if (presentEmailUsers.length > 0) {
			this.sendGroupedEmail(app, presentEmailUsers, title, body, notifUrl);
		}
	},

	/**
	 * Traite les alertes de participants manquants pour une occurrence.
	 * N'envoie que si le nombre de présents est inférieur au minRequired.
	 */
	processMissingParticipants(app, occ, groups, notifUrl, daysUntil, masterTitle) {
		const responses = occ.get('responses') || [];
		const presentCount = responses.filter((r) => r.response === 'present').length;
		const minRequired = occ.getInt('minPresentRequired') || 0;

		if (minRequired === 0 || presentCount >= minRequired) return;
		if (groups.pushUsers.length === 0 && groups.emailUsers.length === 0) return;

		const occDate = occ.getString('date');
		const title = `Il manque des participants — ${masterTitle}`;
		const body = `Occurrence du ${occDate} : ${presentCount}/${minRequired} présents.`;

		// Push: séquentiel (JSVM synchrone)
		for (const user of groups.pushUsers) {
			this.sendPushNotification(app, user, title, body, notifUrl);
		}

		// Email groupé
		if (groups.emailUsers.length > 0) {
			this.sendGroupedEmail(app, groups.emailUsers, title, body, notifUrl);
		}
	}
};
