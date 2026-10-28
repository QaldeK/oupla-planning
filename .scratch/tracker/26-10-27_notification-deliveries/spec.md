# Spec — Registre de livraison par destinataire (`notification_deliveries`)

Date : 2026-10-27 — statut : **design arrêté, prête pour implémentation**.
A passé une revue adverse externe (bloquants B1/B2 et garde N3 intégrés,
reformulations N1/N2/N4/N5/N7). L'incrément 2 (suspension email) est **hors
périmètre** — cf. sa section en fin de spec.

## Contexte

Le commit `b25011b` a livré le contrat terminal de `processedAt` (tout event
sort du cron consommé ou mort ; seule survie pending = retry email SMTP, borné
par le garde d'obsolescence). Deux défauts subsistent :

1. **Doublon email multi-destinataires** : un event est porté par un bucket
   email par destinataire ; si l'adresse de B est morte (rejet RCPT permanent),
   l'event reste pending et A re-reçoit l'agrégat chaque nuit jusqu'à ce que le
   garde d'obsolescence tue l'event (J-7 → 7 doublons ; un `new_comment` sur
   une occurrence à 3 mois → des mois de doublons).
2. **Couplage push→email** : le balayage terminal ne pousse que les events
   consommés, donc un échec email (même celui de B seul) diffère le push J-X
   de A indéfiniment.

Cause racine : aucune trace de « quelle paire (event, destinataire) a été
servie ». Toute solution correcte encode cette information ; le choix est
l'encodage (blob JSON sur l'event = bricolé ; lignes dédiées = honnête).

## Objectifs — invariants de design

1. **Découplage des canaux** : un échec email n'affecte ni le push, ni les
   autres destinataires.
2. **Exactement un email par (event, user)** — jamais de doublon, quelle que
   soit la cause d'échec.
3. **Push J-X : une vague unique**, au premier run où l'event est vivant,
   indépendante de l'état email.
4. **Toute fin d'état est explicite** : succès, waive (avec raison), ou mort
   par le garde d'obsolescence. Pas d'état implicite.

## Modèle proposé

Nouvelle collection `notification_deliveries` — une ligne par
(event, destinataire métier) :

| Champ | Rôle |
| --- | --- |
| `event` | relation → `notification_events`, cascade app-level |
| `user` | relation → `users`, cascade app-level |
| `master` | relation → `planning_masters`, dénormalisé pour le bucketing/agrégation |
| `emailSentAt` | '' = email dû |
| `emailWaivedAt` | renoncé : opt-out `email=false`, déjà lu, user parti, clôture de mort |
| `pushSentAt` | '' = push dû (types J-X uniquement) |
| `pushWaivedAt` | renoncé : `push=false`, type non-JX, user parti, clôture de mort |

Index unique `(event, user)`. Les deux relations porteuses (`event`, `user`)
sont créées avec `cascadeDelete: true` (la cascade est un comportement runtime
de `app.delete()`, cf. section Purge). API Rules toutes verrouillées superuser
(table interne, écrite uniquement par le cron via saves programmatiques).

**Pas de compteur `attempts`** (voir « Choix motivés »).

## Cycle du cron — phase 2 remaniée

1. Sélection pending (`processedAt = ''`) + classification
   (`classifyPendingEvent`, inchangée) : morts → `processedAt` posé +
   **clôture du ledger** (bulk-waive des deliveries restantes dues) ;
   participants illisibles → retry sans fan-out.
   Puis **clôture résiduelle** (B1) : toute delivery due dont l'event n'est
   plus pending (`processedAt != ''`) est waivée. C'est la défense qui couvre
   la **seconde porte d'écriture de `processedAt`** — le cleanup `new_comment`
   du hook occurrence-update pose `processedAt` hors cron à la suppression
   d'un commentaire — ainsi que tout save de clôture échoué (famille S6).
   Sans elle : delivery due sur event consommé, jamais envoyée ni purgée.
2. **Fan-out** : pour chaque event vivant, `computeRecipients` (prefs lues à
   chaud, inchangé) → upsert des deliveries `(event, user)` manquantes,
   **filtré aux destinataires ayant au moins un canal actif** (`email` OU
   `push`, lus à chaud donc réévalué chaque run — un muted n'a jamais de
   ligne ; s'il active un canal à mi-fenêtre, sa ligne apparaît au run
   suivant et il est servi). Le fan-out a lieu **à la consommation, pas à
   l'insertion** : le jeu de destinataires reste dynamique jusqu'à l'envoi
   (un participant qui rejoint à J-2 reçoit le rappel — propriété délibérée
   du Modèle B).
