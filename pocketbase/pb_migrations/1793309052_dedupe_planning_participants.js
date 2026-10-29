/// <reference path="../pb_data/types.d.ts" />

// Intégrité de `planning_participants` : déduplication puis contrainte.
//
// Une ligne par (planning, user) est l'invariant que tout le pipeline de
// notification suppose (lecture « première ligne trouvée », côté cron comme
// côté modal). Avant cette migration, rien en base ne l'imposait : quatre
// chemins applicatifs pouvaient créer des doublons — lecture qui confond
// erreur réseau et absence puis crée, créations concurrentes non atomiques,
// appels multiples depuis les effets de page et le claim d'identité.
//
// Ordre imposé dans la transaction : lignes sans propriétaire dehors →
// fusion des groupes dupliqués → comblement du périmètre de messages vide →
// `user` requis → index unique. Un échec à n'importe quelle étape annule tout
// et la migration n'est pas marquée appliquée.
//
// Fusion (déterministe, mêmes entrées → mêmes sorties) :
//   - canonique = `updated` le plus récent, départage `created` décroissant
//     puis `id` décroissant — c'est la ligne que l'application lit et édite ;
//   - scalaires : la canonique gagne ; une valeur vide est complétée par la
//     valeur non vide la plus récente du groupe ;
//   - `commentReadState` : union des clés, timestamp le plus récent par clé
//     (comparaison lexicographique, timestamps ISO 8601) ;
//   - `newCommentScope` vide : 'all' si l'entrée participant du master porte
//     `isAdmin`, sinon 'concerned' — null signifie opt-out silencieux des
//     messages (hérité d'une création serveur sans ce champ), jamais un choix.
//
// Le `down` restaure le schéma, pas les données : les lignes fusionnées ou
// supprimées ne reviennent pas (rollback données = backup du volume).

