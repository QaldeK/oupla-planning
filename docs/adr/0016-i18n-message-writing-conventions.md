# ADR 0016 — Conventions de rédaction des messages i18n : pluriel, écriture inclusive, phrases autonomes

Complément éditorial de l'ADR 0010 (choix d'outil et résolution de locale) : **comment
rédiger** les chaînes de `messages/fr.json` et `messages/en.json`. Le français reste la
source éditoriale, l'anglais la traduction. Trois pièges rencontrés ont forgé ces règles —
ils compilent tous sans erreur et ne se révèlent qu'à l'exécution :

1. **La syntaxe pipe `singulier | pluriel` n'existe pas dans Paraglide.** Empruntée à
   d'autres bibliothèques (vue-i18n…), elle est conservée telle quelle dans la chaîne
   compilée et s'affiche brute à l'écran, `{n}` étant remplacé. Le pluriel passe par le
   sélecteur `match` du format Inlang Message v2 (`declarations` / `selectors` / `match`
   avec `local nPlural = n: plural`), compilé en `registry.plural()` selon les règles CLDR —
   en FR, `one` couvre 0 et 1.
2. **Un `{placeholder}` non fourni par le site d'appel rend `undefined`.** Le typage
   généré n'attrape pas l'appel sans argument (fichiers générés en JS/JSDoc), le bug peut
   donc rester latent : les messages de partage ont affiché « …pour leur permettre de
   undefined » pendant des versions. Règle : chaque placeholder du message doit figurer à
   l'appel, et toute clé i18n doit être appelée depuis `src/`.
3. **Composer des phrases en injectant des fragments entre messages casse à la
   traduction.** L'ordre des mots est propre à chaque langue ; un fragment pensé pour le
   français (`{join_desc}`) impose sa structure à l'anglais. Règle : un message est une
   **phrase complète et autonome** ; les clés-fragments sont à proscrire (cas
   `share_join_responses`/`share_join_tasks`, mortes-nées et jamais traduites).

## Décisions

- **Pluriel** : sélecteur `match` dans le message. Les clés suffixées `_one`/`_other`
  choisies dans le code existent encore (`claim_more_others_*`, `planform_arbitrary_*`) :
  elles restent en l'état, mais toute nouvelle chaîne plurielle utilise `match`.
- **Écriture inclusive (FR)** : marquage par point médian `·` — noms
  (`participant·e(s)`, `inscrit·e(s)`), participes accordés
  (`identifié·e`, `notifié·es`, `assigné·es`), déterminants
  (`Aucun·e`, `Nouveau·velle`, `le·la premier·ère`). Quand le point médian alourdit la
  phrase (pronoms `qu'ils`/`qu'elles`), on **reformule** plutôt que de le forcer
  (« pour leur permettre de… »). Les mots épicènes restent inchangés, en préférant les
  formes courtes : « admin » plutôt qu'« administrateur·rice ». Les étiquettes de réponse
  (`Présent·e` / `Absent·e`) sont reprises telles quelles dans les textes qui les citent.
- **Alignement FR/EN** : mêmes clés, mêmes placeholders dans les deux fichiers. Le point
  médian est propre au FR ; l'anglais reste sur un standard neutre.

## Conséquences

Toute modification de `messages/*.json` impose une recompilation (plugin Vite au
`dev`/`build`, ou `paraglide-js compile`) vérifiée par `bun run check`. Le libellé final
des chaînes sensibles (partage, invitations) se vérifie visuellement en FR et EN : aucun
test automatisé ne couvre le rendu textuel.

Alternatives rejetées : composition de phrases par fragments paramétrés (anti-pattern
i18n, cf. piège 3) ; doublets `_one`/`_other` pour les nouvelles chaînes (duplique la
logique de sélection côté composant au lieu de la déclarer dans le message) ; écriture
exclusivement masculine ou doublet complet `participant·e(s)` → `(e·s)` par parenthèses
(lisible mais ambigu sur l'accord des participes).
