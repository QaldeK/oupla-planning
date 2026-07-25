// @ts-nocheck — Fichier JSVM PocketBase, les globaux ($http, MailerMessage, etc.) sont injectés par le runtime
/**
 * Utilitaires partagés pour les notifications.
 *
 * Fournit :
 *  - formatDateFR          : formatage de date FR court
 *  - sendPushNotification  : envoi push à un user (HTTP synchrone vers notify-service)
 *  - sendIndividualEmail   : envoi email multipart (HTML + texte) à un user unique
 */

module.exports = {
	// ============================================================================
	// FORMATTAGE
	// ============================================================================

	/**
	 * Formater une date ISO en format court français.
	 * "2026-03-31" → "mar. 31 mars"
	 *
	 * NB : n'utilise PAS `toLocaleDateString` car la JSVM Goja de PocketBase
	 * n'implémente pas correctement `Intl` — le résultat tombe en format US
	 * (MM/DD/YYYY) quelle que soit la locale demandée. Un mapping manuel des
	 * jours et mois garantit le format français.
	 */
	formatDateFR(dateStr) {
		try {
			// PocketBase expose parfois la date au format SQL "YYYY-MM-DD HH:MM:SS.000Z".
			// On extrait la partie YYYY-MM-DD pour construire une date UTC valide.
			const iso = String(dateStr).split(' ')[0].split('T')[0];
			const parts = iso.split('-');
			if (parts.length !== 3) return dateStr;
			const m = parseInt(parts[1], 10);
			const d = parseInt(parts[2], 10);
			if (Number.isNaN(m) || Number.isNaN(d)) return dateStr;

			const jours = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
			const mois = [
				'janv.', 'févr.', 'mars', 'avril', 'mai', 'juin',
				'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'
			];

			const date = new Date(iso + 'T00:00:00Z');
			const wd = jours[date.getUTCDay()] ?? '';
			const monthLabel = mois[m - 1] ?? parts[1];

			return `${wd} ${d} ${monthLabel}`;
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
	 *
	 * Lecture du champ JSON via getString() + JSON.parse() : en JSVM (Goja),
	 * record.get() retourne les bytes Go bruts ([]byte → Array<number>),
	 * ce qui sérialise en HTTP comme un tableau de nombres et fait échouer
	 * web-push côté notify-service avec "subscription with at least an endpoint".
	 */
	sendPushNotification(app, user, title, body, url) {
		const subRaw = user.getString('push_subscription');
		if (!subRaw) return;

		let sub;
		try {
			sub = JSON.parse(subRaw);
		} catch (err) {
			app.logger().error(
				'[Notification] push_subscription JSON invalide',
				'err',
				err?.message || String(err),
				'userId',
				user.get('id')
			);
			return;
		}

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
	 * Envoyer un email multipart (HTML + texte) à un destinataire unique.
	 *
	 * L'envoi individuel (vs TO+CC) garantit la privacy des destinataires
	 * (aucune fuite d'emails entre participants) et la délivrabilité
	 * (1 message = 1 RCPT, moins de spam filtering).
	 *
	 * @param {object} app            — instance PocketBase ($app ou e.app)
	 * @param {object} user           — record auth user (doit exposer email() et get('id'))
	 * @param {string} subject        — sujet de l'email
	 * @param {string} html           — corps HTML
	 * @param {string} text           — corps texte brut (fallback clients non-HTML)
	 * @param {object} [opts]         — options
	 * @param {object} [opts.headers] — headers additionnels (ex: Reply-To,
	 *                                  X-Entity-Ref-ID pour la dedup mailbox)
	 *
	 * Sur erreur SMTP : log zerolog + **rethrow** pour permettre au caller
	 * d'incrémenter `attempts` et décider du retry.
	 */
	sendIndividualEmail(app, user, subject, html, text, opts = {}) {
		const settings = app.settings();
		const message = new MailerMessage({
			from: {
				address: settings.meta.senderAddress,
				name: settings.meta.senderName || 'Oupla Planning'
			},
			to: [{ address: user.email() }],
			subject,
			html,
			text,
			headers: opts.headers || {}
		});

		try {
			app.newMailClient().send(message);
		} catch (err) {
			// zerolog exige des paires 'clé', valeur : sans clé, err partirait dans
			// un champ `!BADKEY` et serait invisible dans les logs.
			app
				.logger()
				.error(
					'[Notification] SMTP send failed',
					'err',
					err?.message || String(err),
					'userId',
					user.get('id'),
					'subject',
					subject
				);
			throw err;
		}

		app.logger().info('[Notification] Email sent', 'userId', user.get('id'), 'subject', subject);
	}
};