3. **Vague push** (types J-X uniquement, avant et indépendamment de la boucle
   email) : `r.push=true` → dispatch + `pushSentAt` ; sinon `pushWaivedAt`.
   Les types non-JX (change events, `new_comment`) ont `pushWaivedAt` posé dès
   le fan-out — leur push immédiat est fait par le hook occurrence-update ;
   les re-pousser depuis le cron serait un doublon.
   La vague est unique **par destinataire**, pas par event (N5) : un
   destinataire qui apparaît au run 2 sur un event encore vivant (fan-out
   dynamique, Modèle B) reçoit son push au run 2 — ce n'est pas un doublon,
   il ne l'a jamais reçu.
4. **Buckets email** : deliveries dues (`emailSentAt=''` et
   `emailWaivedAt=''`) dont le `r.email` live est vrai et non filtrées
   « déjà lu », groupées par (user, master). Envoi agrégé inchangé.
   - succès → `emailSentAt` sur les lignes du bucket ;
   - `email=false`, déjà lu, user parti/introuvable → `emailWaivedAt` ;
   - échec d'envoi → reste due, retentée seule au run suivant.
5. **Dérivation terminale** : event consommé quand toutes ses deliveries ont
   les deux canaux réglés (sent ou waived) → `processedAt` posé (sémantique du
   contrat livré inchangée). Espace vide de destinataires → consommé d'emblée.
   **Garde d'implémentation (N3)** : la terminalité ne se déduit que pour les
   events qui ont passé le fan-out **ce run** — jamais d'un simple « 0
   deliveries dues » : un event au fan-out sauté (participants illisibles)
   serait sinon consommé à tort.
6. **Clôture à la mort** : event marqué mort → bulk-waive de ses deliveries
   dues (ledger véridique).

## Choix de design motivés

