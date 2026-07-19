import { describe, it, expect } from 'vitest';
import path from 'path';
import { readFileSync } from 'fs';
import { CASES, mkRecord, buildCtx } from './notify-templates.cases';

// Validation isolée (pas de PocketBase) du rendu des templates de notification.
// Les cas de test sont définis dans notify-templates.cases.ts (source de vérité
// partagée avec notify-templates.snapshot.ts).

// ============================================================================
// Module under test — contournement de l'interop CJS de Vite.
//
// notify-templates.js fait `require(`${__hooks}/notify-utils.js`)` au top
// level. Vite ne sait pas transformer ce require dynamique (template literal
// + package.json "type": "module" + module.exports dans notify-utils.js) et
// tente de le résoudre statiquement comme un import ESM, ce qui échoue.
//
// Solution : on lit le source, on remplace le require CJS et le module.exports
// par des références à des globales qu'on injecte, puis on charge le source
// modifié via une data URL. Vite n'intervient pas sur cette chaîne, donc pas
// de résolution statique erronée.
// ============================================================================

const HOOKS_DIR = path.resolve(__dirname, '../../', 'pocketbase/pb_hooks');

// Pré-import de notify-utils via Vite (qui gère son module.exports via son
// plugin CJS quand c'est un import statique).
const notifyUtils = await import('../../pocketbase/pb_hooks/notify-utils.js');
(globalThis as any).__notifyUtils__ = notifyUtils;

