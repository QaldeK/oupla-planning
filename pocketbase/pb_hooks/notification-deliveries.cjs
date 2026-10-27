// @ts-nocheck — Fichier JSVM PocketBase, le global Record est injecté par le runtime
/**
 * Porte d'écriture du registre `notification_deliveries` (une ligne par paire
 * event/destinataire) + lecture par event.
 *
 * Contrats : `app` est TOUJOURS injecté (jamais `$app` en interne — deadlock
 * du writer lock SQLite dans un hook transactionnel) ; les helpers jettent en
 * cas d'échec de save — la politique d'erreur (compter, logger, continuer)
 * appartient au cron. `now` est injecté par le caller : toutes les marques
 * d'un run partagent le même timestamp.
 *
 * Un réglage n'est JAMAIS écrasé : un email parti ne repart pas, un waive
 * (opt-out, départ durable) n'est pas réversible. Les helpers renvoient
 * false sans toucher la row si le canal est déjà réglé.
 */

module.exports = {
	/**
	 * Version plain des quatre marques d'une row, lisible par la politique
	 * pure de notification-consumer.js.
	 */
	toPlain(row) {
		return {
			emailSentAt: row.getString('emailSentAt'),
			emailWaivedAt: row.getString('emailWaivedAt'),
			pushSentAt: row.getString('pushSentAt'),
			pushWaivedAt: row.getString('pushWaivedAt')
		};
	},

	/** Toutes les lignes d'un event, dues comme réglées. */
	findByEvent(app, eventId) {
		return app.findRecordsByFilter(
			'notification_deliveries',
			'event = {:event}',
			'created',
			0,
			0,
			{ event: eventId }
		);
	},

	/**
	 * Upsert indexé (event, user). À la création, `waivePush` pose
	 * pushWaivedAt d'emblée — types non-J-X : leur push immédiat est fait par
	 * le hook occurrence-update, le cron ne les re-pousse jamais.
	 *
	 * @param {core.App} app
	 * @param {object} p — `{ eventId, userId, masterId }`
	 * @param {string} now — timestamp du run (format PocketBase)
	 * @param {boolean} waivePush
	 * @returns {{row: core.Record, created: boolean}}
	 * @throws si le save échoue (caller loggue)
	 */
	upsertDelivery(app, { eventId, userId, masterId }, now, waivePush) {
		let row = null;
		try {
			row = app.findFirstRecordByFilter(
				'notification_deliveries',
				'event = {:event} && user = {:user}',
				{ event: eventId, user: userId }
			);
		} catch {
			/* sql.ErrNoRows — pas encore de ligne, on la crée */
		}
		if (row) return { row, created: false };

		const collection = app.findCollectionByNameOrId('notification_deliveries');
		row = new Record(collection);
		row.set('event', eventId);
		row.set('user', userId);
		row.set('master', masterId);
		row.set('emailSentAt', '');
		row.set('emailWaivedAt', '');
		row.set('pushSentAt', '');
		row.set('pushWaivedAt', waivePush ? now : '');
		app.save(row);
		return { row, created: true };
	},

	/**
	 * Règle le canal email : sent → emailSentAt, sinon emailWaivedAt.
	 * @returns {boolean} true si la row a été modifiée et sauvegardée
	 */
	settleEmail(app, row, now, sent) {
		if (row.getString('emailSentAt') || row.getString('emailWaivedAt')) return false;
		row.set(sent ? 'emailSentAt' : 'emailWaivedAt', now);
		app.save(row);
		return true;
	},

	/**
	 * Règle le canal push : sent → pushSentAt, sinon pushWaivedAt.
	 * @returns {boolean} true si la row a été modifiée et sauvegardée
	 */
	settlePush(app, row, now, sent) {
		if (row.getString('pushSentAt') || row.getString('pushWaivedAt')) return false;
		row.set(sent ? 'pushSentAt' : 'pushWaivedAt', now);
		app.save(row);
		return true;
	},

	/**
	 * Clôture d'un canal resté dû : waive email si dû ; waive push si dû.
	 * Utilisé par les clôtures (mort de l'event, clôture résiduelle) où le
	 * push a normalement déjà été réglé au fan-out — le waive push n'est
	 * qu'un filet pour la fenêtre d'échec de save du run de fan-out.
	 */
	closePending(app, row, now) {
		this.settleEmail(app, row, now, false);
		this.settlePush(app, row, now, false);
	}
};
