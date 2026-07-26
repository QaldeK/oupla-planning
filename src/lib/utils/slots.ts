/**
 * Clé de réconciliation date×slot : `${date}|${slotId}`.
 * Utilisée côté formulaire (sélection) et côté service (réconciliation occurrences↔cibles).
 * Source unique — un changement de format ne peut pas casser silencieusement la réconciliation.
 */
export function formatSlotKey(date: string, slotId?: string): string {
	return `${date}|${slotId ?? ""}`;
}
