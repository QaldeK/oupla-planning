# Spec — 02 : le workflow de réponse aux Occurrences a une seule maison

**Issue** : [issues/02-occurrence-response-workflow.md](issues/02-occurrence-response-workflow.md) · **Revue** : candidate 2, `.scratch/architecture-review/20261015-212715.html`
**Date** : 2026-10-16 · **Statut** : prête pour implémentation (grilling bouclé en session, décisions verrouillées)

## 1. Objectif

Extraire `src/lib/components/occurrences/shared/occurrenceResponseWorkflow.svelte.ts`, propriétaire de la
règle métier « inscrit·e à une tâche pendant (`onEvent`) ⟹ présent·e » et de tout le workflow qui l'entoure :
garde de changement de réponse, `pendingResponseChange`, construction de `ParticipantResponse`, dérivation du
message de confirmation. Les trois surfaces — état partagé participant ([occurrenceState.svelte.ts](../../../src/lib/components/occurrences/shared/occurrenceState.svelte.ts)),
modal admin ([OccurrenceEditModal.svelte](../../../src/lib/components/occurrences/OccurrenceEditModal.svelte)),
affectation volontaires ([VolunteerAssignmentModal.svelte](../../../src/lib/components/occurrences/VolunteerAssignmentModal.svelte)) —
consomment le module au lieu de porter chacune leur copie. Preuves file:line : garde ×2
(`occurrenceState:188` vs `OccurrenceEditModal:207`), construction ×4, auto-`present` ×2 **divergent**,
message ×2 avec deux paires de clés i18n.

## 2. Décisions arrêtées (grilling en session, 2026-10-16)

