# Oupla Planning

Application de planification participative — un organisateur crée un planning récurrent, les participants répondent occurrence par occurrence.

## Language

### Planning

**Planning** (planning_master) :
L'entité principale qui définit un groupe de planification : titre, récurrence, participants et tokens d'accès.
_Avoid_: event, meeting, rendez-vous, sondage

**Occurrence** (planning_occurrence) :
Une instance individuelle d'un planning, à une date précise. Chaque occurrence reçoit les réponses et commentaires des participants.
_Avoid_: instance, session, slot, événement

**Message** (UI) / Comment (code) :
Un texte posté sur le fil de discussion d'une occurrence. Affiché en UI comme « message », stocké en base comme `OccurrenceComment` dans le champ JSON `planning_occurrences.comments`. Les identifiants de code (type d'event `new_comment`, pref `newCommentScope`) suivent le nom interne `comment`, les libellés utilisateur (push, email, UI) suivent « message ».
_Avoid_: commentaire (UI), message (code), post, reply

**Scope des messages** (`newCommentScope`) :
Préférence participant qui fixe le périmètre des notifications de nouveaux messages sur un planning. Trois valeurs exclusives : `off` (aucune notif), `concerned` (uniquement les occurrences où le participant est concerné), `all` (toutes les occurrences du planning).
_Avoid_: filtre message, niveau message, option message

**Concerné** (participant, pour une occurrence) :
Un participant est dit « concerné » par une occurrence s'il a répondu quelque chose d'autre que `absent` (`present`, `if_needed`, `maybe`) **ou** s'il est inscrit à au moins une tâche. Ce filtre est déjà utilisé pour les events `reminder` sous le nom `present-or-task`. Couvre explicitement le cas « planning avec tâches mais sans réponse ». Un participant sans réponse et sans tâche n'est jamais concerné.
_Avoid_: impliqué, participant actif, inscrit

**Récurrence** :
Le motif de répétition d'un planning — les valeurs possibles sont `WEEKLY`, `BIWEEKLY`, `MONTHLY_BY_DATE`, `MONTHLY_BY_DAY`.
_Avoid_: répétition, fréquence, pattern

**Token** :
Clé d'accès par planning. Deux types : `adminToken` (64 hex) pour l'organisateur, `participantToken` (32 hex) pour les invités. Transmis en query parameter `_token`.
_Avoid_: clé, secret, code, lien

### Authentification

**Guest** :
Utilisateur non authentifié. Son identité est locale à l'appareil, stockée dans `localStorage`, et scopée à un planning spécifique — pas de profil global.
_Avoid_: anonyme, visiteur, invité non connecté

**Identity** (PlanningIdentity) :
Le triplet `{ id, name, email }` associé à un planning spécifique. Un guest peut avoir des identités différentes sur des plannings différents.
_Avoid_: profil, compte, utilisateur

**Claim-admin** :
Mécanisme par lequel un participant revendique le rôle d'administrateur d'un planning via l'API `/api/claim-admin`.
_Avoid_: takeover, récupération, appropriation

**Identité revendiquée** (Claimed identity) :
État d'un guest dont le participant a été associé à un compte authentifié sur un autre terminal (champ `participant.userId` défini alors que `isLoggedIn === false`). Le guest est « verrouillé » : ses réponses sont bloquées, un bandeau dédié s'affiche, pas d'auto-ouverture d'IdentifyModal. Résolu par `resolveCurrentIdentity` (`claimedByAuth: true`).
_Avoid_: vol d'identité, takeover, compte lié, lock

**Saved planning** :
Un planning sauvegardé localement (`localStorage` + Dexie `localMeta`) avec ses tokens. Permet l'accès à un planning sans repasser par l'URL.
_Avoid_: favori, bookmark, planning enregistré

### Sync

**pb-sync** :
Couche de synchronisation offline-first entre PocketBase et Dexie (IndexedDB). Les données sont lues depuis Dexie, les écritures passent par PocketBase puis sont répliquées localement.
_Avoid_: cache, offline mode, local-first

**Dexie** :
La base IndexedDB locale utilisée par pb-sync pour le stockage offline. Contient `masters`, `occurrences`, `commentState`, `localMeta`.
_Avoid_: IndexedDB, stockage local, base locale

**Merge strategy** :
Fonction de résolution de conflits appliquée lors de la synchronisation. Exemple : `mergeByKey('id')` pour les participants — fusionne par identifiant plutôt que d'écraser le tableau.
_Avoid_: conflit, résolution, déduplication
