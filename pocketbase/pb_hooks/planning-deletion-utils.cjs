// @ts-nocheck — Fichier JSVM PocketBase, les globaux ($os, ApiError, etc.) sont injectés par le runtime
/**
 * Utilitaires du cycle de vie soft-delete des plannings.
 *
 * Partagé entre les hooks de planning-deletion.pb.js (gardes lecture seule,
 * détection de transitions, cron de purge). Les handlers JSVM s'exécutent dans
 * des contextes isolés : toute fonction réutilisée doit vivre dans ce module
 * et y être require()-ée.
 */

const { formatDateFR } = require(`${__hooks}/notify-utils.cjs`);
const { parseJsonArray } = require(`${__hooks}/pb-helpers.cjs`);

/** Durée de la fenêtre de grâce entre soft-delete et purge définitive. */
const GRACE_PERIOD_DAYS = 15;

/**
 * Base publique des liens des emails. Lue dans PUBLIC_BASE_URL à chaque appel,
 * sans cache au chargement du module — pilotable sans redémarrer PocketBase.
 * Le garde typeof garde le module chargeable hors JSVM (tests Node).
 */
function publicBaseUrl() {
	const env = typeof $os !== 'undefined' ? $os.getenv('PUBLIC_BASE_URL') : '';
	return (env || 'https://planning.oupla.net').replace(/\/+$/, '');
}

/** Timestamp courant au format date PocketBase "YYYY-MM-DD HH:MM:SS.mmmZ". */
function nowPbDate() {
	return new Date().toISOString().replace('T', ' ');
}

/**
 * Date de purge = deletedAt + GRACE_PERIOD_DAYS jours. Retourne null si
 * deletedAt est absent/invalide (le cron filtre ces rows ; l'email affiche
 * alors la fenêtre de grâce sans date précise).
 */
function computePurgeDate(deletedAt) {
	if (!deletedAt) return null;
	// Format PB "YYYY-MM-DD HH:MM:SS.mmmZ" ou ISO — l'espace devient un T.
	const base = new Date(String(deletedAt).trim().replace(' ', 'T')).getTime();
	if (Number.isNaN(base)) return null;
	const purge = new Date(base);
	purge.setUTCDate(purge.getUTCDate() + GRACE_PERIOD_DAYS);
	return purge;
}

/**
 * Destinataires des emails de suppression/restauration : participants avec un
 * compte lié et actifs. Événement terminal — les préférences
 * planning_participants (email/push) sont volontairement ignorées : un
 * participant doit savoir que le planning disparaît, même notifications coupées.
 */
function extractDeletionRecipients(master) {
	const participants = parseJsonArray(master, 'participants');
	const recipients = [];
	for (const p of participants) {
		if (!p || !p.userId || p.hasQuit) continue;
		recipients.push({ userId: p.userId, name: p.name || '' });
	}
	return recipients;
}

/**
 * Throw 403 si le master lié est soft-deleté (freeze des writes sur les
 * collections dépendantes). Master introuvable : silence — la relation sera de
 * toute façon rejetée par la validation native.
 */
function assertMasterNotDeleted(app, masterId, label) {
	if (!masterId) return;
	let master;
	try {
		master = app.findRecordById('planning_masters', masterId);
	} catch {
		return;
	}
	if (master.getBool('deleted')) {
		throw new ApiError(403, `Planning is deleted — ${label} are read-only`);
	}
}

