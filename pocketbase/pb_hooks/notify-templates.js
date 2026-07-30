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
const { buildContentPreview, TASK_TYPE_LABEL } = require(`${__hooks}/notification-core.cjs`);

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
	confirmation_needed: 'confirmation',
	new_comment: 'comment'
};

/** Priorité de catégorie (plus petit = plus prioritaire dans un bloc). */
const CATEGORY_PRIORITY = {
	cancel: 0,
	change: 1,
	confirmation: 2,
	missings: 3,
	reminder: 4,
	comment: 5
};

/** Emoji par catégorie — préfixe du bloc occurrence. */
const CATEGORY_EMOJI = {
	cancel: '❌',
	change: '✏️',
	confirmation: '⏳',
	missings: '⚠️',
	reminder: '🔔',
	comment: '💬'
};

/** Libellé singulier pour le sujet d'un event unique. */
const CATEGORY_SUBJECT_LABEL = {
	cancel: 'Annulation',
	change: 'Modification',
	confirmation: 'À confirmer',
	missings: 'Participants manquants',
	reminder: 'Rappel',
	comment: 'Nouveau message'
};

/** Libellé pluriel pour le sujet de N events même catégorie. */
const CATEGORY_SUBJECT_PLURAL = {
	cancel: 'annulations',
	change: 'modifications',
	confirmation: 'événements à confirmer',
	missings: 'alertes de participants manquants',
	reminder: 'rappels',
	comment: 'nouveaux messages'
};

/**
 * Seuils de liste : au-delà de 3 blocs occurrence, seuls les 3 premiers
 * sont détaillés, suivi de la ligne `+ N autres — voir le planning`.
 */
const DETAILED_BLOCKS = 3;

/** Troncature des descriptions longues. */
const MAX_DESC_LENGTH = 300;

/** Fallback générique si `changedBy` vide ou user introuvable. */
const UNKNOWN_AUTHOR = 'un·e administrateur·ice';

/** Note ℹ affichée en fin de bloc reminder si l'occ n'est pas confirmée. */
const NON_CONFIRME_NOTE = "ℹ L'événement n'est pas encore confirmé.";

/** Ligne d'action attendue pour les admins (catégorie confirmation). */
const CONFIRMATION_ACTION_LINE =
	"En tant qu'administrateur·ice, confirmez sa tenue ou annulez-le s'il n'aura pas lieu.";

/**
 * Marqueur de barré dans les renderers.
 * Converti en `<s>` côté HTML (rendu barré) et supprimé côté texte brut.
 * Format : `[[s]]ancien[[/s]] → nouveau`.
 */
const STRIKE_OPEN = '[[s]]';
const STRIKE_CLOSE = '[[/s]]';

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
 *   - Cas général : `{typeLabel} — {date} à {start}h — {end} — {place}`
 *     (ex: "Rappel — mar. 31 mars à 19h00 — 22h00 — Salle des fêtes")
 *   - Cas cancel : `{typeLabel} — {date}` (horaire/lieu non pertinents sur occ annulée)
 *
 * Le `typeLabel` (Annulation, Modification, À confirmer, ...) est injecté en
 * toutes lettres pour lever l'ambiguïté de l'emoji seul.
 */
function _formatOccLine(occ, isCanceled, typeLabel = '') {
	const date = formatDateFR(occ.getString('date'));
	const datePart = typeLabel ? `${typeLabel} — ${date}` : date;
	if (isCanceled) return datePart;
	const startTime = _formatTime(occ.getString('startTime'));
	const endTime = _formatTime(occ.getString('endTime'));
	const place = occ.getString('place') || '';
	const head = startTime ? `${datePart} à ${startTime} — ${endTime}` : datePart;
	return place ? `${head} — ${place}` : head;
}

/**
 * Construit la ligne de contexte temporel d'un reminder à partir du J-X.
 *   - 1      → "L'événement a lieu demain."
 *   - N (≥2) → "L'événement a lieu dans {N} jours."
 *   - 0/absent → '' (pas de ligne contexte)
 */
function _buildContextualLine(reminderValue) {
	const n = Number(reminderValue) || 0;
	if (n === 1) return "L'événement a lieu demain.";
	if (n >= 2) return `L'événement a lieu dans ${n} jours.`;
	return '';
}