- **Pas de cap d'attempts** : un compteur compterait aussi bien les échecs
  d'une panne SMTP globale (tous les users touchés) que ceux d'une adresse
  morte (un user) — au bout de 3 jours de panne SMTP, toutes les deliveries
  seraient waivées et les emails perdus pour tout le monde. On ne peut pas
  distinguer de façon fiable en JSVM (parsing des codes SMTP dans les messages
  d'erreur Go du mailer = fragile). Coût résiduel du retry quotidien d'une
  adresse morte : une tentative SMTP par jour, borné par le garde
  d'obsolescence, et l'erreur loggée signale l'adresse en échec à l'admin.
- **Waive immédiat pour `email=false`** : l'opt-out est par planning ;
  renoncer est le comportement voulu. À documenter honnêtement (N2) : c'est
  un **rétrécissement** réel du comportement actuel — aujourd'hui, un event
  survivant au run (échec SMTP d'un tiers) offre une fenêtre où l'utilisateur
  qui réactive `email` reçoit quand même l'email. Cette fenêtre disparaît ;
  choix assumé.
- **Vague push au premier run vivant** (N1) : cette timing **restaure** le
  comportement d'avant `b25011b` (push tiré la nuit de l'insertion, quelle que
  soit la santé email), tout en corrigeant son défaut de re-push quotidien.
  Le comportement intermédiaire de `b25011b` (push différé à la consommation)
  était le couplage que cette spec supprime.

## Purge

**Piège identifié puis levé à la racine** : la purge hebdo actuelle des events
est un `DELETE` SQL brut (`cron-notifications.pb.js`, cron
`notifications-purge`). Les cascades de relation PocketBase sont appliquées
par le runtime sur `app.delete()` — pas par des FK SQLite — donc un DELETE
brut ne cascade pas. Plutôt que d'ajouter des sweeps de rattrapage autour du
SQL brut, **la purge passe en natif** (décision actée, remplace les trois
règles initialement prévues) :

1. `findRecordsByFilter` sur `notification_events` avec cutoff calculé en JS
   et bindé (`processedAt != '' && processedAt < {:cutoff}`) — même pattern
   que la fenêtre de la phase 1, déjà en œuvre dans ce fichier ;
2. boucle `$app.delete(record)` : les cascades s'appliquent, les deliveries
   meurent avec leur event (`cascadeDelete` sur
   `notification_deliveries.event`). Leur règlement étant toujours antérieur
   ou égal au `processedAt` de l'event, elles ne disparaissent jamais avant
   leurs propres 60 jours — pas de purge deliveries indépendante ;
3. pas de sweep d'orphelines : sans DELETE SQL brut, les orphelines sont
   structurellement impossibles ; la clôture résiduelle (B1) garantit qu'aucune
   delivery due ne survit sur un event terminal.

Le SQL brut reste légitime en **migration** (chirurgie de schéma) et en
**test** (`node:sqlite` pour contourner l'autodate `onUpdate`) — plus en
opérationnel. Précédent natif dans le repo : `planning-purge` boucle déjà sur
`txApp.delete()` en comptant sur la cascade du schéma
([planning-deletion.pb.js](pocketbase/pb_hooks/planning-deletion.pb.js)).

Les suppressions app-level (purge master → cascade events → cascade
deliveries ; suppression user → cascade) fonctionnent, elles, nativement.

## Side effects analysés (et traitements)

| # | Side effect | Traitement |
| --- | --- | --- |
| S1 | Destinataire quitte le planning après fan-out : sa delivery due bloque la terminalité | **Reaper au prédicat étroit (B2)** : waive uniquement pour départ durable — `hasQuit=true`, `userId` retiré de `master.participants`, user supprimé. Jamais pour une response ou une pref réversible (`absent` aujourd'hui, `present` demain) : ces états restent évalués à chaud pour le bucketing, la delivery restant due entre-temps (l'event survit jusqu'à staleness, sans fuite — la clôture à la mort la règle). **Waive non réversible** : revenir après départ ne rouvre pas la ligne (fenêtre étroite, assumée, documentée avec S8) |
| S2 | `email=false` bloquerait la terminalité si laissée due | Waive immédiat — rétrécissement assumé, cf. Choix motivés (N2) |
| S3 | Change events re-poussés par le cron = doublon avec le push immédiat du hook | `pushWaivedAt` posé au fan-out pour tout type non-JX |
| S4 | Purge SQL brute des events → deliveries orphelines | Purge passée en natif (`app.delete()`), les cascades emportent les deliveries — cf. section Purge |
| S5 | Event mort avec deliveries dues → ledger menteur | Clôture bulk au marquage mort |
| S6 | Échec du save `emailSentAt` après envoi → doublon au run suivant | Fenêtre résiduelle (identique à celle du marquage `processedAt` actuel), loggée ; incompressible sans transaction SMTP+DB |
| S7 | SMTP down global : la vague push doit quand même partir | Vague push avant la boucle email, indépendante de ses résultats |
| S8 | User active `push`/`email` après la vague/le waive | Pas d'envoi rétroactif (choix assumé, documenté) |
| S9 | Déploiement : la phase 2 dépend de la nouvelle collection | Migration collection créée au démarrage avant les hooks (migrations puis hooks au boot PB) ; aucun backfill — le fan-out s'auto-installe au premier run sur le pending vivant |
| S10 | Volume : lignes = events × destinataires | Quelques milliers/an à l'échelle actuelle ; upsert indexé (event, user) |
| S11 | Agrégats : un straggler retenté part seul dans un petit email | Identique au comportement actuel |
| S12 | Header `X-Entity-Ref-ID` (dedup mailbox) par (master, jour) | Inchangé, toujours cohérent avec un envoi par jour |
| S13 | **`processedAt` écrit hors cron** (cleanup `new_comment` du hook à la suppression d'un commentaire) : deliveries dues orphelines de terminaison, invisibles à la purge (B1) | Clôture résiduelle à chaque run (étape 1 du cycle) : waive de toute delivery due dont l'event n'est plus pending — couvre aussi tout futur écrivain et les saves de clôture échoués |
| S14 | « 0 deliveries → terminal » consommerait à tort un event au fan-out sauté (N3) | La terminalité ne se déduit que pour les events passés par le fan-out du run |

## Sémantique de fin des retries email (réponse explicite)

Un email dû cesse d'être retenté quand :
1. il part (succès) ;
2. il est waivé (opt-out, déjà lu, **départ durable** — reaper S1) ;
3. son event meurt (garde d'obsolescence : occurrence passée, annulée,
   supprimée, master disparu) — la clôture waive la delivery ;
4. son event est consommé **hors cron** (cleanup `new_comment` du hook) ou
   clôturé par un save résiduel — la clôture résiduelle du run suivant waive
   la delivery (B1).

Il n'y a volontairement **pas** de détection d'invalidité d'adresse ni de cap
d'attempts (cf. Choix motivés).

## Tests cibles

- **Le décisif** : stub SMTP rejetant le RCPT pour l'adresse de B uniquement.
  Jour 1 : 1 email (A), push wave partie, B due. Jour 2 (re-run) : **0 doublon
  pour A**, B seule retentée. Jusqu'à staleness → clôture.
- **Clôture résiduelle (B1)** : event `new_comment` avec delivery due (échec
  SMTP), commentaire supprimé → `processedAt` posé par le hook → au run
  suivant, la delivery est waivée, aucune re-tentative.
- **Reaper (B2)** : participant `hasQuit` après fan-out → waive au run
  suivant ; participant passé `absent` pendant une fenêtre retry → delivery
  reste due, repasse `present` → l'email part.
- Opt-out `email=false` → waive → event consommé sans email (remplace le
  comportement du test push-only actuel).
- Change event : `pushWaived` au fan-out, email délivré (le test
  `status_deleted` actuel doit rester vert).
- Vague push malgré SMTP down : assertée via le **marquage `pushSentAt` en
  DB** (N7) — le push HTTP échoue silencieusement en test
  (`sendPushNotification` ne jette jamais) ; le ledger rend l'observation
  possible, la livraison ne l'est pas.
- Staleness : event mort → deliveries clôturées, plus rien ne bouge.
- Purge native : events terminal > 60 j supprimés par `app.delete()` → les
  deliveries sont emportées par cascade (pas de sweep indépendant).

## Incrément 2 (suspension email) — décisions actées en attendant sa spec

- Signal à l'utilisateur : **bannière in-app seule**. La notification push de
  prévention (« votre email ne reçoit pas nos notifications ») est backlogée
  pour évaluation ultérieure — à retracer au moment d'en décider, pas avant.
- Réactivation : changement d'email via `requestEmailChange` (confirmation à
  la nouvelle adresse = vérification gratuite), reset compteur + suspension.
- Détection : échec isolé (un succès suit dans le même run), seuil 3
  consécutifs, reset sur tout succès.

## Périmètre explicite

- Canal email seulement pour le ledger ; le push est une vague unique
  événementielle (pas de retry push — best-effort assumé).
- Le hook occurrence-update, les détecteurs, `computeRecipients`, le
  service-worker et le front ne changent pas.
- `processedAt` garde exactement la sémantique livrée par `b25011b` ;
  les deliveries vivent sous l'event.
- **L'incrément 2 (suspension email) n'est PAS dans cette implémentation** —
  ses décisions ci-dessus attendent leur propre spec.

## Implémentation — point d'entrée

- **Migration** : création de `notification_deliveries` (champs et index
  ci-dessus, `cascadeDelete` sur `event` et `user`) + index cavalier
  `push_subscriptions (user)` — lecturé à chaque envoi push
  (`sendPushNotification`) et par la cascade de suppression d'un user,
  actuellement sans index.
- **Code** : `pocketbase/pb_hooks/cron-notifications.pb.js` (phase 2 :
  fan-out, vague push, buckets sur deliveries, clôtures, purge native),
  `pocketbase/pb_hooks/notification-consumer.js` (politique étendue),
  nouveau module fan-out si extrait.
- **Tests** : `tests/integration/notifications-cron.test.ts` (tests cibles
  ci-dessus — le stub SMTP doit apprendre à rejeter le RCPT pour une adresse
  donnée), tests unitaires pour la nouvelle politique.
- **Doc** : `docs/architecture/push-notifications.md` à mettre à jour dans la
  même passe (règle repo : une doc d'architecture fausse coûte plus cher
  qu'une doc absente).
- **Conventions** : `pocketbase/pb_hooks/AGENTS.md` (chargé automatiquement,
  skill `pocketbase-jsvm` obligatoire avant écriture) ; validation complète =
  `bun run check` + `test:unit` + `test:integration` (procédure instance
  jetable : `docs/agents/integration-tests.md`).
