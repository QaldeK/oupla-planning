/// <reference path="../pb_data/types.d.ts" />

// Collection `push_subscriptions` — push multi-appareils : une row par appareil.
//
// Sécurité : l'endpoint push est une capability URL — toutes les API Rules
// filtrent sur `user = @request.auth.id`, aucune lecture croisée possible.
// L'index unique sur `endpoint` garantit qu'un appareil n'a qu'un owner actif
// (le dernier user ayant souscrit).
//
// `users.push_subscription` (JSON unique, un seul appareil) est conservé mais
// déprécié : un front ancien servi par le service worker peut encore y écrire
// pendant un cycle de déploiement. Sa suppression fera l'objet d'une migration
// de nettoyage ultérieure.

migrate((app) => {
	const usersCollectionId = app.findCollectionByNameOrId('users').id;

	const collection = new Collection({
		type: 'base',
		name: 'push_subscriptions',
		listRule: 'user = @request.auth.id',
		viewRule: 'user = @request.auth.id',
		createRule: 'user = @request.auth.id',
		updateRule: 'user = @request.auth.id',
		deleteRule: 'user = @request.auth.id',
		fields: [
			{
				name: 'user',
				type: 'relation',
				required: true,
				maxSelect: 1,
				collectionId: usersCollectionId,
				cascadeDelete: true
			},
			{ name: 'endpoint', type: 'text', required: true },
			{ name: 'p256dh', type: 'text', required: true },
			{ name: 'auth', type: 'text', required: true },
			{ name: 'user_agent', type: 'text' },
			{ name: 'refreshed_at', type: 'date' },
			// Champs système de traçabilité. PB 0.39 ne les ajoute pas
			// automatiquement : ils doivent être déclarés explicitement.
			{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false, system: true },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true, system: true }
		],
		indexes: [
			'CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint)'
		]
	});

	app.save(collection);

	// Backfill des subscriptions legacy. Le filtrage des null se fait côté JS :
	// la sémantique d'un filtre API sur un champ JSON (NULL vs 'null' vs '')
	// varie selon les versions PocketBase, et la table users est de taille
	// bornée. Un JSON invalide ou incomplet est loggé puis skippé — la migration
	// ne doit jamais échouer sur des données corrompues.
	const now = new Date().toISOString();
	const users = app.findRecordsByFilter('users', "id != ''", '', 0, 0);

	for (const user of users) {
		const raw = user.getString('push_subscription');
		if (!raw || raw === 'null') continue;

		try {
			const sub = JSON.parse(raw);
			if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
				throw new Error('endpoint ou keys.p256dh/auth manquant');
			}

			const record = new Record(collection);
			record.set('user', user.get('id'));
			record.set('endpoint', sub.endpoint);
			record.set('p256dh', sub.keys.p256dh);
			record.set('auth', sub.keys.auth);
			record.set('user_agent', 'migré');
			record.set('refreshed_at', now);
			app.save(record);
		} catch (err) {
			app.logger().warn(
				'[Migration] push_subscription invalide — ignoré',
				'err',
				err?.message || String(err),
				'userId',
				user.get('id')
			);
		}
	}
}, (app) => {
	const collection = app.findCollectionByNameOrId('push_subscriptions');
	app.delete(collection);
});