/**
 * Construit la ligne de contexte d'une confirmation admin à partir du J-X.
 * Variante "prévu" (vs "a lieu" pour le reminder) pour signaler le caractère
 * non-encore-confirmé.
 *   - 1      → "L'événement est prévu demain mais n'est pas encore confirmé."
 *   - N (≥2) → "L'événement est prévu dans {N} jours mais n'est pas encore confirmé."
 *   - 0/absent → "L'événement n'est pas encore confirmé."
 */
function _buildConfirmationContextualLine(reminderValue) {
	const n = Number(reminderValue) || 0;
	if (n === 1) return "L'événement est prévu demain mais n'est pas encore confirmé.";
	if (n >= 2) return `L'événement est prévu dans ${n} jours mais n'est pas encore confirmé.`;
	return "L'événement n'est pas encore confirmé.";
}

/**
 * Supprime les marqueurs `[[s]]...[[/s]]` d'une ligne (rendu texte brut).
 */
function _stripStrikeMarkers(line) {
	return line.replace(/\[\[\/?s\]\]/g, '');
}

/**
 * Convertit les marqueurs `[[s]]...[[/s]]` en `<s>` stylé (rendu HTML).
 * À appeler APRÈS `_escapeHtml` : le contenu interne est alors déjà échappé,
 * on insère juste la balise `<s>`.
 */
function _renderStrikeForHtml(escapedLine) {
	return escapedLine.replace(
		/\[\[s\]\]([\s\S]*?)\[\[\/s\]\]/g,
		'<s style="text-decoration:line-through;color:#9ca3af;">$1</s>'
	);
}

// ============================================================================
// Renderers par event — retournent 1+ lignes string, ou [] si l'event
// ne doit rien afficher pour ce destinataire (ex: reminder filtré runtime).
// ============================================================================

/** `cancel` → "L'événement a été annulé (par Sarah)." (ou "supprimé" pour status_deleted). */
function _renderCancelLine(event, ctx) {
	const author = _resolveAuthor(event.changedBy, ctx);
	if (event.type === 'status_deleted') return `L'événement a été supprimé (par ${author}).`;
	return `L'événement a été annulé (par ${author}).`;
}

/**
 * `change` (schedule_change) → phrase complète selon le(s) champ(s) modifié(s).
 * Le payload contient les champs avant/après. 3 cas :
 *   - 0 champ identifié → "L'événement a été modifié (par X)."
 *   - 1 champ → phrase dédiée ("La date a été modifiée...", "Le lieu a été...", etc.)
 *   - N champs → "Plusieurs détails ont été modifiés (par X) : ..."
 *
 * Le lieu barré utilise `[[s]]ancien[[/s]]` (converti en `<s>` côté HTML,
 * supprimé côté texte brut).
 */
function _renderChangeLine(event, ctx) {
	const author = _resolveAuthor(event.changedBy, ctx);
	const p = event.payload || {};

	if (event.type === 'status_confirmed') {
		return `L'événement a été confirmé (par ${author}).`;
	}

	const hasDate = p.oldDate && p.newDate && p.oldDate !== p.newDate;
	const hasStart = p.oldStartTime && p.newStartTime && p.oldStartTime !== p.newStartTime;
	const hasEnd = p.oldEndTime && p.newEndTime && p.oldEndTime !== p.newEndTime;
	const hasPlace = p.oldPlace !== undefined && p.newPlace && p.oldPlace !== p.newPlace;

	// 1 champ : phrasé dédié.
	if (hasDate && !hasStart && !hasEnd && !hasPlace) {
		return `La date a été modifiée (par ${author}) : ${formatDateFR(p.oldDate)} → ${formatDateFR(p.newDate)}.`;
	}
	if (hasStart && !hasDate && !hasEnd && !hasPlace) {
		return `L'horaire de début a été modifié (par ${author}) : ${_formatTime(p.oldStartTime)} → ${_formatTime(p.newStartTime)}.`;
	}
	if (hasEnd && !hasDate && !hasStart && !hasPlace) {
		return `L'horaire de fin a été modifié (par ${author}) : ${_formatTime(p.oldEndTime)} → ${_formatTime(p.newEndTime)}.`;
	}
	if (hasPlace && !hasDate && !hasStart && !hasEnd) {
		const oldPlace = p.oldPlace || '—';
		return `Le lieu a été modifié (par ${author}) : ${STRIKE_OPEN}${oldPlace}${STRIKE_CLOSE} → ${p.newPlace}.`;
	}

	// 0 champ identifié.
	const hasAnyChange = hasDate || hasStart || hasEnd || hasPlace;
	if (!hasAnyChange) {
		return `L'événement a été modifié (par ${author}).`;
	}

	// N champs : phrase englobante.
	const parts = [];
	if (hasDate) parts.push(`date ${formatDateFR(p.oldDate)} → ${formatDateFR(p.newDate)}`);
	if (hasStart)
		parts.push(`horaire ${_formatTime(p.oldStartTime)} → ${_formatTime(p.newStartTime)}`);
	if (hasEnd) parts.push(`fin ${_formatTime(p.oldEndTime)} → ${_formatTime(p.newEndTime)}`);
	if (hasPlace) parts.push(`lieu ${p.oldPlace || '—'} → ${p.newPlace}`);
	return `Plusieurs détails ont été modifiés (par ${author}) : ${parts.join(', ')}.`;
}

