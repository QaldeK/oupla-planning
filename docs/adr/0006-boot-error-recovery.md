# Boot défensif : recover automatique sur données locales corrompues

Toute donnée persistante côté client (localStorage, IndexedDB, caches HTTP) est traitée comme **jetable**. Le boot de l'application ne doit jamais planter définitivement à cause d'une valeur corrompue ou d'une migration Dexie échouée — ces situations doivent être soit rattrapées silencieusement, soit offrir à l'utilisateur un moyen programmatique de récupérer la main sans intervention technique.

## Contexte

Après un déploiement combinant (a) un refactor des hooks PocketBase (notifications, helpers JSVM) et (b) une mise à jour de la logique PWA (`a60c83f` — détection proactive de MAJ SW), plusieurs utilisateurs sur PWA installée mobile se sont retrouvés avec un écran "500 internal error" brut au boot, sans aucune action possible. La cause racine n'a pas pu être identifiée précisément (le debug mobile étant laborieux), mais le vidage manuel du cache navigateur résolvait le problème → indique qu'une donnée persistante était dans un état incompatible avec le nouveau code.

Ce n'est pas acceptable pour une PWA dont la cible utilisateur inclut des mobiles non techniciens. Le prochain incident du même type ne doit plus nécessiter d'intervention manuelle.

## Décision

Trois couches défensives, indépendantes et cumulatives :

**1. Préventif — wrappers défensifs au boot**

- `src/lib/utils/storage.ts` : `getItem` wrap ses `JSON.parse` dans `safeJsonParse` qui retourne `null` et supprime la clé corrompue sur `SyntaxError`. L'applicative retombe sur ses valeurs par défaut au lieu de crasher.
- `src/lib/pb-sync/db.ts` : la factory `openAppDB()` tente `db.open()`, et sur erreur (typiquement `UpgradeError` Dexie) drop la DB puis crée une nouvelle instance. La DB locale étant un cache offline-first de PocketBase (source de vérité serveur), la perte est acceptable.

**2. Curatif — routine de recover autonome**

- `src/lib/utils/recover.ts` expose `recoverAllData()` qui nettoie caches HTTP, registrations SW, IndexedDB `appDB`, localStorage et sessionStorage, puis reload la page. Ce module est volontairement sans dépendances sur les stores applicatifs : il doit pouvoir fonctionner même si `userStore` ou `planningStore` sont dans un état bancal.

**3. UI — error boundaries user-facing**

- `src/routes/+error.svelte` : page d'erreur SvelteKit standard, avec un bouton "Effacer les données locales" qui appelle `recoverAllData()`. Affichée quand SvelteKit a pu attraper l'erreur via son error boundary.
- `src/error.html` : template statique rendu quand le client JS lui-même a crashé (avant l'init du routeur). Comme il ne peut pas exécuter du code applicatif, il propose un lien `/?recover=1` qui, au prochain boot, déclenche le recover via un hook dans `+layout.svelte`. Ce template contient aussi un script inline défensif qui tente le clear navigateur directement avant redirect (couvre le cas où l'applicatif ne se charge pas du tout).

## Conséquences

- **Perte de données offline acceptable** : en cas de reset DB, les identités guest stockées dans `localMeta` sont perdues. L'utilisateur doit se ré-identifier sur ses plannings guest. Les plannings et occurrences côté PocketBase ne sont pas affectés.
- **Le bouton recover est destructeur et non-sélectif** : c'est volontaire. En cas de crash inconnu, mieux vaut repartir d'un état vierge que de deviner quelle clé est corrompue. L'UI explique clairement ce qui sera perdu.
- **Politique "données persistantes jetables"** : toute nouvelle feature qui persiste côté client (IndexedDB, localStorage) doit soit être tolérante à la perte (cache, préférences avec default fallback), soit explicitement pas critique (analytics, métriques). Les données métier restent côté serveur.
