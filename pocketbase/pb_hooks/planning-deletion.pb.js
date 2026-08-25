/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7.

/**
 * Cycle de vie soft-delete des plannings (fenêtre de grâce de 15 jours).
 *
 *  - Garde update master : un planning supprimé est en lecture seule ; seule
 *    une restauration par l'adminToken est permise. `deletedAt` est toujours
 *    forgé/vidé côté serveur — une valeur client arbitraire déclencherait une
 *    purge prématurée.
 *  - Gardes occurrences / planning_participants : gèlent tout write sur les
 *    collections dépendantes d'un master supprimé.
 *  - Blocage du hard-delete API du master : la suppression définitive passe
 *    exclusivement par le cron de purge, pour garantir la fenêtre de grâce.
 *  - Détection des transitions deleted false↔true (hook model) : envoie
 *    l'email terminal à tous les participants identifiés, best-effort.
 *  - Cron `planning-purge` (01h00 UTC, après notifications-daily à 00h) :
 *    supprime les masters dont la fenêtre de grâce est échue, après nettoyage
 *    des références d'identité non couvertes par la cascade (users.masterId,
 *    users.adminOf).
 *
 * Ce fichier se charge après main.pb.js (ordre alphabétique) : les hooks update
 * s'enchaînent derrière les validations token/allowlist existantes ; un throw
 * ici avorte la requête sans save.
 */

// ============================================
// Garde update master (lecture seule + restauration)
// ============================================

onRecordUpdateRequest((e) => {
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}

	const { nowPbDate } = require(`${__hooks}/planning-deletion-utils.cjs`);

	const wasDeleted = e.record.original().getBool('deleted');

	if (!wasDeleted) {
		// Soft-delete : adminToken requis explicitement (ne pas dépendre de
		// l'allowlist participant de main.pb.js ni de l'ordre de chargement des
		// hooks). deletedAt forgé serveur, jamais trusté du client.
		if (e.record.getBool('deleted')) {
			const token = e.requestInfo()?.query?.['_token'] || '';
			if (token !== e.record.get('adminToken')) {
				throw new ApiError(403, 'Only an admin can delete a planning.');
			}
			e.record.set('deletedAt', nowPbDate());
		}
		e.next();
		return;
	}

	// Master déjà supprimé : lecture seule, sauf restauration par l'adminToken.
	const token = e.requestInfo()?.query?.['_token'] || '';
	const isAdmin = token === e.record.get('adminToken');
	if (isAdmin && !e.record.getBool('deleted')) {
		e.record.set('deletedAt', '');
		e.next();
		return;
	}

	throw new ApiError(403, 'Planning is deleted and read-only. Only an admin can restore it.');
}, 'planning_masters');

// ============================================
// Garde occurrences (freeze des writes)
// ============================================

onRecordCreateRequest((e) => {
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}
	const { assertMasterNotDeleted } = require(`${__hooks}/planning-deletion-utils.cjs`);
	assertMasterNotDeleted(e.app, e.record.getString('master'), 'occurrences');
	e.next();
}, 'planning_occurrences');

onRecordUpdateRequest((e) => {
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}
	const { assertMasterNotDeleted } = require(`${__hooks}/planning-deletion-utils.cjs`);
	assertMasterNotDeleted(e.app, e.record.getString('master'), 'occurrences');
	e.next();
}, 'planning_occurrences');

onRecordDeleteRequest((e) => {
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}
	const { assertMasterNotDeleted } = require(`${__hooks}/planning-deletion-utils.cjs`);
	assertMasterNotDeleted(e.app, e.record.getString('master'), 'occurrences');
	e.next();
}, 'planning_occurrences');

// ============================================
// Garde planning_participants (freeze des prefs)
// ============================================

onRecordCreateRequest((e) => {
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}
	const { assertMasterNotDeleted } = require(`${__hooks}/planning-deletion-utils.cjs`);
	assertMasterNotDeleted(e.app, e.record.getString('planning'), 'participants');
	e.next();
}, 'planning_participants');

onRecordUpdateRequest((e) => {
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}
	const { assertMasterNotDeleted } = require(`${__hooks}/planning-deletion-utils.cjs`);
	assertMasterNotDeleted(e.app, e.record.getString('planning'), 'participants');
	e.next();
}, 'planning_participants');

// ============================================
// Blocage hard-delete API du master
// ============================================

// ============================================
// Blocage hard-delete API du master
// ============================================
// Couvert par l'API Rule deleteRule = null (superusers only, migration
// 1787663200) : aucun delete HTTP possible, même avec adminToken. Le cron de
// purge passe au travers (les deletes programmatiques ne passent pas par les
// API Rules). Pas de hook ici — il serait inatteignable derrière la règle.

// ============================================
// Détection des transitions + emails terminaux
// ============================================

