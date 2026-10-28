# Verrou d'édition admin

Deux administrateurs partagent la même URL `/admin/[token]` et peuvent l'ouvrir
simultanément sans le savoir. Le verrou signale cette concurrence : le premier arrivé prend
la main, les suivants tombent sur un overlay en lecture seule.

**C'est un verrou purement UX.** Il n'ajoute aucune restriction d'écriture côté serveur sur
`planning_masters` : les garde-fous de données restent `_version` et le merge serveur
atomique (`offline-sync.md`). Il ne concerne pas les participants de `/p/[token]`, qui
n'éditent que leur propre participation.

## Collection `planning_locks`

Le verrou vit dans une collection dédiée, **pas** dans `planning_masters`. La raison est
décisive : le client envoie un heartbeat toutes les deux minutes pour rafraîchir
l'horodatage. Sur le master, chaque heartbeat déclencherait un événement realtime master,
donc — avant le correctif de réactivité du formulaire — un remontage du formulaire d'édition
et une perte des modifications en cours, pour tous les clients.

| Champ          | Type                                            | Rôle                                            |
| -------------- | ----------------------------------------------- | ----------------------------------------------- |
| `master`       | relation → `planning_masters`, cascade, requise | une ligne par master, index unique              |
| `lockedBy`     | texte, optionnel                                | détenteur ; vide signifie « libre »             |
| `lockedAt`     | autodate                                        | dernier acquire ou heartbeat                    |
| `lockedByName` | texte, optionnel                                | nom affichable dans l'overlay des autres admins |

La ligne est **permanente** : libérer le verrou la vide (`lockedBy = ''`), elle n'est jamais
supprimée. Cela évite de recréer la ligne à chaque cycle et rend la libération idempotente.

Règles d'accès : lecture autorisée si `master.adminToken` correspond au `_token` fourni ;
mutations interdites aux clients (superuser seulement), car elles passent par les routes
custom ci-dessous.

## Routes

Définies dans `pocketbase/pb_hooks/main.pb.js`. L'authentification ne passe pas par
`e.auth` : un administrateur peut être un Guest, dont le seul titre est le token admin en
query parameter. La route vérifie que le token correspond à `master.adminToken` et renvoie
403 sinon.

### `POST /api/lock/{masterId}`

Body `{ lockedBy, lockedByName? }`. Quatre cas, dans cet ordre :

| Situation                          | Réponse | Effet                                          |
| ---------------------------------- | ------- | ---------------------------------------------- |
| aucune ligne                       | 200     | création à la volée                            |
| même détenteur                     | 200     | heartbeat, `lockedAt` rafraîchi                |
| verrou expiré, détenu par un autre | 200     | ré-acquisition                                 |
| verrou frais, détenu par un autre  | 409     | conflit, renvoie les informations du détenteur |

Le heartbeat doit réécrire un champ explicitement : sans `set()`, l'autodate de mise à jour
peut ne pas se déclencher et le verrou expirerait malgré le heartbeat.

### `POST /api/unlock/{masterId}`

Body `{ lockedBy }`. Vise la ligne et la vide. Autorisé pour le détenteur, pour une ligne
déjà vide, ou pour un verrou expiré (zombie). Un verrou frais détenu par un autre renvoie 403. Idempotent : 200 même sans ligne.

Un module partagé (`lock-utils.js`) porte `LOCK_TTL_MS`, `lockIsActive`, `lockExpiresAtMs`
et `lockInfoPayload`. Il est requis parce qu'en JSVM **chaque handler de route a un scope
isolé** : les fonctions de premier niveau de `main.pb.js` ne sont pas accessibles depuis un
handler. Même convention que `merge-utils.js` et `notify-utils.cjs`.

## TTL et heartbeat

| Paramètre | Valeur | Raison                                                                                       |
| --------- | ------ | -------------------------------------------------------------------------------------------- |
| TTL       | 5 min  | marge confortable pour une pause sans perdre la main                                         |
| Heartbeat | 2 min  | sous la moitié du TTL, pour absorber une perte de paquet ou un timer retardé en arrière-plan |

Premier arrivé gagne : il n'existe **pas de reprise de force**. Les autres attendent la
libération naturelle, l'expiration, ou cliquent « Réessayer ».

## Cycle de vie côté UI

Dans `src/routes/admin/[token]/+page.svelte` :

1. **Mount**, une fois le master chargé et `userStore.isReady` — acquisition. Succès : état
   `editing`, heartbeat démarré. 409 : état `locked-by-other`, overlay en lecture seule.
2. **Heartbeat** — un 409 en cours d'édition signifie que le verrou a été repris : bascule
   en `locked-by-other`. Pas de sondage : la reprise est manuelle.
3. **« Réessayer »** (overlays `locked-by-other` et `lock-lost`) — **recharge la page**,
   jamais de ré-acquisition silencieuse (voir plus bas).
