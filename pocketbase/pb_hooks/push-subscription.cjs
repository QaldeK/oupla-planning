// @ts-nocheck — Fichier JSVM PocketBase, les globaux (Record, BadRequestError…) sont injectés par le runtime
/**
 * Cycle de vie des rows `push_subscriptions` (push multi-appareils).
 *
 * L'endpoint push d'un navigateur est l'identité canonique de l'appareil :
 * index unique en base, un appareil = un owner actif (le dernier user ayant
 * souscrit). Les navigateurs peuvent rotater les clés p256dh/auth
 * silencieusement — chaque sync réécrit donc les clés, pas seulement
 * l'ownership.
 */

module.exports = {
	/**
	 * Upsert idempotent d'une subscription par endpoint, tous users confondus.
	 * Transfère l'ownership à userId si la row appartient à un autre user.
	 *
	 * @param {object} app          — instance PocketBase ($app ou e.app)
	 * @param {string} userId       — user authentifié (nouveau owner)
	 * @param {object} subscription — PushSubscriptionJSON ({ endpoint, keys: { p256dh, auth } })
	 * @param {string} [userAgent]  — étiquette UX de l'appareil ; absente, le
	 *                                label existant est préservé (ne pas effacer
	 *                                une info utile sur un sync sans UA)
	 * @returns {object} le record sauvegardé
	 * @throws BadRequestError si endpoint ou keys.p256dh/auth manquent
	 */
	upsertSubscription(app, userId, subscription, userAgent) {
		const endpoint = String(subscription?.endpoint || '').trim();
		const p256dh = String(subscription?.keys?.p256dh || '').trim();
		const auth = String(subscription?.keys?.auth || '').trim();
		if (!endpoint || !p256dh || !auth) {
			throw new BadRequestError(
				'subscription.endpoint et subscription.keys.{p256dh,auth} sont requis'
			);
		}

		// Recherche tous users confondus : un appareil partagé (profil navigateur
		// commun) doit transférer son ownership, pas créer de doublon.
		const existing = app.findRecordsByFilter(
			'push_subscriptions',
			'endpoint = {:endpoint}',
			'',
			1,
			0,
			{ endpoint }
		);

		const record = existing.length
			? existing[0]
			: new Record(app.findCollectionByNameOrId('push_subscriptions'));

		record.set('user', userId);
		record.set('endpoint', endpoint);
		record.set('p256dh', p256dh);
		record.set('auth', auth);
		if (userAgent) record.set('user_agent', String(userAgent));
		record.set('refreshed_at', new Date().toISOString());
		app.save(record);
		return record;
	},

	/**
	 * Supprime la row d'un endpoint si (et seulement si) elle appartient à userId.
	 * 404 uniforme — row inexistante ou possédée par autrui : la subscription
	 * d'un autre user ne doit pas révéler son existence.
	 *
	 * @param {object} app      — instance PocketBase ($app ou e.app)
	 * @param {string} userId   — user authentifié appelant
	 * @param {string} endpoint — endpoint de la subscription à retirer
	 * @throws BadRequestError si endpoint est vide, NotFoundError sinon
	 */
	deleteSubscription(app, userId, endpoint) {
		const trimmed = String(endpoint || '').trim();
		if (!trimmed) throw new BadRequestError('endpoint est requis');

		const existing = app.findRecordsByFilter(
			'push_subscriptions',
			'endpoint = {:endpoint}',
			'',
			1,
			0,
			{ endpoint: trimmed }
		);

		if (!existing.length || existing[0].getString('user') !== userId) {
			throw new NotFoundError('Subscription introuvable');
		}
		app.delete(existing[0]);
	}
};