onRecordAfterUpdateSuccess((e) => {
	const was = e.record.original().getBool('deleted');
	const is = e.record.getBool('deleted');
	if (was === is) {
		e.next();
		return;
	}

	// Hook model : pas de contexte HTTP ici — l'auteur vient de `lastModifiedBy`
	// (forgé par main.pb.js sur les requêtes ; save programmatique = vide).
	// Se déclenche aussi pour les saves superuser/programmatiques : voulu,
	// l'email terminal doit partir quelle que soit la voie d'écriture.
	const {
		extractDeletionRecipients,
		computePurgeDate,
		buildDeletedEmail,
		buildRestoredEmail,
		nowPbDate
	} = require(`${__hooks}/planning-deletion-utils.cjs`);
	const { sendIndividualEmail, formatDateFR } = require(`${__hooks}/notify-utils.cjs`);

	const recipients = extractDeletionRecipients(e.record);
	if (recipients.length === 0) {
		e.next();
		return;
	}

	const authorId = e.record.getString('lastModifiedBy');
	let authorName = 'un·e administrateur·ice';
	if (authorId) {
		try {
			const author = e.app.findRecordById('users', authorId);
			authorName = author.getString('name') || author.email() || authorName;
		} catch {
			/* auteur introuvable — fallback générique */
		}
	}

	let email;
	if (!was && is) {
		// deletedAt peut manquer (save programmatique sans la garde requête) :
		// fallback « maintenant » pour garder un email cohérent.
		const deletedAt = e.record.getString('deletedAt') || nowPbDate();
		const purgeDate = computePurgeDate(deletedAt);
		const purgeDateStr = purgeDate ? formatDateFR(purgeDate.toISOString().split('T')[0]) : '';
		email = buildDeletedEmail(e.record, authorName, purgeDateStr);
	} else {
		email = buildRestoredEmail(e.record, authorName);
	}

	// Best-effort : la transition est déjà commitée, un échec d'envoi ne doit
	// ni faire échouer la requête ni couper les autres destinataires.
	for (const recipient of recipients) {
		let user;
		try {
			user = e.app.findRecordById('users', recipient.userId);
		} catch {
			continue;
		}
		try {
			sendIndividualEmail(e.app, user, email.subject, email.html, email.text);
		} catch (err) {
			e.app.logger().error(
				'[PlanningDeletion] email failed',
				'err',
				err?.message || String(err),
				'userId',
				recipient.userId
			);
		}
	}

	e.next();
}, 'planning_masters');

// ============================================
// Cron de purge (fenêtre de grâce échue)
// ============================================

cronAdd('planning-purge', '0 1 * * *', () => {
	const { GRACE_PERIOD_DAYS } = require(`${__hooks}/planning-deletion-utils.cjs`);

	const cutoffDate = new Date();
	cutoffDate.setUTCDate(cutoffDate.getUTCDate() - GRACE_PERIOD_DAYS);
	const cutoff = cutoffDate.toISOString().replace('T', ' ');

	const candidates = $app.findRecordsByFilter(
		'planning_masters',
		'deleted = true && deletedAt != "" && deletedAt < {:cutoff}',
		'',
		0,
		0,
		{ cutoff }
	);

	let purged = 0;
	let failed = 0;

	for (const candidate of candidates) {
		const masterId = candidate.get('id');
		try {
			$app.runInTransaction((txApp) => {
				// Re-fetch frais : une restauration concurrente doit gagner la
				// course purge↔restauration.
				const fresh = txApp.findRecordById('planning_masters', masterId);
				if (!fresh.getBool('deleted')) return;

				// Références d'identité non couvertes par la cascade du schéma.
				// Le filtre `~` ne matche que du texte sérialisé : le retrait
				// exact (relation multi / clé JSON) se fait en JS.
				const users = txApp.findRecordsByFilter(
					'users',
					'masterId ~ {:mid} || adminOf ~ {:mid}',
					'',
					0,
					0,
					{ mid: `%${masterId}%` }
				);
				for (const user of users) {
					try {
						let changed = false;

						const masterIds = user.get('masterId') || [];
						const filtered = masterIds.filter((mid) => mid !== masterId);
						if (filtered.length !== masterIds.length) {
							user.set('masterId', filtered);
							changed = true;
						}

						const rawAdminOf = user.getString('adminOf');
						if (rawAdminOf && rawAdminOf !== 'null' && rawAdminOf !== '') {
							try {
								const adminOf = JSON.parse(rawAdminOf);
								if (adminOf && typeof adminOf === 'object' && masterId in adminOf) {
									delete adminOf[masterId];
									user.set('adminOf', adminOf);
									changed = true;
								}
							} catch {
								/* adminOf corrompu — la purge ne doit pas échouer pour ça */
							}
						}

						if (changed) txApp.save(user);
					} catch (err) {
						$app.logger().error(
							'[PlanningDeletion] identity cleanup failed',
							'err',
							err?.message || String(err),
							'userId',
							user.get('id'),
							'masterId',
							masterId
						);
					}
				}

				// La cascade du schéma emporte occurrences, prefs, locks et events.
				txApp.delete(fresh);
			});
			purged++;
		} catch (err) {
			failed++;
			$app.logger().error(
				'[PlanningDeletion] purge failed',
				'err',
				err?.message || String(err),
				'masterId',
				masterId
			);
		}
	}

	$app.logger().info(
		'[PlanningDeletion] purge done',
		'scanned',
		candidates.length,
		'purged',
		purged,
		'failed',
		failed
	);
});
