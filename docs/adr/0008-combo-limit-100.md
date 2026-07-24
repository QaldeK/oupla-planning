# ADR 0008 — Limite de 100 DateSlots futurs actifs

## Status

Accepted

## Context

Le système PlanningForm a historiquement une limite de 100 créneaux planifiés pour éviter les surcharges. Cette limite était implémentée de manière non uniforme :

- En mode récurrent, la génération du cycle de récurrence était tronquée à 100 occurrences (pure) ou l'alerte s'affichait à 100 (comportement variable selon les versions)
- En mode CUSTOM, le picker de dates manuelles limitait à 100 dates manuelles
- En multi-slot (plusieurs créneaux horaires actifs), 100 slots × N dates pouvaient dépasser 100 DateSlots sans être détectés

De plus, la limite de 100 était ambiguë : s'appliquait-elle au nombre de slots, au nombre de dates, ou au nombre de DateSlots (date × slot) ?

## Decision

**La limite de 100 s'applique uniformément aux DateSlots actifs futurs (date × slot).**

### Règles

1. **Compte uniformisé** : Le nombre de DateSlots futurs actifs est calculé comme `count(date_future × slot_actif)`. Les dates passées ne sont pas comptées (filtre d'affichage séparé).

2. **Génération pure** : La fonction qui génère les dates du cycle de récurrence ne tronque plus à 100. Elle produit toutes les dates cycliques futures. Le calcul du nombre de DateSlots futurs actifs est fait sur l'état final.

3. **Ajustement dynamique du picker** : En multi-slot, le picker de dates manuelles ajuste sa `maxSelection` dynamiquement pour respecter la limite de 100 DateSlots au total. Si 2 slots sont actifs et 50 dates manuelles sont déjà sélectionnées, le picker limite à 0 (car 50 × 2 = 100). En mono-slot, le picker limite à 100 dates manuelles (comportement précédent).

4. **Alerte et blocage** :
   - Une alert-warning live s'affiche quand le nombre de DateSlots futurs actifs atteint 100
   - Le submit est bloqué avec un toast quand le nombre de DateSlots futurs actifs dépasse 100

5. **Bouton d'aide** : En mode récurrent, un bouton "Ajuster à la date max" apparaît dans l'alert-warning pour recalculer la `lastDate` du cycle et ramener le compte sous 100.

## Consequences

### Positives

- **Cohérence** : La limite s'applique au même concept partout (DateSlots futurs actifs)
- **Clarté** : Le comportement de l'utilisateur est prévisible en multi-slot
- **Testabilité** : La génération du cycle devient pure (testable sans montage Svelte)
- **Expérience utilisateur** : Le bouton d'aide permet un ajustement en un clic

### Négatives

- **Complexité** : L'ajustement dynamique du picker en multi-slot ajoute une règle de plus à l'UI
- **Rupture de compatibilité** : Les workflows qui s'appuyaient sur la troncature à 100 pour créer de grands cycles avec moins de DateSlots après filtrage des slots passifs ne fonctionnent plus

### Alternatives considérées

1. **Conserver la limite sur le nombre de slots** :
   - Rejeté car en multi-slot, 100 slots × N dates pouvaient dépasser 100 DateSlots sans être détectés
   - Le volume de données créées (DateSlots) est le vrai indicateur de la charge du système

2. **Autoriser plus de 100 DateSlots mais limiter le nombre d'occurrences créées** :
   - Rejeté car cela créerait des incohérences entre la configuration et la réalité (l'utilisateur configure N DateSlots mais seule une fraction est créée)

3. **Supprimer complètement la limite** :
   - Rejeté car les performances du système dégradent au-delà de 100 DateSlots par planning, et l'UX devient confuse avec trop de créneaux

## Implementation

- Ticket : `.scratch/planning-form-cleanup/issues/01-uniform-combo-limit.md`
- Fonction pure : Extraction de la génération du cycle de récurrence (testable unitairement)
- Alert-warning : Mise à jour du message live avec le compte de DateSlots futurs actifs
- Validation submit : Check `futureActiveDateSlotCount > 100` + toast
- Picker dynamique : Ajustement de `maxSelection` selon `(100 - currentDateSlots) / activeSlotCount` (arrondi)

## References

- Spec : `.scratch/planning-form-cleanup-spec.md` (Decision 8)
- Implémentation : `src/lib/components/PlanningForm.svelte` (fonctions `allGeneratedDates`, `allDateSlots`, `occurrenceTargets`)
- Tests : `tests/unit/` + `tests/integration/` (à étendre avec les tickets 07, 09)

## Migration note

Dans le code, le terme « combo » / « combos » a été renommé « DateSlot » / « DateSlots » (commit 5). Les noms de fonctions associés : `computeMaxDateForLimit` (ex-`computeMaxDateForComboLimit`), `isOverriddenDateSlot` (ex-`isOverriddenCombo`), snippet `dateSlotBadge` (ex-`comboBadge`).
