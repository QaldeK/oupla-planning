# Spec — 03 : planningActions — séparer les trois étages

**Issue** : [issues/03-planning-actions-three-tiers.md](issues/03-planning-actions-three-tiers.md) · **Revue** : candidate 3, `.scratch/architecture-review/20261015-212715.html`
**Date** : 2026-10-16 · **Statut** : prête pour implémentation (grilling bouclé en session, décisions verrouillées)

## 1. Objectif

Éclater `src/lib/services/planningActions.ts`
(764 l., ~27 exports, 12 callers) selon ses trois étages : un module **pur**
`occurrenceDiff` (le diff d'occurrences, ~140 l. noyées dans
`updatePlanningWithOccurrences` l.314–452), un module de **mutations** propriétaire de
`lastModifiedBy` (×17 dans le fichier) et de la résolution du token (aujourd'hui threadé
par chaque caller depuis `$page.params`), et les **helpers purs** déménagés hors du
service (aujourd'hui payants : leur import déclenche la cascade PocketBase → pb-sync →
Dexie, cf. le polyfill fake-indexeddb documenté dans
[tests/unit/setup.ts](../../../tests/unit/setup.ts)). Les six exports morts sont
supprimés (vérifié : zéro caller en production ; quatre d'entre eux ne vivent que dans la
suite d'intégration). Aucun changement de comportement — un déplacement de code, pas une
réécriture.

## 2. Décisions arrêtées (grilling en session, 2026-10-16)

| # | Décision |
|---|---|
| D1 | **Ticket 03 seul**, en laissant une couture propre que le [ticket 08](issues/08-planning-store-token-cache.md) réutilisera (le 08 est needs-triage : il ne tire pas le périmètre). |
| D2 | **Token via un module de contexte dédié** `activePlanningContext.ts` — token seul, deux fonctions `set`/`get`, pas de runes ; posé par [+layout.svelte](../../../src/routes/+layout.svelte) à côté de `planningStore.setActiveToken`. Évite le cycle services↔stores par construction. **Exceptions assumées** (implémentation) : les créations gardent leurs paramètres tokens — créer un planning, c'est choisir ses tokens (aucun planning actif sur `/new`) ; **`restorePlanning` garde son token explicite** — la restauration exige l'adminToken du master sauvegardé, la page `/p` pouvant être ouverte sous participantToken (redirection post-suppression). |
| D3 | **Pas de façade** : imports directs dans les 12 callers, `planningActions.ts` supprimé. Une façade ferait survivre l'interface large en zombie. |
| D4 | **Trier les exports quasi morts** : `updatePlanning` (test de sécurité réécrit sur `updatePlanningWithOccurrences`) et `createPlanning` (setup réécrit sur `createPlanningWithOccurrences`) réorientés ; `removeParticipant` et `removeResponse` (aucun survivant, morts en prod depuis toujours de l'historique connu — git ne montre qu'eux à `v-0.1`) supprimés avec leurs blocs de test ; `deleteOccurrence` et `submitResponseSafe` (zéro usage partout) supprimés sèchement. |
| D5 | **Le diff ne connaît pas l'horloge** : la fenêtre « futures seulement » reste au caller (requête, ADR-0017) ; le diff reçoit des cibles/existantes déjà filtrées et normalise les dates en interne (pur, déterministe). |
| D6 | **Destinations** : `generateTimeSlotId`, `resolveTimeSlots`, `isOverridden` (+ type `TimeSlotResolvable`) → [utils/slots.ts](../../../src/lib/utils/slots.ts) ; `sortTasks` → [utils/tasks.ts](../../../src/lib/utils/tasks.ts) (amendé en implémentation : `OccurrenceEditModal` l'utilise aussi — la spec initiale le donnait interne) ; `normalizeResponseTypes` → **interne** au module mutations (zéro caller externe, vérifié) ; les 3 générateurs → `utils/tokens.ts` ([/new](../../../src/routes/new/+page.svelte) en dépend). |
| D7 | **`getPlanningByToken` → `planningReads.ts`** (module de lecture fin, n'importe que `pb` — aucun cycle ; le fire-and-forget claim-admin y reste, le 08 le déplacera vers l'activation). **`claimParticipantIdentity` → mutations** (appel serveur porteur de token). |
| D8 | **Les paramètres de cache disparaissent** (`currentMaster?`/`currentOccurrence?` sur 7 fonctions) : les mutations relisent Dexie elles-mêmes. `_currentMaster` (accepté puis ignoré) disparaît avec `updatePlanning`. |

**Découverts en préparation** (verrouillés en session) :
- `participantToken` d'`updatePlanningWithOccurrences` est un **deuxième paramètre mort**
  (présent en signature l.318, jamais lu dans le corps) — il disparaît avec `adminToken` (D2).
- Le layout qui observe `page.params.token` est [+layout.svelte:41-49](../../../src/routes/+layout.svelte#L41) — point de pose du contexte.
- Le terme **Planning actif** est inscrit au [glossaire](../../../CONTEXT.md) (session grilling).

## 3. Interface des modules

```ts
// ── src/lib/services/occurrenceDiff.ts — PUR : n'importe que les types + formatSlotKey ──

export interface OccurrenceDiffOps {
	/** Cibles sans existante matchée → create. */
	creates: OccurrenceTarget[];
	/** Cibles matchées (par id, sinon clé date|slotId) → update ; le un-soft-delete
	 *  est porté par le payload de mutation (deleted: false). */
	updates: { existing: PlanningOccurrence; target: OccurrenceTarget }[];
	/** Existantes actives non ciblées → update { deleted: true }. Les déjà
	 *  soft-deletées non ciblées ne sont jamais retouchées. */
	softDeletes: PlanningOccurrence[];
}

/** Normalise une date PB (`yyyy-MM-dd HH:mm:ss…` → `yyyy-MM-dd`). Exporté pour le
 *  filtre de fenêtre du caller — même normalisation côté diff et côté fenêtre. */
export function normalizeOccurrenceDate(date: string): string;

/** Précondition : entrées déjà filtrées sur la fenêtre de date (D5). */
export function diffPlanningOccurrences(
	targets: OccurrenceTarget[],
	existing: PlanningOccurrence[]
): OccurrenceDiffOps;
```

```ts
// ── src/lib/services/activePlanningContext.ts ──

/** Posé par le layout, à côté de planningStore.setActiveToken. */
export function setActivePlanningToken(token: string | undefined): void;

/** Lève si aucun planning actif (cas /new) — les mutations exigent un planning actif. */
export function getActivePlanningToken(): string;
```

```ts
// ── src/lib/services/planningMutations.ts ──
// Interne : withAudit(data) pose lastModifiedBy ; token lu via activePlanningContext.

export async function createPlanningWithOccurrences(
	data: CreatePlanningData,
	adminToken?: string,       // exception D2 : créer = choisir ses tokens
	participantToken?: string
): Promise<PlanningMaster>;

export async function updatePlanningWithOccurrences(
	masterId: string,
	data: CreatePlanningData,
	expectedVersion?: string   // adminToken/participantToken supprimés (D2 + découvert)
): Promise<PlanningMaster>;

export async function deletePlanning(masterId: string, expectedVersion: string): Promise<void>;
export async function restorePlanning(masterId: string, token: string, expectedVersion: string): Promise<void>;

export async function addParticipant(masterId: string, participant: …): Promise<PlanningMaster>;
export async function updateParticipant(masterId: string, participantId: string, updates: Partial<Participant>): Promise<PlanningMaster>;
export async function quitPlanning(masterId: string, participantId: string): Promise<PlanningMaster>;
export async function updateOccurrence(occurrenceId: string, updates: Partial<PlanningOccurrence>): Promise<PlanningOccurrence>;
export async function submitResponse(occurrenceId: string, participantId: string, response: ParticipantResponse): Promise<PlanningOccurrence>;
export async function addComment(occurrenceId: string, participantId: string, content: string): Promise<PlanningOccurrence>;
export async function deleteComment(occurrenceId: string, commentId: string): Promise<PlanningOccurrence>;
export async function claimParticipantIdentity(masterId: string, guestParticipantId: string): Promise<ClaimIdentityResult>;

// Internes non exportés : withAudit, normalizeResponseTypes (sortTasks vit dans utils/tasks)
```

```ts
// ── src/lib/services/planningReads.ts ──

export type GetPlanningByTokenResult =
	| { master: PlanningMaster; isAdmin: boolean }
	| { error: "network" | "not_found" };

/** Le fire-and-forget claim-admin y reste tel quel — le ticket 08 le déplacera. */
export async function getPlanningByToken(token: string): Promise<GetPlanningByTokenResult>;
```

```ts
// ── src/lib/utils/tokens.ts ──
export function generateAdminToken(): string;        // 64 hex
export function generateParticipantToken(): string;  // 32 hex
export function generateParticipantId(): string;     // 16 hex (sert aussi d'id de commentaire)

// ── src/lib/utils/slots.ts — ajouts ──
export function generateTimeSlotId(existing: { id: string }[]): string;
export function resolveTimeSlots(master: Pick<PlanningMaster, "timeSlots" | "defaultStartTime" | "defaultEndTime">): TimeSlot[];
export function isOverridden(occ: Pick<PlanningOccurrence, "slotId" | "startTime" | "endTime">, master: TimeSlotResolvable): boolean;
```

## 4. Transformations par fichier

### Nouveaux modules
1. [occurrenceDiff.ts](../../../src/lib/services/occurrenceDiff.ts) — le diff extrait de
   `updatePlanningWithOccurrences` (indexation par id puis clé `date|slotId`, match,
   soft-delete des non-ciblées), pur, sans batch ni réseau ni horloge.
2. [planningMutations.ts](../../../src/lib/services/planningMutations.ts) — toutes les
   écritures ; `withAudit` interne pose `lastModifiedBy` une fois ; `getActivePlanningToken()`
   remplace les paramètres token ; les lectures Dexie (`getTable().get`) remplacent les
   paramètres `currentMaster?`/`currentOccurrence?` ; `addComment` lit `current.master`
   depuis sa propre relecture pour `markConversationAsRead`.
3. [planningReads.ts](../../../src/lib/services/planningReads.ts) — `getPlanningByToken` + type de résultat, inchangés.
4. [activePlanningContext.ts](../../../src/lib/services/activePlanningContext.ts) — le contexte de token (D2).

### Fichiers touchés
- [+layout.svelte](../../../src/routes/+layout.svelte) : pose `setActivePlanningToken(token)` à côté de `planningStore.setActiveToken` (l.41-49).
- [planningStore.svelte.ts](../../../src/lib/stores/planningStore.svelte.ts) : import de `getPlanningByToken` → `planningReads` (le fil store→mutations est coupé, plus de cycle possible).
- [new/+page.svelte](../../../src/routes/new/+page.svelte) : générateurs → `utils/tokens`, création → `planningMutations`.
- [p/[token]/+page.svelte](../../../src/routes/p/[token]/+page.svelte) : `addParticipant`, `quitPlanning` → mutations, sans token.
- [admin/[token]/+page.svelte](../../../src/routes/admin/[token]/+page.svelte) : `deletePlanning`, `updatePlanningWithOccurrences` → mutations, sans token.
- [QuitReturnModal.svelte](../../../src/lib/components/QuitReturnModal.svelte), [VolunteerAssignmentModal.svelte](../../../src/lib/components/occurrences/VolunteerAssignmentModal.svelte), [IdentityClaimModal.svelte](../../../src/lib/components/IdentityClaimModal.svelte), [OccurrenceEditModal.svelte](../../../src/lib/components/occurrences/OccurrenceEditModal.svelte), [CommentSection.svelte](../../../src/lib/components/CommentSection.svelte), [occurrenceState.svelte.ts](../../../src/lib/components/occurrences/shared/occurrenceState.svelte.ts), [occurrenceConfirmLogic.svelte.ts](../../../src/lib/components/occurrences/shared/occurrenceConfirmLogic.svelte.ts) : imports → mutations, params token/cache retirés des appels ; props `token` devenues inutiles supprimées.
- [PlanningForm.svelte](../../../src/lib/components/PlanningForm.svelte) : `generateTimeSlotId` → `utils/slots`.
- [utils/slots.ts](../../../src/lib/utils/slots.ts), `utils/tokens.ts` : réception des helpers (D6).
- **Supprimé** : `planningActions.ts`.

### pocketbase — aucun changement
Hooks, règles et migrations intacts. ADR-0001 (`_token` query param), ADR-0003 (écritures
pb-sync) et ADR-0012 (createRule batch avec `_token` admin) respectés ; le batch inline
`pb.createBatch()` reste tel quel (le ticket 05 tranchera `executeBatch` vs inline).

## 5. Comportements préservés / changements assumés

**Préservés** : tout le comportement réseau et serveur ; OCC (`_version`) ; sémantique du
diff (match, override porté par la cible, un-soft-delete, soft-delete des non-ciblées) ;
côté UI, zéro changement de rendu.

**Changements (interfaces uniquement, assumés)** :
1. Les mutations exigent un planning actif (`getActivePlanningToken` lève sinon) —
   équivalent fonctionnel : aucun caller actuel n'agit hors d'une page de planning.
2. `deletePlanning`/`restorePlanning` envoient désormais `lastModifiedBy` (via `withAudit`)
   — neutralisé côté serveur : le hook F5 le forge depuis le contexte d'auth pour un
   utilisateur authentifié, et la clé part `undefined` (omise du JSON) pour un guest.
3. Six exports disparaissent (`createPlanning`, `updatePlanning`, `removeParticipant`,
   `removeResponse`, `deleteOccurrence`, `submitResponseSafe`) — cf. D4 pour le sort de leurs tests.
4. `updatePlanningWithOccurrences` perd `adminToken`/`participantToken` ; les 7 mutations
   à paramètre cache perdent ce paramètre.

## 6. Tests

**Nouveau — [tests/unit/occurrenceDiff.test.ts](../../../tests/unit/occurrenceDiff.test.ts)**
(node pur, millisecondes) — cas pairs : match par id ; fallback clé `date|slotId` ;
horaires d'override portés par la cible ; un-soft-delete d'une existante désactivée ;
soft-delete des actives non ciblées ; soft-deletées non ciblées ignorées ; cibles vides →
aucune op ; dates avec suffixe temps normalisées.

**Réorientés** :
- [isOverridden.test.ts](../../../tests/unit/isOverridden.test.ts) et
  [timeSlotId.test.ts](../../../tests/unit/timeSlotId.test.ts) : import depuis `utils/slots` (contenu inchangé).
- [planning-actions.test.ts](../../../tests/integration/planning-actions.test.ts) :
  chaque test pose le planning actif via `setActivePlanningToken(token)` (la couture D2
  rend le niveau service testable proprement) ; setup `createPlanning` →
  `createPlanningWithOccurrences` ; le test de sécurité « token participant ne peut pas
  updater » → `updatePlanningWithOccurrences` + token participant posé ; blocs
  `removeParticipant`/`removeResponse` supprimés.
- [planning-create-flow.test.ts](../../../tests/integration/planning-create-flow.test.ts)
  et [claim-identity.test.ts](../../../tests/integration/claim-identity.test.ts) :
  imports + pose du contexte, comportements inchangés.
- `setup.ts` unitaire : le polyfill fake-indexeddb **reste** (d'autres modules le justifient) ;
  son commentaire évolue si la cascade qu'il décrit change.

**Ordre d'implémentation proposé** : ① utils (slots/tokens) → ② occurrenceDiff + tests
unitaires → ③ reads + contexte + layout → ④ mutations + migration des 12 callers →
⑤ suppression de `planningActions.ts` + réécritures intégration.

**Validation complète** : `bun run check` + `bun run test:unit` + `bun run test:integration`
(les trois), plus `svelte-autofixer` sur les composants touchés.

## 7. Critères d'acceptation (= checkboxes de l'issue)

1. Le diff d'occurrences vit dans un module pur, testé sans instance PocketBase → §6.
2. Les mutations posent `lastModifiedBy` (un seul site : `withAudit`) et résolvent le token
   elles-mêmes ; aucun caller ne thread plus token ni cache.
3. Les paramètres `currentMaster?`/`currentOccurrence?` ont disparu — ainsi que les deux
   paramètres morts (`_currentMaster`, `participantToken`).
4. Les six exports morts sont supprimés, leurs tests réorientés ou retirés (D4).
5. `bun run check` + `test:unit` + `test:integration` passent.

## 8. Hors périmètre

- Ticket 08 : déplacement du claim-admin vers l'activation, suppression du `#tokenCache` du store.
- Ticket 05 : choix `executeBatch` vs batch inline dans `updatePlanningWithOccurrences`.
- Toute évolution sémantique du diff (règles d'override, fenêtre de date) — refactor pur.