| # | Décision |
|---|---|
| Q1 | **Une seule factory** `createOccurrenceResponseWorkflow`, paramétrée par `actor: "self" \| "admin"` — pas deux factories fines. La différence self/admin s'écrit dans l'interface (paramètre + closures injectées), pas en duplication. |
| Q2 | **Matrice auto-`present` homogénéisée, refus partout** : ajout d'une tâche pendant avec réponse ≠ `present` → **refus** dans les deux surfaces (la coercition silencieuse admin disparaît) ; ajout sans réponse existante → `present` posé d'office, dans les deux surfaces ; **retrait → jamais de touche à la réponse** (corrige le bug actuel : retirer un volontaire « maybe » d'une tâche pendant le passait à `present`). |
| Q3 | **`ParticipantResponse.comment` supprimé** (champ mort : écrit ×3 depuis v-0.1, jamais lu — les messages vivent dans `occurrence.comments`). Type + 3 sites d'écriture + fixtures de test. Pas de migration PB (`responses` est un champ JSON) ; les valeurs historiques restent stockées, ignorées, et seront écrasées à la prochaine édition de la réponse concernée. |
| Q4 | **i18n : titre unifié seul.** `occurrence_presence_required_title` (doublon exact de `occurrence_response_required_title`) supprimé. Les trois paires 2ᵉ/3ᵉ personne (phrase, avertissement, libellé de confirmation) sont **conservées et documentées comme intentionnelles** — l'ADR-0016 interdit l'injection de sujet (composition de fragments). |
| Q5 | **`submitChange` injecté** : la factory ne connaît ni `networkStore`, ni `toast`, ni `planningActions` → testable en node pur, sans DOM. Les refus/auto-`present` retournent une décision (`resolveTaskToggleOutcome`) ; le toast reste côté surface (2ᵉ personne self, 3ᵉ personne admin). |
| Q6 | **`occurrenceState` garde son API publique** et la validation identité/token (re-identification, `onNeedReidentify`) ; il compose la factory en interne → `OccurrenceView` ne change que pour la source du message de confirmation. |

## 3. Interface du module

```ts
// src/lib/components/occurrences/shared/occurrenceResponseWorkflow.svelte.ts

/** L'acteur qui porte le changement : le participant lui-même, ou l'admin pour son compte. */
export type ResponseActor = "self" | "admin";

export interface ResponseChange {
  participantId: string;
  response: ResponseType;
  tasks: string[];
}

// ── Helpers purs (testés sans DOM) ──────────────────────────────────────────

/** Ids des tâches onEvent parmi les tâches où le participant est inscrit·e. */
export function onEventInscribedIds(tasks: Task[], inscribedTaskIds: string[]): string[];

/** Construction unique de la ligne de réponse. Plus de `comment` (Q3). */
export function buildParticipantResponse(input: {
  participantId: string;
  response: ResponseType;
  tasks: string[];
}): ParticipantResponse;

/**
 * Matrice Q2, identique self et admin :
 *  - retrait, beforeEvent/afterEvent, allowResponses=false, déjà present → { kind: "none" }
 *  - ajout sans réponse existante                        → { kind: "autoPresent" }
 *  - ajout avec réponse ≠ present                        → { kind: "refuse" }
 */
export function resolveTaskToggleOutcome(input: {
  task: Task;
  currentResponse: ResponseType | undefined;
  allowResponses: boolean;
  isAdding: boolean;
}): { kind: "none" } | { kind: "autoPresent" } | { kind: "refuse" };

/** Message de confirmation ; sujet = « vous » (self) ou nom du participant (admin). */
export function deriveConfirmationMessage(
  actor: ResponseActor,
  taskNames: string[],
  participantName?: string
): string;

// ── Factory d'orchestration (runes, testée en node pur) ─────────────────────

export function createOccurrenceResponseWorkflow(getOptions: () => {
  actor: ResponseActor;
  /** Catalogue de tâches effectif (inherited.tasks côté self, tasks côté modal admin). */
  tasks: () => Task[];
  /** Source des inscriptions : selectedTasks (self) ou réponse stockée (admin). */
  getInscribedTaskIds: (participantId: string) => string[];
  /** Requis si actor = "admin" : nom affiché dans le message de confirmation. */
  getDisplayName?: (participantId: string) => string;
  /** Persistance du changement final ; aucune dépendance UI injectée ici (Q5). */
  submitChange: (change: ResponseChange) => Promise<void>;
}): {
  readonly pendingResponseChange: {
    participantId: string;
    participantName: string;
    targetResponse: ResponseType;
    onEventTaskIds: string[];
  } | null;
  /** Garde : cible ≠ present + inscrit·e onEvent → pending ; sinon submit direct. */
  requestResponseChange(participantId: string, targetResponse: ResponseType): void;
  confirmResponseChange(): void;
  cancelResponseChange(): void;
  readonly confirmationMessage: string | null;
};
```

## 4. Transformations par fichier

### [occurrenceState.svelte.ts](../../../src/lib/components/occurrences/shared/occurrenceState.svelte.ts) (surface self)
1. Compose `createOccurrenceResponseWorkflow({ actor: "self", ... })` en interne :
   `getInscribedTaskIds: () => selectedTasks` ; `submitChange: (change) => { selectedResponse = change.response;
   selectedTasks = change.tasks; return handleSubmitResponse(); }`.
2. `setResponse` → `workflow.requestResponseChange(currentUserId, response)` après le contrôle d'identité ;
   `pendingResponseChange`/`confirmResponseChange`/`cancelResponseChange` délégués (API publique inchangée, Q6).
3. `handleSubmitResponse` → construction par `buildParticipantResponse` (le `comment` disparaît).
4. `toggleTask` → `resolveTaskToggleOutcome` : `refuse` → toast `occurrence_must_be_present` (2ᵉ personne,
   inchangé) ; `autoPresent` → `selectedResponse = "present"` ; `none` → toggle simple.
5. Expose `confirmationMessage` (remplace le message porté par `occurrenceConfirmLogic`).

### [occurrenceConfirmLogic.svelte.ts](../../../src/lib/components/occurrences/shared/occurrenceConfirmLogic.svelte.ts)
- Supprime `responseChangeModal` (l.69-85) et `pendingResponseChange` des options : ce factory ne garde que
  confirm/restore d'occurrence, son rôle d'origine.

### [OccurrenceView.svelte](../../../src/lib/components/occurrences/views/OccurrenceView.svelte)
- La `ConfirmModal` self (l.538-548) lit `occState.confirmationMessage` au lieu de
  `confirmLogic.responseChangeModal.message`. Clés title/description/confirm inchangées.

### [OccurrenceEditModal.svelte](../../../src/lib/components/occurrences/OccurrenceEditModal.svelte) (surface admin)
1. Compose la factory : `actor: "admin"`, `getInscribedTaskIds: (id) => occurrence.responses.find(r =>
   r.participantId === id)?.tasks ?? []`, `getDisplayName` via `master.participants`,
   `submitChange: applyResponseChange`.
2. `handleResponseChange` → `workflow.requestResponseChange` ; les états/handlers locaux
   `pendingResponseChange`/`confirmResponseChange`/`cancelResponseChange`/`responseChangeModal` supprimés ;
   la `ConfirmModal` admin lit le workflow (titre → `occurrence_response_required_title`, Q4).
3. `applyResponseChange` et `handleRemoveVolunteerFromTask` construisent via `buildParticipantResponse`
   (plus de `comment`).

### [VolunteerAssignmentModal.svelte](../../../src/lib/components/occurrences/VolunteerAssignmentModal.svelte) (surface volontaires)
1. `toggleVolunteer` : calcule `isAdding` **d'abord**, puis `resolveTaskToggleOutcome` :
   - `refuse` → toast `volunteer_must_be_present` (nouvelle clé, 3ᵉ personne, cf. §5-copie) — **fin de la coercition** ;
   - `autoPresent` (participant sans réponse) → `present` posé ;
   - `none` → toggle, **réponse intacte même au retrait** (fix Q2).
2. Construction via `buildParticipantResponse`.
3. Notice : `volunteer_auto_present_notice` rewordée (le texte actuel « seront automatiquement marqué·es
   Présent·e » promet la coercition supprimée) — proposition FR : « L'inscription à une tâche pendant
   nécessite d'être présent·e » ; EN : « Signing up for a during-task requires being present ».

### [planning.types.ts](../../../src/lib/types/planning.types.ts) + [messages/fr.json](../../../messages/fr.json) / [en.json](../../../messages/en.json)
- Retirer `comment?: string` de `ParticipantResponse` (l.36).
- Supprimer `occurrence_presence_required_title` (doublon exact) ; baser la modal admin sur
  `occurrence_response_required_title`.
- Ajouter la paire `volunteer_must_be_present` — FR : « " {name} " doit être présent·e pour être
  inscrit·e à cette tâche » ; EN : « "{name}" must be present to be assigned to this task »
  (conventions ADR-0016 : point médian, phrase autonome, mêmes clés/placeholders).
- Reworder `volunteer_auto_present_notice` (fr/en, textes ci-dessus).

### pocketbase — aucun changement
Pas de hook, pas de migration : `responses` est un champ JSON, `submitResponse` fusionne tel quel.

## 5. Comportements préservés / changements assumés

**Préservés** : garde de changement de réponse avec confirmation (les deux acteurs) ; refus self sur ajout
conflit ; auto-`present` sans réponse ; validation identité/token et flux re-identify ; stats, inherited,
gating réseau ; sémantique de merge de `submitResponse`.

**Changements (assumés, Q2/Q3)** :
1. Modal volontaires — ajout d'un volontaire ≠ `present` à une tâche pendant : **refus** (aujourd'hui :
   coercition silencieuse). L'admin le passe `present` dans la modal d'édition, puis l'affecte.