/**
 * `confirmation` (confirmation_needed, admin only) → 2 lignes :
 *   - contexte temporel avec J-X ("L'événement est prévu dans 3 jours mais n'est pas encore confirmé.")
 *   - action attendue ("En tant qu'administrateur·ice, confirmez sa tenue ou annulez-le s'il n'aura pas lieu.")
 *
 * Retourne un Array<string> (2 lignes), à différencier des autres renderers
 * qui retournent une string unique.
 */
function _renderConfirmationLine(event) {
	return [_buildConfirmationContextualLine(event.reminderValue), CONFIRMATION_ACTION_LINE];
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
	return `Tâches à pourvoir : ${items.join(', ')}.`;
}

/**
 * `missings` → lignes phrasées (Array<string>).
 *   - Quorum (seulement pour `quorum_missing`) :
 *       "Quorum insuffisant : 2 présents confirmés sur 5 requis."
 *       "1 si besoin, 2 incertain·e·s."  (uniquement si au moins un compteur > 0)
 *   - Tâches à pourvoir si applicable.
 *
 * `task_unassigned` est aussi catégorisé missings mais ne porte pas de
 * compteurs de quorum → on saute la partie quorum et on n'affiche que les tâches.
 */
function _renderMissingsLine(event, occ) {
	const p = event.payload || {};
	const present = p.presentCount ?? 0;
	const ifNeeded = p.ifNeededCount ?? 0;
	const maybe = p.maybeCount ?? 0;
	const min = p.minPresentRequired ?? occ.getInt('minPresentRequired') ?? 0;
	const isTaskUnassigned = event.type === 'task_unassigned';

	const lines = [];
	if (!isTaskUnassigned && min > 0) {
		lines.push(`Quorum insuffisant : ${present} présent·e·s confirmé·e·s sur ${min} requis.`);
		// 2e ligne optionnelle : seulement si au moins une catégorie > 0.
		// Évite d'afficher "0 si besoin, 0 incertain·e·s." quand tout est vide.
		const parts = [];
		if (ifNeeded > 0) parts.push(`${ifNeeded} si besoin`);
		if (maybe > 0) parts.push(`${maybe} incertain·e·s`);
		if (parts.length > 0) lines.push(parts.join(', ') + '.');
	}
	const taskLine = _formatTasksToFill(p.tasksToFill);
	if (taskLine) lines.push(taskLine);
	return lines;
}

/**
 * `reminder` → lignes personnalisées selon la réponse du destinataire.
 *   - Ligne contexte temporel (J-X) — optionnel, supprimée si une confirmation
 *     est déjà présente dans le bloc ( évite la répétition "dans 3 jours" ).
 *   - "Vous êtes inscrit·e comme « présent·e »." si userResponse=present
 *   - "Vos tâches : ..." si applicable
 *
 * Si master.toConfirm && !occ.isConfirmed, ajoute NON_CONFIRME_NOTE en fin.
 */
