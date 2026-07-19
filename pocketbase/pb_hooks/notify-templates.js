// @ts-nocheck — Fichier JSVM PocketBase, les globaux sont injectés par le runtime
/**
 * Templates des emails de notification.
 *
 * Architecture : un email agrégé par (master, user) par passage cron.
 * Le corps est structuré par occurrence (1 bloc par occ concernée par ≥1 event
 * pour le destinataire), pas par type — un même user peut cumuler plusieurs
 * events pour la même occ.
 *
 * Séparation des préoccupations :
 *   - Ce module ne lit **pas** la DB directement. Il consomme des events déjà
 *     filtrés pour le destinataire, et un `ctx` contenant les caches nécessaires
 *     (occurrences, users, responses, participants). Le cron construit ce `ctx`
 *     et applique le filtrage runtime des prefs.
 *   - Les events sont des objets JS simples `{ type, occurrence, master,
 *     reminderValue, changedBy, payload }` (shape de `notification_events`).
 *
 * Fonctionnalités :
 *   - Sujet adaptatif (1 occ → type label, N occs → pluriel ou Important/Récap)
 *   - Regroupement par occurrence, tri par date
 *   - Lignes internes par catégorie (cancel, change, confirmation, missings, reminder)
 *   - Rendu HTML sobre (CSS inline) et texte brut (fallback)
 *   - Footer avec lien vers le planning
 */

const { formatDateFR } = require(`${__hooks}/notify-utils.js`);

// ============================================================================
// Constantes
// ============================================================================

/**
 * Mapping type DB → catégorie de template. Plusieurs types DB peuvent
 * converger vers une même catégorie (ex: `status_canceled` et
 * `status_deleted` sont tous deux rendus comme une annulation, la
 * distinction se faisant au niveau du payload/libellé).
 *
 * Types non évidents :
 *   - `status_deleted` → `cancel` (suppression ≈ annulation, plus fort).
 *   - `status_confirmed` → `change` (fallback défensif, peu utilisé en
 *     pratique : la confirmation d'occ est exposée via `confirmation_needed`
 *     côté admin, et le changement de `isConfirmed` déclenche plutôt un
 *     `schedule_change` côté hook).
 *   - `task_unassigned` → `missings` (ligne `Tâches à pourvoir : ...`).
 */
const TYPE_CATEGORY = {
	status_canceled: 'cancel',
	status_deleted: 'cancel',
	schedule_change: 'change',
	status_confirmed: 'change',
	quorum_missing: 'missings',
	task_unassigned: 'missings',
	reminder: 'reminder',
	confirmation_needed: 'confirmation'
};

/** Priorité de catégorie (plus petit = plus prioritaire dans un bloc). */
const CATEGORY_PRIORITY = {
	cancel: 0,
	change: 1,
	confirmation: 2,
	missings: 3,
	reminder: 4
};

/** Emoji par catégorie — préfixe du bloc occurrence. */
const CATEGORY_EMOJI = {
	cancel: '❌',
	change: '✏️',
	confirmation: '✅',
	missings: '⚠️',
	reminder: '🔔'
};

/** Libellé singulier pour le sujet d'un event unique. */
const CATEGORY_SUBJECT_LABEL = {
	cancel: 'Annulation',
	change: 'Modification',
	confirmation: 'À confirmer',
	missings: 'Participants manquants',
	reminder: 'Rappel'
};

/** Libellé pluriel pour le sujet de N events même catégorie. */
const CATEGORY_SUBJECT_PLURAL = {
	cancel: 'annulations',
	change: 'modifications',
	confirmation: 'événements à confirmer',
	missings: 'alertes de participants manquants',
	reminder: 'rappels'
};

/** Map clé `tasks[].type` → label français pour le rendu des tâches. */
const TASK_TYPE_LABEL = {
	beforeEvent: 'avant',
	onEvent: 'pendant',
	afterEvent: 'après'
};

/**
 * Seuils de liste : au-delà de 3 blocs occurrence, seuls les 3 premiers
 * sont détaillés, suivi de la ligne `+ N autres — voir le planning`.
 */
const DETAILED_BLOCKS = 3;

/** Troncature des descriptions longues. */
const MAX_DESC_LENGTH = 300;

/** Fallback générique si `changedBy` vide ou user introuvable. */
const UNKNOWN_AUTHOR = 'un·e administrateur·rice';