// Source de notify-templates.js avec le require CJS et le module.exports
// remplacés par des références à des globales, pour exécution sous Vite ESM.
const templatesSource = readFileSync(path.join(HOOKS_DIR, 'notify-templates.js'), 'utf-8')
	.replace(/require\(`\$\{__hooks\}\/notify-utils\.js`\)/, 'globalThis.__notifyUtils__')
	.replace(/module\.exports\s*=\s*\{/, 'globalThis.__templates_exports__ = {');

const templatesDataUrl =
	'data:text/javascript;base64,' + Buffer.from(templatesSource, 'utf-8').toString('base64');
await import(/* @vite-ignore */ templatesDataUrl);
const templates = (globalThis as any).__templates_exports__;

// ============================================================================
// Cas de test (définis dans notify-templates.cases.ts)
//
// Les expected* sont déclarés à part pour rester proches des assertions et
// faciliter les évolutions (le snapshot n'a pas besoin de ces champs).
// ============================================================================

type CaseExpectations = {
	expectedSubjectContains: string[];
	expectedBodyContains: string[];
};

// Aligné sur spec v2 (.scratch/notify-templates-rework-spec.md §3).
const EXPECTATIONS: Record<number, CaseExpectations> = {
	1: {
		expectedSubjectContains: ['Rappel', 'Repas hebdo'],
		expectedBodyContains: ['Rappel — mar. 31 mars', "L'événement a lieu demain", 'présent·e']
	},
	2: {
		expectedSubjectContains: ['Rappel', 'Repas hebdo'],
		expectedBodyContains: [
			"L'événement a lieu demain",
			'présent·e',
			'Préparer salle (avant)',
			'Accueil (pendant)',
			"n'est pas encore confirmé"
		]
	},
	3: {
		expectedSubjectContains: ['Modification', 'Repas hebdo'],
		expectedBodyContains: [
			'Modification — mar. 31 mars',
			"L'horaire de début a été modifié",
			'19h00 → 20h00'
		]
	},
	4: {
		expectedSubjectContains: ['Annulation', 'Repas hebdo'],
		expectedBodyContains: ['Annulation — mar. 31 mars', "L'événement a été annulé", 'Sarah']
	},
	5: {
		expectedSubjectContains: ['Participants manquants', 'Repas hebdo'],
		expectedBodyContains: [
			'Participants manquants — dim. 5 avr.',
			'Quorum insuffisant',
			'présent·e·s confirmé·e·s sur 5 requis',
			'si besoin',
			'incertain·e·s',
			'Tâches à pourvoir',
			'Accueil (0/2)',
			'Rangement (1/3)'
		]
	},
	6: {
		expectedSubjectContains: ['À confirmer', 'Repas hebdo'],
		expectedBodyContains: [
			'À confirmer — dim. 5 avr.',
			"est prévu dans 3 jours mais n'est pas encore confirmé",
			"En tant qu'",
			'confirmez sa tenue'
		]
	},
	7: {
		expectedSubjectContains: ['À confirmer', 'Repas hebdo'],
		expectedBodyContains: [
			'Quorum insuffisant',
			'présent·e',
			'Préparer salle (avant)',
			// Le reminder ne doit PAS répéter "dans 3 jours" (déjà dit par la
			// confirmation présente dans le même bloc — voir spec §4.2).
			"est prévu dans 3 jours mais n'est pas encore confirmé"
		]
	},
	8: {
		expectedSubjectContains: ['Important', 'Repas hebdo', '3 événements'],
		expectedBodyContains: [
			'Annulation — mar. 31 mars',
			"L'événement a été annulé",
			'Modification — dim. 5 avr.',
			'Le lieu a été modifié',
			'Salle des fêtes → Gymnase',
			"L'événement a lieu demain",
			'présent·e',
			'Rangement (après)'
		]
	},
	9: {
		expectedSubjectContains: ['5 modifications', 'Repas hebdo'],
		expectedBodyContains: [
			"L'horaire de début a été modifié",
			'Le lieu a été modifié',
			'+ 2 autres'
		]
	}
};

// ============================================================================
// Tests
// ============================================================================

describe('notify-templates — 9 maquettes § 13.8', () => {
	for (let i = 0; i < CASES.length; i++) {
		const c = CASES[i];
		const num = i + 1;
		const exp = EXPECTATIONS[num];

		it(c.name, () => {
			const master = mkRecord(c.master);
			const ctx = buildCtx(master, c.occs);

			const subject = templates.buildSubject(master, c.events, ctx);
			const body = templates.buildTextEmail(master, c.events, c.user, ctx);

			for (const s of exp.expectedSubjectContains) {
				expect(subject).toContain(s);
			}
			for (const s of exp.expectedBodyContains) {
				expect(body).toContain(s);
			}
		});
	}
});

// Garde-fou anti-régression : on s'assure que les 9 cas ont bien leurs
// expectations définies. Évite les silently-skipped si on ajoute un cas dans
// cases.ts sans remplir EXPECTATIONS.
it('chaque cas a ses expectations définies', () => {
	expect(Object.keys(EXPECTATIONS).length).toBe(CASES.length);
	for (let i = 0; i < CASES.length; i++) {
		expect(EXPECTATIONS[i + 1]).toBeDefined();
	}
});

// ============================================================================
// Tests du corps HTML (buildHtmlEmail)
//
// On ne refait pas toute la couverture du texte — on cible les spécificités
// HTML : lien footer ?notif=1, balise <s> pour lieu barré, absence de ✅
// (remplacé par ⏳) pour les confirmations.
// ============================================================================

describe('notify-templates — buildHtmlEmail', () => {
	function htmlForCase(idx: number): string {
		const c = CASES[idx];
		const master = mkRecord(c.master);
		const ctx = buildCtx(master, c.occs);
		return templates.buildHtmlEmail(master, c.events, c.user, ctx);
	}

	it('Cas 4 (cancel) — footer contient le lien ?notif=1 cliquable', () => {
		const html = htmlForCase(3); // Cas 4
		expect(html).toContain('href="https://planning.oupla.net/p/abc123?notif=1"');
		expect(html).toContain('ajuster vos notifications');
	});

	it('Cas 6 (confirmation) — emoji ⏳ présent (pas ✅)', () => {
		const html = htmlForCase(5); // Cas 6
		expect(html).toContain('⏳');
		expect(html).not.toContain('✅');
	});

	it("Cas 8 (change lieu) — balise <s> sur l'ancien lieu", () => {
		const html = htmlForCase(7); // Cas 8
		expect(html).toContain(
			'<s style="text-decoration:line-through;color:#9ca3af;">Salle des fêtes</s>'
		);
		expect(html).toContain('→ Gymnase');
		// Pas de marqueur brut [[s]] qui aurait fuité
		expect(html).not.toContain('[[s]]');
	});
});

// ============================================================================
// Tests unitaires des helpers
// ============================================================================

describe('notify-templates — helpers contextuels', () => {
	describe('_buildContextualLine (reminder)', () => {
		it('J-1 → "L\'événement a lieu demain."', () => {
			expect(templates._buildContextualLine(1)).toBe("L'événement a lieu demain.");
		});
		it('J-N (N≥2) → "L\'événement a lieu dans N jours."', () => {
			expect(templates._buildContextualLine(3)).toBe("L'événement a lieu dans 3 jours.");
			expect(templates._buildContextualLine(15)).toBe("L'événement a lieu dans 15 jours.");
		});
		it('J-0 ou absent → ligne vide', () => {
			expect(templates._buildContextualLine(0)).toBe('');
			expect(templates._buildContextualLine(undefined)).toBe('');
			expect(templates._buildContextualLine(null)).toBe('');
		});
	});

	describe('_buildConfirmationContextualLine (confirmation admin)', () => {
		it('J-1 → "...prévu demain mais n\'est pas encore confirmé."', () => {
			expect(templates._buildConfirmationContextualLine(1)).toBe(
				"L'événement est prévu demain mais n'est pas encore confirmé."
			);
		});
		it('J-N (N≥2) → "...prévu dans N jours mais..."', () => {
			expect(templates._buildConfirmationContextualLine(3)).toBe(
				"L'événement est prévu dans 3 jours mais n'est pas encore confirmé."
			);
		});
		it('J-0/absent → "L\'événement n\'est pas encore confirmé."', () => {
			expect(templates._buildConfirmationContextualLine(0)).toBe(
				"L'événement n'est pas encore confirmé."
			);
		});
	});

	describe('_stripStrikeMarkers / _renderStrikeForHtml', () => {
		it('texte : supprime les marqueurs [[s]][[/s]]', () => {
			expect(templates._stripStrikeMarkers('[[s]]ancien[[/s]] → nouveau')).toBe('ancien → nouveau');
		});
		it('html : convertit en <s> stylé', () => {
			// Le contenu doit déjà être échappé par l'appelant (voir buildHtmlEmail).
			const escaped = '[[s]]Salle des fêtes[[/s]] → Gymnase';
			expect(templates._renderStrikeForHtml(escaped)).toBe(
				'<s style="text-decoration:line-through;color:#9ca3af;">Salle des fêtes</s> → Gymnase'
			);
		});
	});
});

// ============================================================================
// Edge cases des renderers
// ============================================================================

describe('notify-templates — edge cases', () => {
	it('_renderChangeLine sans payload retourné la phrase générique', () => {
		const ev = { type: 'schedule_change', changedBy: 'u1', payload: {} };
		const line = templates._renderChangeLine(ev, { userNamesById: new Map([['u1', 'Sarah']]) });
		expect(line).toBe("L'événement a été modifié (par Sarah).");
	});

	it('_renderChangeLine status_confirmed → phrase dédiée', () => {
		const ev = { type: 'status_confirmed', changedBy: 'u1', payload: {} };
		const line = templates._renderChangeLine(ev, { userNamesById: new Map([['u1', 'Sarah']]) });
		expect(line).toBe("L'événement a été confirmé (par Sarah).");
	});

	it('_renderCancelLine status_deleted → phrase "supprimé"', () => {
		const ev = { type: 'status_deleted', changedBy: 'u1', payload: {} };
		const line = templates._renderCancelLine(ev, { userNamesById: new Map([['u1', 'Sarah']]) });
		expect(line).toBe("L'événement a été supprimé (par Sarah).");
	});

	it('_renderMissingsLine task_unassigned → pas de ligne quorum, juste les tâches', () => {
		const occ = mkRecord({ minPresentRequired: 5 });
		const ev = {
			type: 'task_unassigned',
			payload: {
				tasksToFill: [{ name: 'Accueil', signedUp: 0, required: 2 }]
			}
		};
		const lines = templates._renderMissingsLine(ev, occ);
		expect(lines.length).toBe(1);
		expect(lines[0]).toContain('Tâches à pourvoir');
		expect(lines[0]).toContain('Accueil (0/2)');
		// Pas de ligne "Quorum insuffisant"
		expect(lines.some((l: string) => l.includes('Quorum'))).toBe(false);
	});

	describe('_renderMissingsLine — combinaisons de compteurs', () => {
		const occ = mkRecord({ minPresentRequired: 5 });

		function missingsEv(payload: Record<string, unknown>) {
			return { type: 'quorum_missing', payload };
		}

		it('ifNeeded > 0 et maybe > 0 → "X si besoin, Y incertain·e·s."', () => {
			const lines = templates._renderMissingsLine(
				missingsEv({ presentCount: 1, ifNeededCount: 2, maybeCount: 3, minPresentRequired: 5 }),
				occ
			);
			expect(lines[0]).toContain('1 présent·e·s confirmé·e·s sur 5 requis');
			expect(lines[1]).toBe('2 si besoin, 3 incertain·e·s.');
			expect(lines.length).toBe(2);
		});

		it('ifNeeded > 0 et maybe = 0 → "X si besoin." seul', () => {
			const lines = templates._renderMissingsLine(
				missingsEv({ presentCount: 1, ifNeededCount: 2, maybeCount: 0, minPresentRequired: 5 }),
				occ
			);
			expect(lines[1]).toBe('2 si besoin.');
			expect(lines.length).toBe(2);
		});

		it('ifNeeded = 0 et maybe > 0 → "Y incertain·e·s." seul', () => {
			const lines = templates._renderMissingsLine(
				missingsEv({ presentCount: 1, ifNeededCount: 0, maybeCount: 3, minPresentRequired: 5 }),
				occ
			);
			expect(lines[1]).toBe('3 incertain·e·s.');
			expect(lines.length).toBe(2);
		});

		it('ifNeeded = 0 et maybe = 0 → pas de 2e ligne', () => {
			const lines = templates._renderMissingsLine(
				missingsEv({ presentCount: 0, ifNeededCount: 0, maybeCount: 0, minPresentRequired: 5 }),
				occ
			);
			expect(lines.length).toBe(1);
			expect(lines[0]).toContain('0 présent·e·s confirmé·e·s sur 5 requis');
		});

		it('payload legacy avec noReplyCount (non produit par le cron) → ignoré, pas de crash', () => {
			// Défensif : si un event déjà en DB porte l'ancien payload, le rendu
			// ne doit pas crasher. noReplyCount est simplement ignoré.
			const lines = templates._renderMissingsLine(
				missingsEv({
					presentCount: 1,
					maybeCount: 1,
					noReplyCount: 5,
					minPresentRequired: 5
				}),
				occ
			);
			expect(lines[1]).toBe('1 incertain·e·s.');
			expect(lines.some((l: string) => l.includes('sans-réponse'))).toBe(false);
		});
	});

	it('_renderChangeLine multi-champs → phrase englobante', () => {
		const ev = {
			type: 'schedule_change',
			changedBy: 'u1',
			payload: {
				oldStartTime: '19:00',
				newStartTime: '20:00',
				oldPlace: 'Salle',
				newPlace: 'Gymnase'
			}
		};
		const line = templates._renderChangeLine(ev, { userNamesById: new Map([['u1', 'Sarah']]) });
		expect(line).toContain('Plusieurs détails ont été modifiés');
		expect(line).toContain('horaire 19h00 → 20h00');
		expect(line).toContain('lieu Salle → Gymnase');
	});
});
