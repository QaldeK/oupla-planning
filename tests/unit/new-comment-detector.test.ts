import { describe, it, expect } from 'vitest';

// Mock isolé (pas de PocketBase nécessaire) qui valide la détection des
// ajouts/suppressions de commentaires sur planning_occurrences.comments.
// Les records PB sont mockés via mkRecord() avec un .original() reflectif.
//
// Couverture :
//   - Ajout simple, suppression simple, ajout multiple (batch)
//   - Ajout + suppression simultanés
//   - IDs stables avec content ≠ → ignoré (pas de `modified` en v1)
//   - Pas de changement → tableaux vides
//   - contentPreview : troncature à 130 chars avec ellipsis + strip \n

// ============================================================================
// Module under test — dynamic import pour bénéficier de l'interopérabilité
// CommonJS (le hook exporte via `module.exports`).
// ============================================================================

const { detectCommentChanges, MAX_CONTENT_PREVIEW, buildContentPreview } =
	await import('../../pocketbase/pb_hooks/new-comment-detector.js');

// ============================================================================
// Factory de mock pour core.Record — getString renvoie la string brute telle
// qu'exposée par la JSVM (les champs JSON sont des strings JSON sérialisées).
// ============================================================================

function mkRecord(data: Record<string, unknown>): any {
	return {
		get(field: string) {
			return data[field];
		},
		getString(field: string) {
			const v = data[field];
			if (v === null || v === undefined) return '';
			if (typeof v === 'string') return v;
			if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
			return String(v);
		},
		original() {
			return mkRecord(this._originalData);
		}
	};
}

/** Construit une paire (record, original) où `record.original()` renvoie l'état pré-update. */
function mkUpdatePair(
	originalData: Record<string, unknown>,
	updatedFields: Record<string, unknown>
): any {
	const newData = { ...originalData, ...updatedFields };
	const rec = mkRecord(newData);
	rec._originalData = originalData;
	return rec;
}

/** Sérialise un tableau de commentaires en string JSON (format exposé par la JSVM). */
function comments(...cs: Array<{ id: string; content?: string; createdAt?: string }>): string {
	return JSON.stringify(cs);
}

const BASE_OCC: Record<string, unknown> = {
	id: 'o1',
	master: 'm1',
	comments: comments(),
	lastModifiedBy: 'user-author-1'
};

// ============================================================================
// Cas de test
// ============================================================================