/** Marqueur non-confirmation affiché en fin de bloc reminder. */
const NON_CONFIRME_NOTE = 'ℹ Non encore confirmé par un·e administrateur·rice';

// ============================================================================
// Helpers (exportés pour tests)
// ============================================================================

/**
 * Tronque un texte à `maxLen` caractères avec ellipsis.
 * Préserve les mots : coupe au dernier espace avant la limite.
 */
function _truncate(text, maxLen) {
	if (!text) return '';
	const str = String(text).trim();
	if (str.length <= maxLen) return str;
	const cut = str.slice(0, maxLen - 1);
	const lastSpace = cut.lastIndexOf(' ');
	return (lastSpace > maxLen * 0.7 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Résout `changedBy` (userId PB ou chaîne vide) en nom lisible.
 * Fallback `UNKNOWN_AUTHOR` si vide, introuvable dans `ctx.userNamesById`,
 * ou sans cache fourni. N'expose jamais l'email.
 */
function _resolveAuthor(changedBy, ctx) {
	if (!changedBy) return UNKNOWN_AUTHOR;
	const names = ctx && ctx.userNamesById;
	if (!names) return UNKNOWN_AUTHOR;
	const name = names.get(changedBy);
	return name || UNKNOWN_AUTHOR;
}

/** Map une clé `tasks[].type` (`beforeEvent`/`onEvent`/`afterEvent`) → label FR. */
function _resolveTaskType(taskTypeKey) {
	return TASK_TYPE_LABEL[taskTypeKey] || taskTypeKey || '';
}

/**
 * Formate une heure "19:00" → "19h00". Tolérant sur plusieurs formats
 * d'entrée ("19:00:00", "19h00", "7:00 PM" non géré — l'app utilise HH:MM).
 */
function _formatTime(rawTime) {
	if (!rawTime) return '';
	const m = String(rawTime).match(/^(\d{1,2}):(\d{2})/);
	if (!m) return String(rawTime);
	return `${m[1]}h${m[2]}`;
}

/**
 * Formate la ligne d'en-tête d'un bloc occ :
 *   - Cas général : `{date} à {start}h — {place}` (ex: "mar. 31 mars à 19h00 — Salle des fêtes")
 *   - Cas cancel : `{date}` seul (horaire/lieu non pertinents sur occ annulée)
 */
function _formatOccLine(occ, isCanceled) {
	const date = formatDateFR(occ.getString('date'));
	if (isCanceled) return date;
	const time = _formatTime(occ.getString('startTime'));
	const place = occ.getString('place') || '';
	const head = time ? `${date} à ${time}` : date;
	return place ? `${head} — ${place}` : head;
}

// ============================================================================
// Renderers par event — retournent 1+ lignes string, ou [] si l'event
// ne doit rien afficher pour ce destinataire (ex: reminder filtré runtime).
// ============================================================================

/** `cancel` → "Annulé par Sarah" (ou "Supprimé par …" pour status_deleted). */
function _renderCancelLine(event, ctx) {
	const author = _resolveAuthor(event.changedBy, ctx);
	if (event.type === 'status_deleted') return `Supprimé par ${author}`;
	return `Annulé par ${author}`;
}

/**
 * `change` (schedule_change) → "Modifié par {author} : ...".
 * Le payload contient les champs avant/après modifiés. On rend une ligne
 * par dimension modifiée (date, horaire, lieu) — en pratique le hook
 * n'en insère qu'une par event, mais on reste défensif.
 */
function _renderChangeLine(event, ctx) {
	const author = _resolveAuthor(event.changedBy, ctx);
	const p = event.payload || {};
	const parts = [];
	if (p.oldDate && p.newDate && p.oldDate !== p.newDate) {
		parts.push(`${formatDateFR(p.oldDate)} → ${formatDateFR(p.newDate)}`);
	}
	if (p.oldStartTime && p.newStartTime && p.oldStartTime !== p.newStartTime) {
		parts.push(`${_formatTime(p.oldStartTime)} → ${_formatTime(p.newStartTime)}`);
	}
	if (p.oldEndTime && p.newEndTime && p.oldEndTime !== p.newEndTime) {
		parts.push(`fin ${_formatTime(p.oldEndTime)} → ${_formatTime(p.newEndTime)}`);
	}
	if (p.oldPlace !== undefined && p.newPlace && p.oldPlace !== p.newPlace) {
		parts.push(`lieu ${p.oldPlace || '—'} → ${p.newPlace}`);
	}
	if (event.type === 'status_confirmed') {
		return `Confirmé par ${author}`;
	}
	if (parts.length === 0) return `Modifié par ${author}`;
	return `Modifié par ${author} : ${parts.join(', ')}`;
}

/** `confirmation` (confirmation_needed) → "À confirmer". */
function _renderConfirmationLine() {
	return 'À confirmer';
}

/**
 * `missings` → "{present}/{min} présents requis, {maybe} peut-être, {noreply} sans-réponse"
 *                + "Tâches à pourvoir : ..." si applicable.
 * Les compteurs viennent du payload (pré-calculés par le cron en Phase 2).
 * `{min}` = payload.minPresentRequired (occ override prioritaire sur master).
 */
function _renderMissingsLine(event, occ, ctx) {
	const p = event.payload || {};
	const present = p.presentCount ?? 0;
	const maybe = p.maybeCount ?? 0;
	const noreply = p.noReplyCount ?? 0;
	const min = p.minPresentRequired ?? occ.getInt('minPresentRequired') ?? 0;

	const lines = [];
	if (min > 0) {
		lines.push(`${present}/${min} présents requis, ${maybe} peut-être, ${noreply} sans-réponse`);
	}
	const taskLine = _formatTasksToFill(p.tasksToFill);
	if (taskLine) lines.push(taskLine);
	return lines.join('\n   ');
}

/**
 * Calcule la ligne "Tâches à pourvoir : ..." à partir du payload
 * `tasksToFill` (array de `{ name, type, signedUp, required }`).
 * Retourne une chaîne vide si aucune tâche.
 */
function _formatTasksToFill(tasksToFill) {
	if (!Array.isArray(tasksToFill) || tasksToFill.length === 0) return '';
	const items = tasksToFill.map(
		(t) => `${t.name || 'Tâche'} (${t.signedUp ?? 0}/${t.required ?? 0})`
	);
	return `Tâches à pourvoir : ${items.join(', ')}`;
}

/**
 * `reminder` → lignes personnalisées selon la réponse du destinataire.
 *   - `present` + tâches → "Vous êtes inscrit·e comme « présent·e »" + "Vos tâches : …"
 *   - `present` sans tâche → "Vous êtes inscrit·e comme « présent·e »"
 *   - Autre + tâches → "Vos tâches : …"
 *
 * La response et les tâches du destinataire sont pré-calculées par le cron
 * d'envoi et passées dans `event.payload` (`userResponse`, `userTasks`).
 * Le mapping user ↔ participant est trop cas-à-cas (guests revendiqués,
 * userId ≠ participantId) pour vivre dans le templating.
 *
 * Si `master.toConfirm && !occ.isConfirmed`, ajoute la note ℹ en fin.
 */
function _renderReminderLines(event, occ, user, ctx) {
	const p = event.payload || {};
	const userResp = p.userResponse || null;
	const userTasks = Array.isArray(p.userTasks) ? p.userTasks : [];

	const lines = [];
	if (userResp === 'present') {
		lines.push('Vous êtes inscrit·e comme « présent·e »');
	}
	if (userTasks.length > 0) {
		lines.push(`Vos tâches : ${userTasks.join(', ')}`);
	}

	// Le filtrage runtime doit garantir au moins une ligne. Si on est ici
	// sans rien à dire (payload absent/incohérent), on évite un bloc vide.
	if (lines.length === 0) return [];

	const master = ctx && ctx.master;
	if (master && master.getBool('toConfirm') && !occ.getBool('isConfirmed')) {
		lines.push(NON_CONFIRME_NOTE);
	}
	return lines;
}

// ============================================================================
// Collecte des blocs (cœur partagé HTML ↔ texte)
// ============================================================================

/**
 * Construit la structure de données intermédiaire pour le rendu.
 *
 * @param {core.Record} master
 * @param {Array} events — events filtrés pour le destinataire (shape notification_events)
 * @param {core.Record} user — destinataire
 * @param {Object} ctx — caches (`occCache`, `userNamesById`, etc.)
 * @returns {{header:{title,description}, blocks:Array, isTruncated:boolean}}
 */
function _collectBlocks(master, events, user, ctx) {
	const occCache = (ctx && ctx.occCache) || new Map();
	const masterDescription = master.getString('description') || '';

	// Group events par occurrence (préserve l'ordre d'insertion pour stabilité).
	const byOcc = new Map();
	for (const ev of events) {
		const occId = ev.occurrence || ev.occurrenceId;
		if (!occId) continue;
		if (!byOcc.has(occId)) byOcc.set(occId, []);
		byOcc.get(occId).push(ev);
	}

	// Construit les blocs.
	const rawBlocks = [];
	for (const [occId, occEvents] of byOcc.entries()) {
		const occ = occCache.get(occId);
		if (!occ) continue; // occ introuvable (supprimée ?) — skip défensif
		const block = _buildOccBlock(occ, occEvents, user, ctx);
		if (block && block.lines.length > 0) {
			rawBlocks.push(block);
		}
	}

	// Tri ascendant par date d'occ (plus proche en premier).
	rawBlocks.sort((a, b) => {
		const da = a.dateRaw || '';
		const db = b.dateRaw || '';
		return da < db ? -1 : da > db ? 1 : 0;
	});

	// Seuil liste (maquette cas 9) : au-delà de 3 blocs, on tronque.
	const isTruncated = rawBlocks.length > DETAILED_BLOCKS;
	const visibleBlocks = rawBlocks.slice(0, DETAILED_BLOCKS);
	const hiddenCount = rawBlocks.length - DETAILED_BLOCKS;

	return {
		header: {
			title: master.getString('title') || '',
			description: _truncate(masterDescription, MAX_DESC_LENGTH)
		},
		blocks: visibleBlocks,
		hiddenCount: isTruncated ? hiddenCount : 0,
		isTruncated
	};
}

/**
 * Construit un bloc occurrence à partir de ses events.
 * Détermine l'emoji prioritaire, la ligne d'en-tête, les lignes internes
 * ordonnées par priorité, et l'éventuelle description override.
 */
function _buildOccBlock(occ, occEvents, user, ctx) {
	const isCanceled = occ.getBool('isCanceled');

	// Catégorise + ordonne les events par priorité catégorie.
	const categorized = occEvents
		.map((ev) => ({
			ev,
			category: TYPE_CATEGORY[ev.type] || 'change'
		}))
		.sort((a, b) => {
			const pa = CATEGORY_PRIORITY[a.category] ?? 99;
			const pb = CATEGORY_PRIORITY[b.category] ?? 99;
			return pa - pb;
		});

	// Emoji prioritaire = celui du 1er event trié.
	const topCategory = categorized.length > 0 ? categorized[0].category : null;
	const emoji = topCategory ? CATEGORY_EMOJI[topCategory] : '';

	// Lignes internes : rend chaque event selon sa catégorie.
	// Plusieurs events de même catégorie produisent chacun leur ligne
	// (ex: 2 schedule_change = 2 lignes "Modifié par ...").
	const lines = [];
	for (const { ev, category } of categorized) {
		const rendered = _renderEventLines(category, ev, occ, user, ctx);
		for (const line of rendered) lines.push(line);
	}

	// Description override : si l'occ a une description différente du master.
	const occDesc = occ.getString('description') || '';
	const masterDesc = ctx && ctx.master && ctx.master.getString('description');
	const descriptionOverride =
		occDesc && occDesc !== masterDesc ? _truncate(occDesc, MAX_DESC_LENGTH) : '';

	return {
		occId: occ.get('id'),
		emoji,
		category: topCategory,
		headLine: _formatOccLine(occ, isCanceled || topCategory === 'cancel'),
		lines,
		description: descriptionOverride,
		dateRaw: occ.getString('date') // pour le tri
	};
}

/** Délègue au renderer de catégorie, retourne un array de lignes. */
function _renderEventLines(category, ev, occ, user, ctx) {
	switch (category) {
		case 'cancel':
			return [_renderCancelLine(ev, ctx)];
		case 'change':
			return [_renderChangeLine(ev, ctx)];
		case 'confirmation':
			return [_renderConfirmationLine()];
		case 'missings':
			return [_renderMissingsLine(ev, occ, ctx)];
		case 'reminder':
			return _renderReminderLines(ev, occ, user, ctx);
		default:
			return [];
	}
}

// ============================================================================
// Sujet email — logique adaptative
// ============================================================================

/**
 * Construit le sujet email à partir des events agrégés pour le destinataire.
 *
 * 4 cas (interprétés en termes d'**occurrences concernées** et non d'events
 * bruts — un user peut cumuler plusieurs events pour la même occ) :
 *   1. 1 occ concernnée        → "{TypeLabel} — {master.title} — {date courte}"
 *     (le TypeLabel est celui de la catégorie prioritaire parmi les events
 *     de cette occ)
 *   2. N occs, toutes même catégorie → "{N} {plural} — {master.title}"
 *   3. N occs multi avec cancel/change → "Important — {master.title} — {N} événements"
 *   4. N occs multi sans cancel/change → "Récap — {master.title} — {N} événements"
 */
function buildSubject(master, events, ctx) {
	const title = master.getString('title') || 'Planning';
	const occCache = (ctx && ctx.occCache) || new Map();

	if (!events || events.length === 0) return title;

	// Regroupement par occ pour compter les occs uniques et leur catégorie prioritaire.
	const occToCategories = new Map();
	for (const ev of events) {
		const occId = ev.occurrence || ev.occurrenceId;
		if (!occId) continue;
		const category = TYPE_CATEGORY[ev.type] || 'change';
		if (!occToCategories.has(occId)) occToCategories.set(occId, new Set());
		occToCategories.get(occId).add(category);
	}

	const uniqueOccIds = [...occToCategories.keys()];

	if (uniqueOccIds.length === 1) {
		const occId = uniqueOccIds[0];
		const categories = occToCategories.get(occId);
		const topCategory = _pickTopCategory(categories);
		const label = CATEGORY_SUBJECT_LABEL[topCategory] || 'Notification';
		const occ = occCache.get(occId);
		const datePart = occ ? ` — ${formatDateFR(occ.getString('date'))}` : '';
		return `${label} — ${title}${datePart}`;
	}

	// N occs : bucket par catégorie prioritaire pour détecter « toutes même catégorie ».
	const topCategories = new Set();
	for (const cats of occToCategories.values()) {
		topCategories.add(_pickTopCategory(cats));
	}

	if (topCategories.size === 1) {
		const category = [...topCategories][0];
		const plural = CATEGORY_SUBJECT_PLURAL[category] || 'événements';
		return `${uniqueOccIds.length} ${plural} — ${title}`;
	}

	const hasUrgent = topCategories.has('cancel') || topCategories.has('change');
	const prefix = hasUrgent ? 'Important' : 'Récap';
	return `${prefix} — ${title} — ${uniqueOccIds.length} événements`;
}

/** Retourne la catégorie prioritaire d'un Set de catégories. */
function _pickTopCategory(categories) {
	let best = null;
	let bestRank = 99;
	for (const cat of categories) {
		const rank = CATEGORY_PRIORITY[cat] ?? 99;
		if (rank < bestRank) {
			best = cat;
			bestRank = rank;
		}
	}
	return best || 'change';
}

// ============================================================================
// Corps texte
// ============================================================================

/**
 * Corps texte brut — équivalent dégradé du HTML, sans balises.
 * Indentation des lignes internes par 3 espaces.
 */
function buildTextEmail(master, events, user, ctx) {
	const collected = _collectBlocks(master, events, user, ctx);
	const planningUrl = _buildPlanningUrl(master, ctx);

	const parts = [];

	// En-tête
	parts.push('Oupla Planning');
	parts.push(collected.header.title);
	if (collected.header.description) parts.push(collected.header.description);
	parts.push('');

	// Blocs occurrence
	for (const block of collected.blocks) {
		const prefix = block.emoji ? `${block.emoji} ` : '';
		parts.push(`${prefix}${block.headLine}`);
		for (const line of block.lines) {
			parts.push(`   ${line}`);
		}
		if (block.description) parts.push(`   ${block.description}`);
		parts.push('');
	}

	if (collected.isTruncated && collected.hiddenCount > 0) {
		parts.push(`+ ${collected.hiddenCount} autres — voir le planning`);
		parts.push('');
	}

	// Footer
	parts.push(`→ Voir le planning : ${planningUrl}`);
	parts.push('');
	parts.push('—');
	parts.push(
		`Vous recevez cet email car vous êtes inscrit·e au planning « ${collected.header.title} ».`
	);

	return parts.join('\n');
}

// ============================================================================
// Corps HTML (sobre, CSS inline, accent #3b82f6)
// ============================================================================

/** Échappe les caractères HTML pour éviter injection / cassure de layout. */
function _escapeHtml(text) {
	if (text === null || text === undefined) return '';
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Corps HTML sobre. Pas de logo image (overhead CID), pas de fond coloré
 * (filtrage spam). Bouton CTA bleu `#3b82f6` en CSS inline. Séparateurs
 * `<hr>` discrets entre blocs occ. Multi-lignes via `<br>` (les clients
 * mail supportent mal les `<pre>` pour le texte utilisateur).
 */
function buildHtmlEmail(master, events, user, ctx) {
	const collected = _collectBlocks(master, events, user, ctx);
	const planningUrl = _buildPlanningUrl(master, ctx);
	const title = _escapeHtml(collected.header.title);
	const masterDesc = _escapeHtml(collected.header.description);

	const bodyParts = [];

	// Header
	bodyParts.push(
		`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;font-size:15px;line-height:1.5;max-width:560px;margin:0 auto;">`
	);
	bodyParts.push(`<p style="font-size:13px;color:#6b7280;margin:0 0 4px;">Oupla Planning</p>`);
	bodyParts.push(`<h1 style="font-size:20px;margin:0 0 8px;font-weight:600;">${title}</h1>`);
	if (masterDesc) {
		bodyParts.push(`<p style="font-size:14px;color:#4b5563;margin:0 0 16px;">${masterDesc}</p>`);
	}

	// Blocs occurrence
	for (let i = 0; i < collected.blocks.length; i++) {
		const block = collected.blocks[i];
		if (i > 0) {
			bodyParts.push(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">`);
		}
		const emoji = block.emoji ? `${block.emoji} ` : '';
		const head = _escapeHtml(block.headLine);
		bodyParts.push(`<p style="margin:0 0 8px;font-weight:500;">${emoji}${head}</p>`);
		for (const line of block.lines) {
			bodyParts.push(
				`<p style="margin:0 0 4px;padding-left:12px;color:#4b5563;">${_escapeHtml(line)}</p>`
			);
		}
		if (block.description) {
			bodyParts.push(
				`<p style="margin:8px 0 0;padding-left:12px;color:#6b7280;font-size:13px;font-style:italic;">${_escapeHtml(
					block.description
				)}</p>`
			);
		}
	}

	if (collected.isTruncated && collected.hiddenCount > 0) {
		bodyParts.push(
			`<p style="margin:16px 0 0;color:#6b7280;font-size:13px;">+ ${collected.hiddenCount} autres — voir le planning</p>`
		);
	}

	// CTA
	bodyParts.push(
		`<p style="margin:24px 0 16px;"><a href="${_escapeHtml(
			planningUrl
		)}" style="display:inline-block;padding:10px 20px;background-color:#3b82f6;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">Voir le planning</a></p>`
	);

	// Footer
	bodyParts.push(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">`);
	bodyParts.push(
		`<p style="font-size:12px;color:#9ca3af;margin:0;">Vous recevez cet email car vous êtes inscrit·e au planning « ${title} ».</p>`
	);
	bodyParts.push(`</div>`);

	return bodyParts.join('\n');
}

// ============================================================================
// Utils communs
// ============================================================================

/** Construit l'URL absolue du planning à partir du participantToken du master. */
function _buildPlanningUrl(master, ctx) {
	const baseUrl = (ctx && ctx.baseUrl) || 'https://planning.oupla.net';
	const token = master.getString('participantToken');
	return `${baseUrl}/p/${token}`;
}

// ============================================================================
// Exports (API publique + internes pour tests)
// ============================================================================

module.exports = {
	// API publique
	buildSubject,
	buildHtmlEmail,
	buildTextEmail,

	// Internes exportés pour tests (préfixe _ par convention)
	_collectBlocks,
	_formatOccLine,
	_formatTime,
	_truncate,
	_resolveAuthor,
	_resolveTaskType,
	_renderCancelLine,
	_renderChangeLine,
	_renderConfirmationLine,
	_renderMissingsLine,
	_renderReminderLines,

	// Constantes exportées pour tests / debug
	TYPE_CATEGORY,
	CATEGORY_PRIORITY,
	CATEGORY_EMOJI
};
