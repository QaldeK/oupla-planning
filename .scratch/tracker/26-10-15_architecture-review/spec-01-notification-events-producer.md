# Spec — 01 : producteur unique d'events de notification

**Issue** : [issues/01-notification-events-producer.md](issues/01-notification-events-producer.md) · **Revue** : candidate 1, `.scratch/architecture-review/20261015-212715.html`
**Date** : 2026-10-16 · **Statut** : prête pour implémentation (grilling bouclé, frontière vide)

## 1. Objectif

Extraire `pocketbase/pb_hooks/notification-events.cjs`, propriétaire de la plomberie de
production d'events de notification — insertion d'une row `notification_events`, résolution
du contexte master+participants, résolution des noms d'affichage. Les trois `.pb.js`
(hook occurrence, cron, planning-deletion) deviennent de fins câblages → détecteurs →
producteur. Motivations et preuves file:line : voir la revue (insert ×3, contexte ×2
*divergent* sur le check `deleted`, noms ×3) et l'issue.

## 2. Décisions arrêtées au grilling

| # | Décision |
|---|---|
| Q1 | `insertEvent` **throw** ; try/catch mince chez les callers (chaque site garde son contexte de log riche). Précédent repo : `sendIndividualEmail`. |
| Q2 | La dédup J-X **reste dans le cron** (check-then-insert avant `insertEvent`). Elle est sémantiquement fausse pour les change events (`reminderValue=0` réutilisé). |
| Q3 | `resolveUserName(app, uid, fallback)` — fallback en paramètre obligatoire (hook=`uid`, cron/PD=`UNKNOWN_AUTHOR`), appel unitaire (le Map du bucket cron reste local). |
| Q4 | `createMasterContextResolver(app)` — **factory par invocation** : le cache vit sur l'instance, zéro état au niveau module (règle PB §12 : modules évalués une fois, partagés entre runtimes). |
| Q5 | **Gate `deleted`** : le hook occurrence consulte le resolver avant tout insert/push. Couvre le chemin programmatique (règle PB §9 : les request hooks n'y passent pas — ex. `claim-participant-identity` ne vérifie pas `deleted`). Impact borné, coût ~3 lignes. |
| Q6 | Suppression des **11 exports morts** du détecteur J-X (`JX_VALUES`, `REMINDER_JX_VALUES`, `CONFIRMATION_NEEDED_JX` + 8 `_underscore` — aucun consommateur, tests inclus, vérifié). `module.exports = { detectJxEvents }`. La garde inline date-passée du hook reste telle quelle. |
| Q7 | planning-deletion adopte `resolveUserName` (normalisation `email()` → `getString('email')`, équivalent JSVM). |
| Q8 | Nouveau fichier `notification-events.cjs`, **sans aucun `require`** (tout injecté) ; `notification-core.cjs` reste le hub des constantes pures. |

Conformité PocketBase best-practices vérifiée : §8/§18 (app en paramètre — anti-deadlock
transactionnel), §12 (zéro état module), §9 (gate au niveau model), §4 (filtres bindés),
§17 (test JSVM = extraction en module `require()`-able).

## 3. Interface du module

```js
// pocketbase/pb_hooks/notification-events.cjs — sans require, état zéro
module.exports = {
  /**
   * Insère une row `notification_events`. Jette en cas d'échec — le caller
   * loggue et décide (best-effort hook / comptage cron).
   * @param {core.App} app — `$app` (cron) ou `e.app` (hook, tx-scoped)
   * @param {{type: string, master: string, occurrence: string,
   *          reminderValue: number, changedBy: string,
   *          payload: object|string|null}} event
   */
  insertEvent(app, event),

  /**
   * Fabrique un résolveur de contexte master, à raison d'une instance par
   * invocation (hook handler / cron run).
   * getCtx(masterId) → { master, participants: Record[] | null } | null
   * null = master introuvable OU `deleted` (check unifié). `participants: null`
   * = lecture des participants échouée (loggée par le resolver) — `[]` signifie
   * « aucun participant », `null` « indéterminé » : au caller de décider (le push
   * se saute, la détection cron aussi, jamais confondus avec l'absence d'opt-in).
   * Cache Map sur l'instance closure — jamais au niveau module.
   */
  createMasterContextResolver(app),

  /**
   * Nom affichable d'un userId : `name || email || fallback`.
   * uid vide ou user introuvable → fallback. Ne retourne jamais null.
   */
  resolveUserName(app, uid, fallback)
};
```

Constante : `UNKNOWN_AUTHOR = 'un·e administrateur·ice'` **déménage dans
`notification-core.cjs`** (constat : identique au fallback de planning-deletion et au
`UNKNOWN_AUTHOR` de [notify-templates.js:119](../../../pocketbase/pb_hooks/notify-templates.js)) ;
`notify-templates.js` l'importe au lieu de la définir.

## 4. Transformations par fichier

### [notify-on-occurrence-update.pb.js](../../../pocketbase/pb_hooks/notify-on-occurrence-update.pb.js)
1. Requires : + `notification-events.cjs`.
2. **Gate** : détecteurs d'abord ; si `descriptor` ou `commentChanges.added.length > 0`
   → `const ctx = getCtx(record.getString('master'))` ; `null` → skip insert+push
   (`e.next(); return`). Le **cleanup 2a** (processedAt des events de commentaires
   supprimés) reste *hors* gate : il ne consomme pas le ctx et ne crée pas d'events.
3. Closure `getMasterCtx` supprimée → `const getCtx = createMasterContextResolver(e.app)`
   (mémoïsation partagée paths 1/2b, comme la closure actuelle).
4. Inserts (l.112–120, l.245–253) → `insertEvent(e.app, {...})` dans les try/catch
   existants (logs riches conservés : `occurrenceId`, `type`, `commentId`).
5. Closure `resolveAuthorName` supprimée → `resolveUserName(e.app, authorUserId,
   authorUserId)` (fallback uid = traçabilité payload, comportement identique).
6. Intacts : `resolveUser` (record brut pour push), garde date-passée inline,
   `push-dispatch`, `e.next()` sur tous les chemins.
7. Push conditionné à `pushCtx` = ctx dont `participants` est connu : une lecture
   participants échouée saute le push, **pas l'event** (la trace durable reste).

### [cron-notifications.pb.js](../../../pocketbase/pb_hooks/cron-notifications.pb.js)
1. Closure `getMasterContext` (l.77–101) → `const getMasterContext =
   createMasterContextResolver($app)` (cache partagé phases 1+2, comme aujourd'hui).
2. Insert (l.140–148) → `insertEvent($app, {...})` dans le try/catch existant
   (compteurs `inserted++` / log conservés). Dédup (l.124–137) inchangée, avant l'appel.
3. Boucle noms (l.351–363) → `userNamesById.set(uid, resolveUserName($app, uid,
   UNKNOWN_AUTHOR))` (import de core).
4. `ctx.participants === null` (lecture participants échouée, loggée par le resolver)
   → master sauté : phase 1 (détection J-X : un opt-in inconnu produirait un faux
   « rien à faire ») via le compteur `skippedUnreadableCtx` ajouté au log de résumé,
   et phase 2 (destinataires indéterminés → pas d'email).

### [planning-deletion.pb.js](../../../pocketbase/pb_hooks/planning-deletion.pb.js)
- Bloc authorName (l.169–178) → `const authorName = resolveUserName(e.app, authorId,
  UNKNOWN_AUTHOR)` — un seul appel gère authorId vide, user introuvable, sans nom.

### notification-core.cjs · notify-templates.js · cron
- `UNKNOWN_AUTHOR` ajouté à core ; templates l'importe (const locale supprimée) ;
  cron l'importe de core.

### [notification-jx-detector.js](../../../pocketbase/pb_hooks/notification-jx-detector.js)
- `module.exports = { detectJxEvents }`. Bonus optionnel (même geste, à valider) :
  `_parseJsonArray` exporté-mort dans [notification-recipients.js:243](../../../pocketbase/pb_hooks/notification-recipients.js) — même constat d'absence de consommateur.

### pocketbase/pb_hooks/AGENTS.md
- Table architecture : ajouter la ligne `notification-events.cjs` (producteur : insert
  events + ctx master + noms), ajuster la ligne du hook occurrence.

## 5. Comportements préservés / micro-changements assumés

**Préservés** : fallbacks de nom (hook=`uid`, PD=`UNKNOWN_AUTHOR`) ; email agrégé avec
user supprimé → `UNKNOWN_AUTHOR` (aujourd'hui : absent de la map → template
`UNKNOWN_AUTHOR` — même rendu) ; dédup, compteurs, logs, purge, push, circuit breaker.

**Micro-changements (edge cases, assumés)** :
1. Cron — user trouvé sans name **ni** email : `admin` → `UNKNOWN_AUTHOR`. Branche
   quasi-morte (email requis sur une collection auth PocketBase).
2. Hook — master soft-deleté + écriture programmatique (ex. claim d'identité en race
   avec suppression) : plus d'events ni push. **C'est le but de Q5.**
3. Hook — la gate ajoute un fetch master/participants quand un détecteur produit un
   event (aujourd'hui : fetch push-only). Mutualisé avec le push : 1× par update
   producteur, pas par event.
4. Lecture des participants échouée (panne DB) → `participants: null` plutôt qu'une
   exception qui sortait du hook : l'event est écrit, le push et la détection cron
   du master sont sautés et comptés. Seul chemin d'erreur connu dont le comportement
   change volontairement : avant, l'erreur cassait la réponse API (écriture pourtant
   commitée, cf. hook `*Success`) et perdait son log.

## 6. Tests

**Unitaires — `tests/unit/notification-events.test.ts`** (pattern
[notify-utils.test.ts](../../../tests/unit/notify-utils.test.ts) ; module sans
`require` → pas besoin du global `__hooks` ; mock du global `Record` comme
`MailerMessage`) :
- `insertEvent` : mapping des 6 champs sur le record ; rethrow si `app.save` jette.
- `createMasterContextResolver` : cache (1 fetch pour N appels du même id) ;
  master `deleted` → null (et caché) ; introuvable → null ; ids distincts isolés ;
  participants illisibles → `{master, participants: null}` + log, résultat caché ;
  liste vide légitime → `[]` **sans** log (distinction vide / indéterminé).
- `resolveUserName` : priorité name > email > fallback ; uid vide → fallback ;
  lookup error → fallback.

`tests/unit/notification-jx-detector.test.ts` : inchangé (n'importe que `detectJxEvents`).

**Intégration** :
- Filet du refactor vert : `notifications-cron`, `notifications-occurrence-update`,
  `planning-deletion`.
- Nouveau cas gate (chemin programmatique réel) : étendre
  [notifications-occurrence-update.test.ts](../../../tests/integration/notifications-occurrence-update.test.ts) —
  soft-delete du master puis update superuser de l'occurrence (le superuser bypass les
  gardes request : c'est le chemin programmatique ; la route claim, elle, ne produit
  pas d'event détectable car elle ré-attribue responses/comments sans ajouter ni
  supprimer de commentId) → assert : zéro nouvelle row `notification_events`.
  (L'absence de row prouve la gate : le push est en aval du ctx.)
- Validation complète : `bun run check` + `test:unit` + `test:integration`.

## 7. Critères d'acceptation (= checkboxes de l'issue)

1. L'insertion d'une row `notification_events` n'existe qu'à un seul endroit → `insertEvent`.
2. Le contexte master+participants est résolu par une seule fonction, check `deleted`
   partout → resolver + gate hook.
3. La résolution du nom d'affichage n'existe qu'à un seul endroit ; l'export mort est
   supprimé → `resolveUserName` + Q6.
4. Le module est couvert par des tests unitaires (pattern `.cjs`).
5. Les suites d'intégration (cron, occurrence-update, planning-deletion) passent.

## 8. Hors périmètre

- Rétention des events orphelins (la purge actuelle + cascade ≤ 15 j suffisent).
- Pagination des `findRecordsByFilter` (participants : volume faible par planning).
- Migration de schéma : aucune — `notification_events` inchangé, types non régénérés.
