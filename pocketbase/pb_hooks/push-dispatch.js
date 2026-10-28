/// <reference path="../pb_data/types.d.ts" />
/**
 * Dispatch push unifié pour les notifications.
 *
 * Factorise le pattern partagé entre le cron J-X (cron-notifications.pb.js)
 * et le hook d'update immédiat (notify-on-occurrence-update.pb.js) :
 *
 *   résoudre les destinataires → filtrer push:true → résoudre le user →
 *   construire title/body → envoyer.
 *
 * Les fonctions de domaine (buildPushTitle, buildPushBody) et l'adaptateur
 * d'envoi (sendPushNotification) sont injectés plutôt qu'importés via
 * require() — voir ADR-0007 : ces fonctions vivent dans des modules .js qui
 * ne peuvent pas être require()'d nativement par Node dans un test unitaire
 * (conflit "type":"module"). L'injection rend aussi le module testable
 * isolément (principe "accept dependencies, don't create them").
 *
 * Seul pb-helpers.cjs (parseJsonArray) est require()'d en interne : c'est
 * un .cjs, donc résolvable nativement par Node en test.
 */

const { parseJsonArray } = require(`${__hooks}/pb-helpers.cjs`);

/**
 * Envoie un push à chaque destinataire éligible d'un event.
 *
 * @param {object} app                      — instance PocketBase ($app ou e.app)
 * @param {object} opts
 * @param {object} opts.event               — plain object `{type, reminderValue, …}`
 * @param {core.Record} opts.master         — record planning_masters (lit participantToken, title)
 * @param {core.Record} opts.occ            — record planning_occurrence (lit date, startTime, tasks)
 * @param {Array} opts.recipients           — sortie de computeRecipients : `{userId, push, …}[]`
 * @param {function} opts.resolveUser       — `(userId) => userRecord | null`. Le cron passe
 *                                            une version cachée (un même user peut être
 *                                            destinataire de plusieurs events) ; le hook
 *                                            passe un lookup direct.
 * @param {function} [opts.onResult]        — `(userId, delivered, reason) => void`
 *                                            appelé après chaque tentative. `delivered`
 *                                            est vrai seulement si au moins un appareil
 *                                            a reçu le push ; `reason` vaut `'sent'`,
 *                                            `'no_device'` ou `'failed'`. Le cron s'en
 *                                            sert pour régler pushSentAt/pushWaivedAt —
 *                                            un userId sans callback est un user que
 *                                            resolveUser n'a pas résolu.
 * @param {function} opts.buildPushTitle    — `(event, master) => string`
 * @param {function} opts.buildPushBody     — `(event, occ, recipient, occTasks) => string`
 * @param {function} opts.sendPushNotification — `(app, user, title, body, url) => {attempted, sent, lookupFailed}`
 * @returns {number} nombre de destinataires ayant reçu le push sur au moins un appareil
 */
function dispatchPushForEvent(app, {
	event,
	master,
	occ,
	recipients,
	resolveUser,
	onResult,
	buildPushTitle,
	buildPushBody,
	sendPushNotification
}) {
	const occTasks = parseJsonArray(occ, 'tasks');
	const title = buildPushTitle(event, master);
	const url = `/p/${master.getString('participantToken')}`;

	let sent = 0;
	for (const r of recipients) {
		if (!r.push) continue;

		const user = resolveUser(r.userId);
		if (!user) continue;

		const body = buildPushBody(event, occ, r, occTasks);

		// L'adaptateur ne jette pas par contrat ; il rend le compte réel des
		// appareils sollicités et des réponses 200. Rendre la main n'est pas
		// livrer : seul `outcome.sent > 0` vaut envoi.
		let outcome = { attempted: 0, sent: 0, lookupFailed: false };
		try {
			outcome = { ...outcome, ...sendPushNotification(app, user, title, body, url) };
		} catch {
			// Exception inattendue de l'adaptateur (défaut de code, pas panne
			// réseau) : on la traite comme un échec de livraison.
			if (onResult) onResult(r.userId, false, 'failed');
			continue;
		}

		const delivered = outcome.sent > 0;
		if (delivered) sent++;
		if (onResult) {
			const reason = delivered
				? 'sent'
				: outcome.attempted === 0 && !outcome.lookupFailed
					? 'no_device'
					: 'failed';
			onResult(r.userId, delivered, reason);
		}
	}
	return sent;
}

module.exports = { dispatchPushForEvent };
