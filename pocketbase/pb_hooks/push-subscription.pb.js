/// <reference path="../pb_data/types.d.ts" />
// @ts-nocheck — Fichier JSVM PocketBase, les globaux (routerAdd, ApiError…) sont injectés par le runtime

// Routes POST/DELETE /api/push-subscription — cycle de vie des subscriptions
// push multi-appareils. Logique métier dans push-subscription.cjs.
//
// Pourquoi une route dédiée : l'upsert par endpoint doit pouvoir transférer
// l'ownership d'une row à un autre user (profil navigateur partagé), ce que
// les API Rules (`user = @request.auth.id`) ne peuvent pas exprimer — elles
// verrouillent précisément ce transfert. Précédent : /api/delete-account.
//
// Sémantique :
//   POST   — upsert idempotent par endpoint, tous users confondus. Row
//            trouvée → ré-assignée à l'appelant (clés, user_agent,
//            refreshed_at rafraîchis) ; absente → créée.
//   DELETE — retire la row de cet endpoint uniquement si elle appartient à
//            l'appelant ; 404 uniforme sinon (ne pas révéler l'existence
//            d'une subscription d'autrui, même logique que le deleteRule).
//
// Opération mono-row : pas de transaction (contrairement à /api/delete-account
// qui cascade sur plusieurs collections).

routerAdd('POST', '/api/push-subscription', (e) => {
	if (!e.auth) throw new ApiError(401, 'Auth required');
	if (e.auth.collection().name !== 'users') throw new ApiError(400, 'Invalid auth context');

	const { upsertSubscription } = require(`${__hooks}/push-subscription.cjs`);
	const body = e.requestInfo().body || {};

	const record = upsertSubscription(e.app, e.auth.id, body.subscription, body.userAgent);

	return e.json(200, { record: record.publicExport() });
});

routerAdd('DELETE', '/api/push-subscription', (e) => {
	if (!e.auth) throw new ApiError(401, 'Auth required');
	if (e.auth.collection().name !== 'users') throw new ApiError(400, 'Invalid auth context');

	const { deleteSubscription } = require(`${__hooks}/push-subscription.cjs`);
	const body = e.requestInfo().body || {};

	deleteSubscription(e.app, e.auth.id, body.endpoint);

	return e.json(200, { success: true });
});