describe('Ajout simple', () => {
	it('1 nouveau commentaire → added contient 1 descripteur, removed vide', () => {
		const rec = mkUpdatePair(BASE_OCC, {
			comments: comments({ id: 'c1', content: 'Bonjour', createdAt: '2026-07-25T10:00:00.000Z' })
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.removed).toEqual([]);
		expect(res.added).toHaveLength(1);
		expect(res.added[0].commentId).toBe('c1');
		expect(res.added[0].commentCreatedAt).toBe('2026-07-25T10:00:00.000Z');
		expect(res.added[0].contentPreview).toBe('Bonjour');
	});

	it('authorName reflète lastModifiedBy (résolu en nom affichable par le hook)', () => {
		const rec = mkUpdatePair(BASE_OCC, {
			comments: comments({ id: 'c1', content: 'Hi', createdAt: '2026-07-25T10:00:00.000Z' })
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.added[0].authorName).toBe('user-author-1');
	});
});

describe('Suppression simple', () => {
	it('1 commentaire disparu → removed contient son ID, added vide', () => {
		const before = {
			...BASE_OCC,
			comments: comments({ id: 'c1', content: 'Bonjour', createdAt: '2026-07-25T10:00:00.000Z' })
		};
		const rec = mkUpdatePair(before, { comments: comments() });
		const res = detectCommentChanges(rec, rec.original());
		expect(res.added).toEqual([]);
		expect(res.removed).toEqual(['c1']);
	});
});

describe('Ajout multiple (batch)', () => {
	it("3 nouveaux commentaires d'un coup → added contient 3 descripteurs", () => {
		const rec = mkUpdatePair(BASE_OCC, {
			comments: comments(
				{ id: 'c1', content: 'Un', createdAt: '2026-07-25T10:00:00.000Z' },
				{ id: 'c2', content: 'Deux', createdAt: '2026-07-25T10:00:01.000Z' },
				{ id: 'c3', content: 'Trois', createdAt: '2026-07-25T10:00:02.000Z' }
			)
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.removed).toEqual([]);
		expect(res.added.map((a) => a.commentId)).toEqual(['c1', 'c2', 'c3']);
	});
});

describe('Ajout + suppression simultanés', () => {
	it('1 supprimé + 2 ajoutés dans la même update', () => {
		const before = {
			...BASE_OCC,
			comments: comments(
				{ id: 'old', content: 'Ancien', createdAt: '2026-07-24T10:00:00.000Z' },
				{ id: 'kept', content: 'Gardé', createdAt: '2026-07-24T10:00:01.000Z' }
			)
		};
		const rec = mkUpdatePair(before, {
			comments: comments(
				{ id: 'kept', content: 'Gardé', createdAt: '2026-07-24T10:00:01.000Z' },
				{ id: 'new1', content: 'Nouveau 1', createdAt: '2026-07-25T10:00:00.000Z' },
				{ id: 'new2', content: 'Nouveau 2', createdAt: '2026-07-25T10:00:01.000Z' }
			)
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.removed).toEqual(['old']);
		expect(res.added.map((a) => a.commentId).sort()).toEqual(['new1', 'new2']);
	});
});

describe('IDs stables avec content ≠ (pas de modified en v1)', () => {
	it("un commentaire dont seul le content change n'est ni ajouté ni supprimé", () => {
		const before = {
			...BASE_OCC,
			comments: comments({ id: 'c1', content: 'Avant', createdAt: '2026-07-25T10:00:00.000Z' })
		};
		const rec = mkUpdatePair(before, {
			comments: comments({ id: 'c1', content: 'Après', createdAt: '2026-07-25T10:00:00.000Z' })
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.added).toEqual([]);
		expect(res.removed).toEqual([]);
	});
});

describe('Pas de changement', () => {
	it('comments identiques pré/post → tableaux vides', () => {
		const before = {
			...BASE_OCC,
			comments: comments({ id: 'c1', content: 'X', createdAt: '2026-07-25T10:00:00.000Z' })
		};
		const rec = mkUpdatePair(before, {
			comments: comments({ id: 'c1', content: 'X', createdAt: '2026-07-25T10:00:00.000Z' })
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.added).toEqual([]);
		expect(res.removed).toEqual([]);
	});
});

describe('contentPreview — troncature + strip \\n', () => {
	it('tronque à 130 chars avec ellipsis au-delà de la limite', () => {
		const long = 'x'.repeat(MAX_CONTENT_PREVIEW + 50);
		expect(buildContentPreview(long)).toBe('x'.repeat(MAX_CONTENT_PREVIEW) + '…');
	});

	it('ne tronque pas à la limite exacte (130 chars → sans ellipsis)', () => {
		const exact = 'y'.repeat(MAX_CONTENT_PREVIEW);
		expect(buildContentPreview(exact)).toBe(exact);
	});

	it('strip les sauts de ligne en single-line', () => {
		expect(buildContentPreview('ligne1\nligne2')).toBe('ligne1 ligne2');
		expect(buildContentPreview('a\n\nb')).toBe('a b');
		expect(buildContentPreview('a \n b')).toBe('a b');
	});

	it("l'aperçu d'un commentaire ajouté est tronqué + single-line", () => {
		const long = 'ligne1\nligne2\n' + 'z'.repeat(MAX_CONTENT_PREVIEW + 10);
		const rec = mkUpdatePair(BASE_OCC, {
			comments: comments({ id: 'c1', content: long, createdAt: '2026-07-25T10:00:00.000Z' })
		});
		const res = detectCommentChanges(rec, rec.original());
		const preview = res.added[0].contentPreview;
		expect(preview).not.toContain('\n');
		// 130 chars de contenu (collapsé) + ellipsis
		expect(preview.length).toBe(MAX_CONTENT_PREVIEW + 1);
		expect(preview.endsWith('…')).toBe(true);
	});
});

describe('Robustesse', () => {
	it('comments manquant / null → traité comme tableau vide', () => {
		const before = { id: 'o1', master: 'm1', lastModifiedBy: 'u1' };
		const rec = mkUpdatePair(before, {
			comments: comments({ id: 'c1', content: 'Hi', createdAt: '2026-07-25T10:00:00.000Z' })
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.added).toHaveLength(1);
		expect(res.removed).toEqual([]);
	});

	it('commentaire sans id ignoré', () => {
		const rec = mkUpdatePair(BASE_OCC, {
			comments: comments({ content: 'pas id', createdAt: '2026-07-25T10:00:00.000Z' } as never)
		});
		const res = detectCommentChanges(rec, rec.original());
		expect(res.added).toEqual([]);
	});
});