2. Modal volontaires — **retrait** d'un volontaire : la réponse n'est plus touchée (aujourd'hui : coercition
   parasite qui passait un « maybe » à `present` en le retirant).
3. Self — retrait d'une tâche pendant avec réponse ≠ `present` : autorisé, réponse intacte (aujourd'hui :
   refus ; cas quasi inatteignable car la garde de changement de réponse désinscrit déjà les tâches pendant).
4. `comment` disparaît des réponses écrites ; valeurs historiques ignorées puis écrasées à l'édition.
5. `occurrenceConfirmLogic` ne porte plus le message de réponse (déplacé dans le workflow).

## 6. Tests

**Unitaires — `tests/unit/occurrence-response-workflow.test.ts`** (node pur, comme
[notification-events.test.ts](../../../tests/unit/notification-events.test.ts) pour le pattern « factory
testée sans DOM » ; `submitChange` mocké) :
- `onEventInscribedIds` : ne retient que `onEvent` ∩ inscrits ; cas vides.
- `buildParticipantResponse` : forme complète, `respondedAt` ISO, **absence de `comment`**.
- `resolveTaskToggleOutcome` : matrice complète (ajout/retrait × present/aucune/≠present ×
  allowResponses) ; retrait → jamais `refuse` ni `autoPresent`.
- Factory : garde → `pending` avec les bons ids ; cible `present` ou non inscrit → submit direct ;
  `confirm` retire les ids onEvent et soumet le changement final ; `cancel` purge ;
  `confirmationMessage` self (2ᵉ pers., singulier/pluriel) vs admin (3ᵉ pers. nommée, singulier/pluriel).
- Le filet [i18n-paraglide-consistency.test.ts](../../../tests/unit/i18n-paraglide-consistency.test.ts)
  attrape automatiquement toute asymétrie fr/en des clés ajoutées/supprimées.

**Suites touchées** : [planning-actions.test.ts](../../../tests/integration/planning-actions.test.ts) —
retirer les fixtures `comment` (l.311, 557, 594, 607, 634, 667, 679, 691, 954) et l'assertion de
préservation (l.615).

**Validation complète** : `bun run check` + `bun run test:unit` + `bun run test:integration` (les trois),
plus `svelte-autofixer` sur les composants touchés.

## 7. Critères d'acceptation (= checkboxes de l'issue)

1. La garde onEvent n'existe qu'à un seul endroit, paramétrée par l'acteur → `onEventInscribedIds` +
   `requestResponseChange`.
2. La construction de `ParticipantResponse` n'existe qu'à un seul endroit → `buildParticipantResponse`.
3. Les deux paires de clés i18n du message de confirmation : titre unifié, paires personne assumées et
   documentées (§2-Q4, §5).
4. La factory est testée sans DOM (garde, construction, matrice, message) → §6.
5. Les trois surfaces consomment le module ; check + test:unit + test:integration passent.

## 8. Hors périmètre

- Ergonomie de la modal volontaires (afficher la réponse courante de chaque participant, désactiver les
  cases incompatibles) — le refus passe par toast, amélioration UX à part.
- Nettoyage des valeurs `comment` historiques en base (ignorées, sans lecteur).
- Ticket 03 (`planningActions` trois étages) : `submitResponse` reste tel quel.