/** Échappe les caractères HTML pour éviter injection / cassure de layout. */
function escapeHtml(text) {
	if (text === null || text === undefined) return '';
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** URL participant du planning (vue lecture seule/participant). */
function planningUrl(master) {
	return `${publicBaseUrl()}/p/${master.getString('participantToken')}`;
}

/** Squelette HTML commun (même style sobre que notify-templates.js). */
function layout(title, contentHtml, ctaLabel, url) {
	const safeTitle = escapeHtml(title);
	const safeUrl = escapeHtml(url);
	return [
		'<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1f2937;font-size:15px;line-height:1.5;max-width:560px;margin:0 auto;">',
		'<p style="font-size:13px;color:#6b7280;margin:0 0 4px;">Oupla Planning</p>',
		`<h1 style="font-size:20px;margin:0 0 8px;font-weight:600;">${safeTitle}</h1>`,
		contentHtml,
		`<p style="margin:24px 0 16px;"><a href="${safeUrl}" style="display:inline-block;padding:10px 20px;background-color:#3b82f6;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">${escapeHtml(ctaLabel)}</a></p>`,
		'<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">',
		`<p style="font-size:12px;color:#9ca3af;margin:0;">Vous recevez cet email car vous êtes inscrit·e au planning « ${safeTitle} ».</p>`,
		'</div>'
	].join('\n');
}

/**
 * Email « planning supprimé » : titre, auteur, passage en lecture seule et date
 * de suppression définitive.
 *
 * @param {core.Record} master       — record planning_masters (deleted=true)
 * @param {string} authorName        — auteur de la suppression
 * @param {string} purgeDateStr      — date de purge (ISO ou YYYY-MM-DD), pré-formatée
 * @returns {{subject, html, text}}
 */
function buildDeletedEmail(master, authorName, purgeDateStr) {
	const title = master.getString('title') || 'Planning';
	const author = authorName || 'un·e administrateur·ice';
	const url = planningUrl(master);
	const purgeLine = purgeDateStr
		? `Suppression définitive le ${formatDateFR(String(purgeDateStr).split('T')[0])} (restauration possible jusque-là).`
		: 'Le planning sera définitivement supprimé après la fenêtre de grâce de 15 jours.';

	const subject = `Planning « ${title} » supprimé`;
	const html = layout(
		`Planning « ${title} » supprimé`,
		[
			`<p style="margin:0 0 8px;">Supprimé par ${escapeHtml(author)}.</p>`,
			'<p style="margin:0 0 8px;">Le planning est en lecture seule : il n\'est plus possible d\'y répondre ni de le modifier.</p>',
			`<p style="margin:0 0 8px;">${escapeHtml(purgeLine)}</p>`
		].join('\n'),
		'Consulter le planning (lecture seule)',
		url
	);
	const text = [
		'Oupla Planning',
		'',
		`Planning « ${title} » supprimé`,
		'',
		`Supprimé par ${author}.`,
		"Le planning est en lecture seule : il n'est plus possible d'y répondre ni de le modifier.",
		purgeLine,
		'',
		`Consulter le planning (lecture seule) : ${url}`
	].join('\n');
	return { subject, html, text };
}

/**
 * Email « planning restauré » : titre, auteur, retour à l'activité normale.
 *
 * @param {core.Record} master — record planning_masters (deleted=false)
 * @param {string} authorName  — auteur de la restauration
 * @returns {{subject, html, text}}
 */
function buildRestoredEmail(master, authorName) {
	const title = master.getString('title') || 'Planning';
	const author = authorName || 'un·e administrateur·ice';
	const url = planningUrl(master);

	const subject = `Planning « ${title} » restauré`;
	const html = layout(
		`Planning « ${title} » restauré`,
		[
			`<p style="margin:0 0 8px;">Restauré par ${escapeHtml(author)}.</p>`,
			'<p style="margin:0 0 8px;">Le planning est à nouveau actif, vous pouvez de nouveau répondre.</p>'
		].join('\n'),
		'Consulter le planning',
		url
	);
	const text = [
		'Oupla Planning',
		'',
		`Planning « ${title} » restauré`,
		'',
		`Restauré par ${author}.`,
		'Le planning est à nouveau actif, vous pouvez de nouveau répondre.',
		'',
		`Consulter le planning : ${url}`
	].join('\n');
	return { subject, html, text };
}

module.exports = {
	GRACE_PERIOD_DAYS,
	publicBaseUrl,
	nowPbDate,
	computePurgeDate,
	extractDeletionRecipients,
	assertMasterNotDeleted,
	buildDeletedEmail,
	buildRestoredEmail
};