4. **Retour au premier plan** — si l'état est `editing`, vérifie que le verrou est toujours
   détenu ; sinon passe en `lock-lost`.
5. **Save** — libération explicite avant navigation ; le teardown relance une libération
   (idempotente).
6. **`pagehide`** — libération au mieux, en `fetch keepalive`.
7. **Teardown** — invalidation des résolutions asynchrones en vol, arrêt du heartbeat,
   retrait des écouteurs, libération au mieux.

## Détenteur : `lockedBy` plutôt que `adminToken`

`lockedBy` porte l'identifiant de l'utilisateur courant (identifiant PocketBase pour un
Compte, identifiant local pour un Guest), **jamais l'`adminToken`.

Tous les administrateurs d'un master partagent le même `adminToken`. S'il servait de
détenteur, toutes les sessions admin seraient vues comme une seule, et le cas de conflit ne
pourrait **jamais** se produire : le verrou serait inopérant.

Le serveur ne valide pas `lockedBy` — c'est un simple marqueur. Le client le transmet à
l'acquisition comme à la libération.

## Interaction avec `_version` et le merge serveur

Le hook de `planning_masters` est inchangé : aucune règle d'écriture ne dépend du verrou.
Si deux administrateurs éditent malgré l'overlay — le verrou n'est qu'un signal — le
contrôle de version tranche au save du dernier, et le merge par union de clés préserve les
deux éditions sur les champs additifs. Les participants peuvent donc continuer à rejoindre
le planning, répondre et commenter pendant qu'un administrateur édite.

## Pièges

- **La libération ne survit pas au déchargement de la page.** `releaseLock` utilise un
  fetch normal, annulé à la fermeture de l'onglet : sur `pagehide`, l'UI appelle
  `fetch(..., { keepalive: true })` directement sur `/api/unlock`. La libération normale
  reste utilisée au save et au teardown (navigation interne, pas un déchargement).
- **Le serveur ne purge pas les verrous expirés** — il les ignore simplement à
  l'acquisition. La lecture renvoie donc des informations même pour un verrou expiré, avec
  une date d'expiration dans le passé : c'est ce que le retour au premier plan compare à
  l'horloge pour détecter la perte.
- **« Réessayer » recharge au lieu de ré-acquérir.** Le formulaire capture le master au
  montage. Si un administrateur perd le verrou, qu'un autre modifie puis libère, la
  ré-acquisition silencieuse mènerait à un save qui écrase les modifications de l'autre,
  sans que le contrôle de version puisse le détecter (les versions coïncident). Le
  rechargement repart du master serveur courant.
- **Aucun sondage automatique en overlay.** Une première version sondait le verrou pour
  reprendre la main seule. Elle fuyait : un sondage en vol pouvait ré-acquérir le verrou et
  démarrer un heartbeat **après** le teardown de l'`$effect`, laissant un verrou zombie. Le
  seul timer restant est le heartbeat, dont la résolution ne crée jamais de nouveau timer.
- **Garde d'annulation sur l'acquisition au montage.** L'acquisition est lancée sans être
  attendue ; un teardown pendant l'attente (navigation rapide, changement de token)
  laisserait la résolution démarrer un heartbeat orphelin. La closure porte un fanion
  vérifié après chaque `await`, posé en premier au teardown.
- **Pas de libération au passage en arrière-plan.** Un administrateur qui change d'onglet
  trente secondes ne doit pas perdre sa main : le TTL et la suspension naturelle des timers
  couvrent l'absence. Le retour au premier plan ne sert qu'à détecter une perte.
- **La lecture de l'identité dans l'`$effect` doit être hors piste réactive.** Sans cela,
  l'effet se re-déclencherait à chaque évolution de l'état guest — par exemple au fil des
  `markFetched` — et redémarrerait tout le cycle de verrou en pleine édition.

## Tests

`tests/integration/locked-planning.test.ts` couvre les routes : acquisition à la volée,
heartbeat, conflit, expiration puis ré-acquisition, libération par le détenteur, refus par
un tiers, token invalide, détenteur manquant, idempotence.

Deux particularités à connaître : l'autodate de mise à jour écrase toute valeur posée
manuellement, donc simuler un verrou expiré demande d'écrire en SQL direct ; et la suite
tourne sous Node, pas Bun, ce qui impose `node:sqlite` plutôt que `bun:sqlite`.

## Fichiers clés

- `pocketbase/pb_hooks/main.pb.js` — routes `/api/lock` et `/api/unlock`
- `pocketbase/pb_hooks/lock-utils.js` — TTL et prédicats partagés
- `src/lib/services/lockService.ts` — client (`acquireLock`, `releaseLock`, `getLock`)
- `src/routes/admin/[token]/+page.svelte` — cycle de vie, overlays, heartbeat
- `tests/integration/locked-planning.test.ts`
