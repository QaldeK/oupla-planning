// @ts-nocheck — Fichier JSVM PocketBase, les globaux ($http, MailerMessage, etc.) sont injectés par le runtime
/**
 * Utilitaires partagés pour les notifications.
 *
 * Fournit :
 *  - formatDateFR          : formatage de date FR court
 *  - sendPushNotification  : envoi push multi-appareils à un user (HTTP synchrone vers notify-service)
 *  - sendIndividualEmail   : envoi email multipart (HTML + texte) à un user unique
 */

/**
 * Base publique des liens envoyés (URL de clic des push). Lue dans
 * PUBLIC_BASE_URL à chaque appel, sans cache au chargement du module —
 * pilotable sans redémarrer PocketBase (même contrat que NOTIFY_SERVICE_URL).
 * Le garde typeof garde le module chargeable hors JSVM (tests unitaires Node,
 * où $os n'existe pas).
 */
function publicBaseUrl() {
	const env = typeof $os !== 'undefined' ? $os.getenv('PUBLIC_BASE_URL') : '';
	return (env || 'https://planning.oupla.net').replace(/\/+$/, '');
}

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
	 * Envoyer une notification push à TOUS les appareils d'un user.
	 *
	 * Un appareil = une row `push_subscriptions`. Pour chaque row : POST
	 * synchrone vers notify-service ($http.send est synchrone en JSVM, pas de
	 * Promise). Une row morte (réponse 410/404) est supprimée individuellement —
	 * les autres appareils du user restent notifiés.
	 *
	 * endpoint/p256dh/auth sont des champs text : lecture directe via
	 * getString(). Le pattern getString()+JSON.parse() ne concerne que les
	 * champs JSON, dont record.get() retourne les bytes Go bruts en JSVM.
	 *
	 * L'URL du notify-service est lue dans NOTIFY_SERVICE_URL à CHAQUE appel
	 * (défaut : service Docker interne) — sans cache au chargement du module,
	 * pour rester pilotable sans redémarrer PocketBase. La base de l'URL de clic
	 * suit le même contrat via PUBLIC_BASE_URL (défaut : domaine public).
	 *
	 * Ne throw jamais : chaque itération est isolée, les erreurs sont logguées.
	 */
	sendPushNotification(app, user, title, body, url) {
		const userId = user.get('id');

		let rows;
		try {
			rows = app.findRecordsByFilter(
				'push_subscriptions',
				'user = {:userId}',
				'',
				0,
				0,
				{ userId }
			);
		} catch (err) {
			app.logger().error(
				'[Notification] push_subscriptions lookup failed',
				'err',
				err?.message || String(err),
				'userId',
				userId
			);
			return;
		}
		// Aucun appareil souscrit → envoi silencieux
		if (!rows || rows.length === 0) return;

		const notifyUrl =
			$os.getenv('NOTIFY_SERVICE_URL') || 'http://services-notifyservice-rbwdvg:3001/notify';

		for (const row of rows) {
			const sub = {
				endpoint: row.getString('endpoint'),
				keys: {
					p256dh: row.getString('p256dh'),
					auth: row.getString('auth')
				}
			};

			try {
				const res = $http.send({
					method: 'POST',
					url: notifyUrl,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						subscription: sub,
						title,
						body,
						url: `${publicBaseUrl()}${url}`
					}),
					timeout: 10
				});

				// Subscription expirée ou révoquée : supprimer uniquement la row de
				// CET appareil, les autres appareils du user restent notifiés.
				if (res.statusCode === 410 || res.statusCode === 404) {
					app.logger().info(
						'[Notification] Subscription expirée, nettoyage',
						'userId',
						userId,
						'endpoint',
						sub.endpoint
					);
					try {
						app.delete(row);
					} catch (cleanupErr) {
						app
							.logger()
							.error(
								'[Notification] Erreur nettoyage subscription',
								'err',
								cleanupErr?.message || cleanupErr,
								'userId',
								'endpoint',
								sub.endpoint
							);
					}
					continue;
				}

				if (res.statusCode !== 200) {
					app.logger().error(
						'[Notification] Push error',
						'status',
						res.statusCode,
						'userId',
						userId,
						'url',
						url
					);
					continue;
				}

				app.logger().info('[Notification] Push sent', 'userId', userId);
			} catch (err) {
				// L'échec d'un appareil n'interrompt pas l'envoi aux autres.
				app.logger().error(
					'[Notification] Push HTTP error',
					'err',
					err?.message || err,
					'userId',
					userId,
					'endpoint',
					sub.endpoint
				);
			}
		}
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
