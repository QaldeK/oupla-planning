// @ts-nocheck — Fichier JSVM PocketBase, les globaux (Record) sont injectés par le runtime
/**
 * Producteur des events de notification — seule porte d'écriture de la table
 * `notification_events`, plus résolution du contexte master et des noms d'affichage.
 *
 * Consomme par le hook occurrence-update, le cron quotidien et planning-deletion,
 * qui ne sont plus que des câblages → détecteurs → ce module.
 *
 * Contrats :
 *  - `app` est TOUJOURS injecté (jamais `$app` en interne) : dans un hook, `e.app`
 *    est l'app transactionnelle — un `$app` capturé deadlockerait sur le writer
 *    lock SQLite quand le save parent est en transaction.
 *  - Aucun état au niveau module : les modules JSVM sont évalués une fois et
 *    partagés entre les runtimes du pool — le cache du résolveur vit sur
 *    l'instance créée par invocation (hook handler / cron run).
 *  - `insertEvent` jette : la politique d'erreur (avaler en loggant riche côté
 *    hook, compter côté cron) appartient aux callers.
 */

module.exports = {
	/**
	 * Insérer une row `notification_events`.
	 *
	 * @param {core.App} app — `$app` (cron) ou `e.app` (hook, tx-scoped)
	 * @param {object} event — `{ type, master, occurrence, reminderValue,
	 *        changedBy, payload }` ; `payload` absent → null
	 * @returns {Record} la row sauvegardée
	 * @throws si la collection ou le save échoue — le caller loggue son contexte
	 */
	insertEvent(app, event) {
		const collection = app.findCollectionByNameOrId("notification_events");
		const record = new Record(collection);
		record.set("type", event.type);
		record.set("master", event.master);
		record.set("occurrence", event.occurrence);
		record.set("reminderValue", event.reminderValue);
		record.set("changedBy", event.changedBy);
		record.set("payload", event.payload ?? null);
		app.save(record);
		return record;
	},

	/**
	 * Fabriquer un résolveur de contexte master, à raison d'une instance par
	 * invocation (hook handler ou run cron). Les occurrences d'un même run
	 * partagent le cache ; deux runs ne partagent rien (records-snapshots stale).
	 *
	 * @param {core.App} app
	 * @returns {(masterId: string) => {master: Record, participants: Record[] | null} | null}
	 *          null = master introuvable OU soft-deleté — les callers traitent
	 *          les deux cas de la même façon : pas d'event, pas de push.
	 *          `participants: null` = lecture des participants échouée (loggée
	 *          ici) : au caller de décider — `[]` veut dire « aucun participant »,
	 *          `null` veut dire « indéterminé » (push sauté, détection cron sautée,
	 *          jamais confondu avec l'absence d'opt-in).
	 */
	createMasterContextResolver(app) {
		const cache = new Map();
		return (masterId) => {
			if (cache.has(masterId)) return cache.get(masterId);
			let ctx = null;
			let master = null;
			try {
				master = app.findRecordById("planning_masters", masterId);
			} catch {
				// Master introuvable : cas de course normal (purge après delete) —
				// pas de log, la gate fait son travail.
				master = null;
			}
			if (master && !master.getBool("deleted")) {
				let participants = null;
				try {
					participants = app.findRecordsByFilter(
						"planning_participants",
						"planning = {:masterId}",
						"",
						0,
						0,
						{ masterId }
					);
				} catch (err) {
					// Panne de lecture : signalée par `null` et loggée, jamais
					// déguisée en « aucun participant » (faux négatif silencieux).
					app.logger().error(
						"[Notification] participants lookup failed",
						"err",
						err?.message || String(err),
						"masterId",
						masterId
					);
				}
				ctx = { master, participants };
			}
			cache.set(masterId, ctx);
			return ctx;
		};
	},

	/**
	 * Nom affichable d'un userId : `name || email || fallback`.
	 * uid vide ou user introuvable → fallback (jamais null) — l'appelant choisit
	 * son label dégradé (uid brut pour la traçabilité, `UNKNOWN_AUTHOR` pour les emails).
	 *
	 * @param {core.App} app
	 * @param {string} uid
	 * @param {string} fallback
	 * @returns {string}
	 */
	resolveUserName(app, uid, fallback) {
		if (!uid) return fallback;
		try {
			const user = app.findRecordById("users", uid);
			return user.getString("name") || user.getString("email") || fallback;
		} catch {
			return fallback;
		}
	}
};
