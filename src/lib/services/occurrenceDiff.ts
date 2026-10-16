import { formatSlotKey } from "$lib/utils/slots";
import type { OccurrenceTarget, PlanningOccurrence } from "$lib/types/planning.types";

/**
 * Normalise une date PocketBase (`yyyy-MM-dd HH:mm:ss…` ou ISO `T`) vers
 * `yyyy-MM-dd`. Exporté pour que le caller filtre la fenêtre de date avec la
 * même normalisation que la clé de réconciliation.
 */
export function normalizeOccurrenceDate(date: string): string {
	return date.split(" ")[0].split("T")[0];
}

export interface OccurrenceDiffOps {
	/** Cibles sans existante matchée → create. */
	creates: OccurrenceTarget[];
	/**
	 * Cibles matchées (par id, sinon clé `date|slotId`) → update. Le
	 * un-soft-delete est porté par le payload de mutation (`deleted: false`),
	 * pas par le diff.
	 */
	updates: { existing: PlanningOccurrence; target: OccurrenceTarget }[];
	/** Existantes actives non ciblées → soft-delete. Les déjà désactivées
	 *  non ciblées ne sont jamais retouchées. */
	softDeletes: PlanningOccurrence[];
}

/**
 * Réconciliation cibles↔existantes du save multi-occurrences : pur et
 * déterministe — pas de réseau, pas de batch, pas d'horloge (la fenêtre
 * « futures seulement » est filtrée par le caller avant l'appel).
 */
export function diffPlanningOccurrences(
	targets: OccurrenceTarget[],
	existing: PlanningOccurrence[]
): OccurrenceDiffOps {
	// Index des existantes par id ET par clé date|slotId (fallback pour les cibles sans id).
	const existingById = new Map<string, PlanningOccurrence>();
	const existingByKey = new Map<string, PlanningOccurrence>();
	for (const occ of existing) {
		existingById.set(occ.id, occ);
		existingByKey.set(formatSlotKey(normalizeOccurrenceDate(occ.date), occ.slotId), occ);
	}

	const matchedExistingIds = new Set<string>();
	const ops: OccurrenceDiffOps = { creates: [], updates: [], softDeletes: [] };

	for (const target of targets) {
		const targetDate = normalizeOccurrenceDate(target.date);
		let match: PlanningOccurrence | undefined;
		if (target.id) match = existingById.get(target.id);
		if (!match) match = existingByKey.get(formatSlotKey(targetDate, target.slotId));
		if (match) {
			matchedExistingIds.add(match.id);
			ops.updates.push({ existing: match, target });
		} else {
			ops.creates.push(target);
		}
	}

	for (const occ of existing) {
		if (occ.deleted === true) continue;
		if (matchedExistingIds.has(occ.id)) continue;
		ops.softDeletes.push(occ);
	}

	return ops;
}
