# 07: PlanningForm — les règles produit hors du composant

**What to build:** Extraire du grand formulaire de création de Planning les règles produit qui y sont piégées : les bornes de récurrence par défaut (aujourd'hui dans un `$effect`, testables seulement en montant le composant) deviennent une fonction pure, et les 11 validations ordonnées du submit (aujourd'hui réparties entre attributs HTML et handler, dont 4 injoignables via le DOM — skips documentés dans le fichier de test) deviennent une table `validatePlanningForm(state) → {error, messageKey} | null` consommée par le submit.

**Blocked by:** None (can start immediately).

**Status:** needs-triage

- Force à la revue : **non évaluée** — repéré pendant la revue mais écarté du rapport final (friction réelle, plus localisée) ; à trier avant de décider.
- Source d'évidence : `.scratch/architecture-review/20261015-212715.html`, section « Repérés, écartés du périmètre ».
- Contraintes : ADR-0010 (i18n Paraglide client-first) et ADR-0016 (conventions de messages) à respecter pour les clés de message. Le moteur de sélection de dates a déjà son module pur et testé — ce ticket ne fait que compléter le mouvement.
- Process : trier d'abord (le formulaire fonctionne ; les skips sont documentés) ; si retenu, grilling → implémentation.
- [ ] Les bornes de récurrence par défaut sont pures et testées sans DOM.
- [ ] Les règles de validation sont une table testable sans DOM.
- [ ] Les skips documentés du fichier de test sont supprimés (les états sont joignables via l'interface extraite).
- [ ] Les suites complètes passent.
