# Notifications des messages sur les occurrences

Étendre le pipeline `notification_events` existant avec un type `new_comment` pour notifier les participants quand un message est posté sur une occurrence. La préférence participant devient un `select` exclusif à 3 valeurs (`newCommentScope: 'off' | 'concerned' | 'all'`) plutôt que deux booléens, car "concerné" est un sous-ensemble strict de "toutes" et l'incohérence `all: true + concerned: false` n'a pas de sens utilisateur. Le mode "concerné" réutilise le filtre `present-or-task` déjà défini pour les events `reminder`.

## Contexte

Le marketing (`FeaturesGrid.svelte`) promettait déjà "nouveaux messages" sans que la feature existe. Le pipeline notif (producteur → `notification_events` → consommateur cron + push immédiat) est conçu pour être étendu proprement ; on réutilise ce pattern au lieu d'introduire un système parallèle.

## Décisions structurantes

- **Hook unifié** : on étend `notify-on-occurrence-update.pb.js` (déjà déclenché par `addComment` qui update l'occurrence entière) avec un détecteur séparé `new-comment-detector.js`. Le guard temporel et le pattern d'insert + dispatch push sont partagés avec les change events. Un hook dédié aurait dupliqué ~40 lignes sans valeur.
- **Détection des transitions** : le détecteur compare les IDs de `comments` pré/post update et retourne `{ added, removed }`. Les suppressions déclenchent un cleanup (`processedAt = now`) des events `new_comment` non-consommés liés au `commentId`, évitant un email pour un message qui n'existe plus.
- **`null === off` pour les existants** : pas de backport à la migration. Les participants existants (y compris admins) doivent opt-in explicitement. Pour les nouveaux participants créés après déploiement, le default rôle est **persisté à la création** par `addParticipant` (admin → `all`, user auth → `concerned`), garantissant la cohérence UI/runtime.
- **Check "déjà lu" par message** : côté email uniquement (pas push, qui est immédiat). Compare `planning_participants.commentReadState[occId]` au `commentCreatedAt` stocké dans le payload de l'event. Si `commentReadState >= commentCreatedAt`, l'event est skippé.
- **Filtre temporel** : les commentaires sur occurrences passées ne déclenchent pas de notif, par cohérence avec le hook existant. Contredit la sémantique "discussion" (débriefing post-event), mais le commentaire d'occ archivée est marginal en pratique et la cohérence interne prime.
- **Catégorie template `comment`** : priorité 5 (la plus basse, après `reminder`), emoji 💬. Au sein d'un bloc occurrence, les events `new_comment` sont rendus en dernier comme un sous-bloc indenté `💬 N nouveaux messages :` suivi des sous-lignes `• {author} : {preview}`. Le sujet email est suffixé `+ N nouveaux messages` quand une autre catégorie (cancel, change) domine.
- **Anti-spam push** : aucun en v1. 5 messages d'affilée = 5 push immédiats. Cohérent avec les change events. L'email agrégé (1/jour max avec filtre read-state) fait office d'anti-spam côté canal secondaire.

## Considérations rejetées

- **Deux booléens `onNewCommentAll` / `onNewCommentConcerned`** : incohérent (`all` implique `concerné`), aurait nécessité synchronisation UI et invariant serveur.
- **Lazy default serveur selon rôle** : introduit une double source de vérité (champ + rôle) et rend les transitions admin surprenantes.
- **Hook séparé `notify-on-new-comment.pb.js`** : duplication du guard temporel et du pattern insert + dispatch.
- **Email immédiat pour les messages** : anti-pattern messagerie (spam massif), on reste sur cron 00h UTC avec acceptation du délai.
- **Push coalescé/debouncé** : complexe en JSVM sans état partagé, YAGNI v1.

## Conséquences

- Migration schéma : ajout d'un champ `select` à `planning_participants` (valeurs `'off'`, `'concerned'`, `'all'`), sans valeur par défaut. Types TS régénérés par `generateHooks.pb.js`.
- `getDefaultPlanningPrefs(recurrenceType, isAdmin)` : signature change, `newCommentScope` default selon rôle.
- 1 nouvelle catégorie dans `notify-templates.js` (`comment`), 1 nouveau type d'event dans `notification_events`, 1 nouveau détecteur, 1 renderer push dédié (`Nouveau message — {title}` + `{author} : {preview}`).
- Silience initiale au déploiement : aucun participant existant ne recevra de notif message tant qu'il n'a pas activé la pref. Effort de communication requis côté produit.