migrate((app) => {
	const rows = app.findRecordsByFilter('planning_participants', 'id != ""', '', 0, 0);

	const jsonField = (row, field) => {
		const raw = row.getString(field);
		if (!raw || raw === 'null' || raw === '') return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	};

	const isEmpty = (v) =>
		v === null ||
		v === undefined ||
		v === '' ||
		(Array.isArray(v) && v.length === 0);

	// Comparaison descendante sur des chaînes (ISO 8601 : ordre lexicographique
	// = ordre chronologique ; pas de localeCompare, dépendant de l'environnement).
	const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);

	// --- 1. Lignes sans propriétaire : illisibles par la règle d'accès
	// (`user.id = @request.auth.id`), leur suppression ne retire rien à personne.
	let orphanRemoved = 0;
	const owned = [];
	for (const row of rows) {
		if (row.getString('user') === '') {
			console.log('[dedupe-pp] ligne sans user supprimée id=' + row.getString('id'));
			app.delete(row);
			orphanRemoved++;
			continue;
		}
		owned.push(row);
	}

	// --- 2. Groupes (planning, user)
	const groups = new Map();
	for (const row of owned) {
		const key = row.getString('planning') + '\u0000' + row.getString('user');
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row);
	}

	// Rôle d'un user sur un master : entrée `participants[].isAdmin`.
	// Master introuvable ou entrée absente → false (repli 'concerned').
	const participantIsAdmin = (masterId, userId) => {
		if (masterId === '') return false;
		let master = null;
		try {
			master = app.findRecordById('planning_masters', masterId);
		} catch {
			return false;
		}
		const participants = jsonField(master, 'participants');
		if (!Array.isArray(participants)) return false;
		for (const p of participants) {
			if (p && p.userId === userId) return !!p.isAdmin;
		}
		return false;
	};

	const removedIds = new Set();
	let mergedGroups = 0;
	let mergedReadKeys = 0;
	for (const group of groups.values()) {
		if (group.length < 2) continue;

		const sorted = [...group].sort((a, b) => {
			const byUpdated = desc(a.getString('updated'), b.getString('updated'));
			if (byUpdated !== 0) return byUpdated;
			const byCreated = desc(a.getString('created'), b.getString('created'));
			if (byCreated !== 0) return byCreated;
			return desc(a.getString('id'), b.getString('id'));
		});
		const canonical = sorted[0];
		const rest = sorted.slice(1);

		const filled = [];
		for (const field of ['newCommentScope', 'reminderDays', 'missingDays']) {
			if (!isEmpty(canonical.get(field))) continue;
			for (const other of rest) {
				const value = other.get(field);
				if (!isEmpty(value)) {
					canonical.set(field, value);
					filled.push(field);
					break;
				}
			}
		}

		const readState = jsonField(canonical, 'commentReadState');
		const merged =
			readState && typeof readState === 'object' && !Array.isArray(readState)
				? { ...readState }
				: {};
		for (const other of rest) {
			const otherState = jsonField(other, 'commentReadState');
			if (!otherState || typeof otherState !== 'object' || Array.isArray(otherState)) continue;
			for (const key of Object.keys(otherState)) {
				if (!(key in merged)) {
					merged[key] = otherState[key];
					mergedReadKeys++;
				} else if (String(otherState[key]) > String(merged[key])) {
					merged[key] = otherState[key];
				}
			}
		}
		if (mergedReadKeys > 0) canonical.set('commentReadState', JSON.stringify(merged));

		if (isEmpty(canonical.get('newCommentScope'))) {
			const role = participantIsAdmin(
				canonical.getString('planning'),
				canonical.getString('user')
			);
			canonical.set('newCommentScope', role ? 'all' : 'concerned');
			filled.push('newCommentScope(role)');
		}

		for (const other of rest) {
			removedIds.add(other.getString('id'));
			app.delete(other);
		}
		app.save(canonical);
		mergedGroups++;
		console.log(
			'[dedupe-pp] groupe fusionné planning=' + canonical.getString('planning') +
				' user=' + canonical.getString('user') +
				' garde=' + canonical.getString('id') +
				' supprimes=' + rest.map((r) => r.getString('id')).join(',') +
				' completes=' + filled.join(',')
		);
	}

	// --- 3. Lignes solitaires au périmètre vide (créées par la voie serveur
	// avant l'alignement des defaults). Les lignes supprimées en (2) sont
	// sautées : leurs références survivent dans `owned`.
	let scopeBackfilled = 0;
	for (const row of owned) {
		if (removedIds.has(row.getString('id'))) continue;
		if (row.getString('newCommentScope') !== '') continue;
		const role = participantIsAdmin(row.getString('planning'), row.getString('user'));
		row.set('newCommentScope', role ? 'all' : 'concerned');
		app.save(row);
		scopeBackfilled++;
	}

	// --- 4. Contrainte : `user` requis + index unique (remplace le non unique).
	const collection = app.findCollectionByNameOrId('planning_participants');
	collection.fields.getByName('user').required = true;
	collection.indexes = collection.indexes.filter(
		(idx) => idx.indexOf('idx_pp_planning_user') === -1
	);
	collection.indexes.push(
		'CREATE UNIQUE INDEX `idx_pp_planning_user` ON `planning_participants` (`planning`, `user`)'
	);
	app.save(collection);

	console.log(
		'[dedupe-pp] termine : lignes=' + rows.length +
			' orphelines=' + orphanRemoved +
			' groupes_fusionnes=' + mergedGroups +
			' cles_lecture_fusionnees=' + mergedReadKeys +
			' perimetres_combles=' + scopeBackfilled
	);
}, (app) => {
	const collection = app.findCollectionByNameOrId('planning_participants');
	collection.fields.getByName('user').required = false;
	collection.indexes = collection.indexes.filter(
		(idx) => idx.indexOf('idx_pp_planning_user') === -1
	);
	collection.indexes.push(
		'CREATE INDEX `idx_pp_planning_user` ON `planning_participants` (`planning`, `user`)'
	);
	app.save(collection);
});