function _renderReminderLines(event, occ, user, ctx, opts) {
	const p = event.payload || {};
	const userResp = p.userResponse || null;
	const userTasks = Array.isArray(p.userTasks) ? p.userTasks : [];
	const suppressContextual = opts && opts.suppressContextual;

	const lines = [];
	if (!suppressContextual) {
		const ctxLine = _buildContextualLine(event.reminderValue);
		if (ctxLine) lines.push(ctxLine);
	}
	if (userResp === 'present') {
		lines.push('Vous êtes inscrit·e comme « présent·e ».');
	}
	if (userTasks.length > 0) {
		lines.push(`Vos tâches : ${userTasks.join(', ')}.`);
	}

	// Filtrage runtime doit garantir au moins une ligne. Si on est ici sans
	// rien à dire (payload absent/incohérent), on évite un bloc vide.
	if (lines.length === 0) return [];

	const master = ctx && ctx.master;
	if (master && master.getBool('toConfirm') && !occ.getBool('isConfirmed')) {
		lines.push(NON_CONFIRME_NOTE);
	}
	return lines;
}

/**
 * `comment` (new_comment) — rendu **agrégé** : un seul en-tête `💬 N nouveau{x}
 * message{s} :` suivi d'une sous-ligne par message. Contrairement aux autres
 * renderers (1 event → 1 appel), celui-ci prend la liste complète des events
 * `new_comment` du bloc occ pour produire un unique sous-bloc — N messages sur
 * une même occ ne génèrent pas N blocs séparés (lisibilité email).
 *
 * L'aperçu est tronqué à MAX_CONTENT_PREVIEW caractères via `buildContentPreview` et mis
 * sur une seule ligne (les `\n` sont repliés en espaces) ; le détecteur l'a déjà
 * tronqué, on retronce défensivement au cas où le payload viendrait d'une autre
 * source.
 *
 * @param {Array} events — events `new_comment` du bloc occ (≥1)
 * @returns {Array<string>} en-tête puis sous-lignes indentées `   • auteur : aperçu`
 */
