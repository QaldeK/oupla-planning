/// <reference path="../pb_data/types.d.ts" />

// Collection `notification_deliveries` — registre de livraison par destinataire :
// une ligne par paire (event, destinataire métier). Trace « quelle paire
// (event, user) a été servie » sur chaque canal : '' = dû, sinon envoyé ou
// waivé (opt-out, déjà lu, départ durable, clôture de mort).
//
// Sécurité : table interne écrite uniquement par le cron via saves
// programmatiques — toutes les API Rules verrouillées (non définies =
// superuser seulement).
//
// Cascades : `event` et `user` en cascadeDelete — la purge native des events
// (`app.delete()`, où les cascades sont un comportement runtime) et la
// suppression d'un compte emportent leurs lignes. `master` est dénormalisé
// pour le bucketing agrégé ; il n'a pas besoin de cascade propre, la
// suppression d'un master cascade déjà via notification_events.
//
// Porte avec l'index cavalier `push_subscriptions (user)` : lecturé à chaque
// envoi push et par la cascade de suppression d'un user, jusqu'ici sans index.

migrate((app) => {
	const eventsCollectionId = app.findCollectionByNameOrId('notification_events').id;
	const usersCollectionId = app.findCollectionByNameOrId('users').id;
	const mastersCollectionId = app.findCollectionByNameOrId('planning_masters').id;

	const collection = new Collection({
		type: 'base',
		name: 'notification_deliveries',
		fields: [
			{
				name: 'event',
				type: 'relation',
				required: true,
				maxSelect: 1,
				collectionId: eventsCollectionId,
				cascadeDelete: true
			},
			{
				name: 'user',
				type: 'relation',
				required: true,
				maxSelect: 1,
				collectionId: usersCollectionId,
				cascadeDelete: true
			},
			{
				name: 'master',
				type: 'relation',
				required: true,
				maxSelect: 1,
				collectionId: mastersCollectionId,
				cascadeDelete: false
			},
			{ name: 'emailSentAt', type: 'date' },
			{ name: 'emailWaivedAt', type: 'date' },
			{ name: 'pushSentAt', type: 'date' },
			{ name: 'pushWaivedAt', type: 'date' },
			// Champs système de traçabilité : une collection créée par migration
			// ne reçoit pas les autodate created/updated d'office (seul le
			// Dashboard les ajoute) — ils se déclarent explicitement.
			{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false, system: true },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true, system: true }
		],
		indexes: [
			'CREATE UNIQUE INDEX idx_notification_deliveries_event_user ON notification_deliveries (event, user)'
		]
	});
	app.save(collection);

	const pushSubs = app.findCollectionByNameOrId('push_subscriptions');
	pushSubs.indexes.push('CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user)');
	app.save(pushSubs);
}, (app) => {
	const collection = app.findCollectionByNameOrId('notification_deliveries');
	app.delete(collection);

	const pushSubs = app.findCollectionByNameOrId('push_subscriptions');
	pushSubs.indexes = pushSubs.indexes.filter(
		(idx) => idx.indexOf('idx_push_subscriptions_user') === -1
	);
	app.save(pushSubs);
});