function _renderCommentLines(events, ctx) {
	const n = events.length;
	if (n === 0) return [];
	const label = n === 1 ? '1 nouveau message' : `${n} nouveaux messages`;
	const lines = [`💬 ${label} :`];
	for (const ev of events) {
		const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
		const author = p.authorName || '—';
		const preview = buildContentPreview(p.contentPreview);
		lines.push(`   • ${author} : ${preview}`);
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
 * Détermine l'emoji prioritaire, le label de type, la ligne d'en-tête,
 * les lignes internes ordonnées par priorité, et l'éventuelle description override.
 */
function _buildOccBlock(occ, occEvents, user, ctx) {
	const isCanceled = occ.getBool('isCanceled');

	// Les events `new_comment` sont agrégés en un seul sous-bloc (un en-tête
	// pour N messages) et rendus en dernier. Les autres catégories conservent
	// leur rendu par event.
	const commentEvents = [];
	const nonComment = [];
	for (const ev of occEvents) {
		if (TYPE_CATEGORY[ev.type] === 'comment') commentEvents.push(ev);
		else nonComment.push(ev);
	}

	// Catégorise + ordonne les events non-comment par priorité catégorie.
	const categorized = nonComment
		.map((ev) => ({
			ev,
			category: TYPE_CATEGORY[ev.type] || 'change'
		}))
		.sort((a, b) => {
			const pa = CATEGORY_PRIORITY[a.category] ?? 99;
			const pb = CATEGORY_PRIORITY[b.category] ?? 99;
			return pa - pb;
		});

	// Emoji + label prioritaires = ceux du 1er event non-comment trié. Pour un
	// bloc pure comment, on n'expose ni emoji ni label au niveau du bloc :
	// l'en-tête du sous-bloc "💬 N nouveaux messages :" porte déjà le type, et
	// répéter "Nouveau message" dans la headLine serait redondant.
	let topCategory;
	let emoji;
	let typeLabel;
	if (categorized.length > 0) {
		topCategory = categorized[0].category;
		emoji = CATEGORY_EMOJI[topCategory] || '';
		typeLabel = CATEGORY_SUBJECT_LABEL[topCategory] || '';
	} else if (commentEvents.length > 0) {
		topCategory = 'comment';
		emoji = '';
		typeLabel = '';
	} else {
		topCategory = null;
		emoji = '';
		typeLabel = '';
	}

	// Détection d'une confirmation dans le bloc → supprimer la ligne contexte
	// du reminder ("dans 3 jours") pour éviter la répétition, puisque la
	// confirmation dit déjà "L'événement est prévu dans 3 jours mais...".
	const hasConfirmation = categorized.some((c) => c.category === 'confirmation');

	// Lignes internes : rend chaque event non-comment selon sa catégorie.
	const lines = [];
	for (const { ev, category } of categorized) {
		const opts = { suppressContextual: hasConfirmation && category === 'reminder' };
		const rendered = _renderEventLines(category, ev, occ, user, ctx, opts);
		for (const line of rendered) lines.push(line);
	}

	// Sous-bloc comment rendu en dernier (priorité 5 = la plus basse).
	if (commentEvents.length > 0) {
		for (const line of _renderCommentLines(commentEvents, ctx)) {
			lines.push(line);
		}
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
		headLine: _formatOccLine(occ, isCanceled || topCategory === 'cancel', typeLabel),
		lines,
		description: descriptionOverride,
		dateRaw: occ.getString('date') // pour le tri
	};
}

/**
 * Délègue au renderer de catégorie, retourne un array de lignes.
 * `opts` est passé aux renderers qui en ont besoin (reminder pour
 * suppressContextual).
 */
function _renderEventLines(category, ev, occ, user, ctx, opts) {
	switch (category) {
		case 'cancel':
			return [_renderCancelLine(ev, ctx)];
		case 'change':
			return [_renderChangeLine(ev, ctx)];
		case 'confirmation':
			return _renderConfirmationLine(ev);
		case 'missings':
			return _renderMissingsLine(ev, occ);
		case 'reminder':
			return _renderReminderLines(ev, occ, user, ctx, opts);
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
	let commentEventCount = 0;
	const occToCategories = new Map();
	for (const ev of events) {
		const occId = ev.occurrence || ev.occurrenceId;
		if (!occId) continue;
		const category = TYPE_CATEGORY[ev.type] || 'change';
		if (category === 'comment') commentEventCount++;
		if (!occToCategories.has(occId)) occToCategories.set(occId, new Set());
		occToCategories.get(occId).add(category);
	}

	const uniqueOccIds = [...occToCategories.keys()];
	const occTopCategories = uniqueOccIds.map((id) => _pickTopCategory(occToCategories.get(id)));
	// `comment` a la priorité la plus basse : une occ n'est "top comment" que si
	// elle ne porte aucun autre type d'event. Le bucket est "tout comment" quand
	// toutes les occs sont dans ce cas.
	const allComment =
		occTopCategories.length > 0 && occTopCategories.every((c) => c === 'comment');

	if (allComment) {
		// Le sujet compte les messages (pas les occs) : "N nouveaux messages"
		// reflète l'activité discussion, cohérent avec le sous-bloc agrégé.
		if (uniqueOccIds.length === 1) {
			const occId = uniqueOccIds[0];
			const occ = occCache.get(occId);
			const datePart = occ ? ` — ${formatDateFR(occ.getString('date'))}` : '';
			if (commentEventCount === 1) {
				return `Nouveau message — ${title}${datePart}`;
			}
			return `${commentEventCount} nouveaux messages — ${title}${datePart}`;
		}
		return `${commentEventCount} nouveaux messages — ${title}`;
	}

	let base;
	if (uniqueOccIds.length === 1) {
		const occId = uniqueOccIds[0];
		const topCategory = occTopCategories[0];
		const label = CATEGORY_SUBJECT_LABEL[topCategory] || 'Notification';
		const occ = occCache.get(occId);
		const datePart = occ ? ` — ${formatDateFR(occ.getString('date'))}` : '';
		base = `${label} — ${title}${datePart}`;
	} else {
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
		base = `${prefix} — ${title} — ${uniqueOccIds.length} événements`;
	}

	// Catégorie dominante ≠ comment mais des messages sont présents : on suffixe
	// (N = total events comment du bucket, toutes occs confondues).
	if (commentEventCount > 0) {
		base += ` + ${commentEventCount} nouveaux messages`;
	}
	return base;
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
	// FIXIT ? buildTextEmail affiche la description brute (HTML). En texte brut
	// le HTML est peu lisible. Si cela devient gênant, appliquer un strip-tags
	// basique ici (ex: supprimer <[^>]+>, préserver les <br> comme sauts de ligne).
	parts.push('');

	// Blocs occurrence
	for (const block of collected.blocks) {
		const prefix = block.emoji ? `${block.emoji} ` : '';
		parts.push(`${prefix}${block.headLine}`);
		for (const line of block.lines) {
			parts.push(`   ${_stripStrikeMarkers(line)}`);
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
	parts.push(`Vous pouvez ajuster vos notifications depuis le planning : ${planningUrl}?notif=1`);

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
 * Nettoie un HTML riche pour usage dans un email : conserve les balises
 * safe d'une whitelist (alignée sur DescriptionCard.svelte), supprime
 * <script>, <style>, attributs on* et href javascript:.
 * Conçu pour le contexte email (admin → participants) — pas un remplacement
 * de DOMPurify, mais suffisant pour ce threat model.
 */
function _stripUnsafeHtml(html) {
	if (!html) return '';
	const safeTags = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'b', 'i'];
	const escaped = safeTags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
	const re = new RegExp(`</?(?:${escaped}|\\w+)[^>]*>`, 'gi');
	return (
		String(html)
			// Supprime d'abord les blocs dangereux entiers
			.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
			.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
			// Supprime les attributs on* (onclick, onerror, etc.)
			.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
			// Supprime les href javascript:
			.replace(
				/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]*)/gi,
				'href="#"'
			)
			// Remplace toute balise non-safe par son contenu texte uniquement
			.replace(re, (match) => {
				const tagName = match
					.replace(/<\/?/, '')
					.replace(/[>\s\/].*$/, '')
					.toLowerCase();
				if (safeTags.includes(tagName)) return match;
				return '';
			})
			// Nettoie les lignes vides multiples laissées par les suppressions
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
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
	// Note: description est un champ Editor (rich-text). PB ne sanitize pas le
	// contenu (stockage brut), donc on applique _stripUnsafeHtml() pour ne garder
	// que les balises safe d'une whitelist — le rendu riche est conservé sans
	// les risques XSS (<script>, on*, href javascript:).
	const masterDesc = _stripUnsafeHtml(collected.header.description);

	const bodyParts = [];

	// Header
	bodyParts.push(
		`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;font-size:15px;line-height:1.5;max-width:560px;margin:0 auto;">`
	);
	bodyParts.push(`<p style="font-size:13px;color:#6b7280;margin:0 0 4px;">Oupla Planning</p>`);
	bodyParts.push(`<h1 style="font-size:20px;margin:0 0 8px;font-weight:600;">${title}</h1>`);
	if (masterDesc) {
		// On utilise un <div> plutôt qu'un <p> car le HTML rich-text peut contenir
		// des éléments block (<p>, <ul>, <h2>…) qui seraient invalides dans un <p>.
		bodyParts.push(
			`<div style="font-size:14px;color:#4b5563;margin:0 0 16px;">${masterDesc}</div>`
		);
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
			// Échappe d'abord le contenu, puis convertit les marqueurs [[s]]...
			// en <s> (le contenu interne est déjà échappé par _escapeHtml).
			const rendered = _renderStrikeForHtml(_escapeHtml(line));
			bodyParts.push(`<p style="margin:0 0 4px;padding-left:12px;color:#4b5563;">${rendered}</p>`);
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
		`<p style="font-size:12px;color:#9ca3af;margin:0 0 4px;">Vous recevez cet email car vous êtes inscrit·e au planning « ${title} ».</p>`
	);
	bodyParts.push(
		`<p style="font-size:12px;color:#9ca3af;margin:0;">Vous pouvez <a href="${_escapeHtml(
			planningUrl
		)}?notif=1" style="color:#9ca3af;text-decoration:underline;">ajuster vos notifications</a> depuis le planning.</p>`
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
	_renderCommentLines,
	_buildContextualLine,
	_buildConfirmationContextualLine,
	_formatTasksToFill,
	_stripStrikeMarkers,
	_renderStrikeForHtml,

	// Constantes exportées pour tests / debug
	TYPE_CATEGORY,
	CATEGORY_PRIORITY,
	CATEGORY_EMOJI
};
