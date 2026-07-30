# createRule de `planning_occurrences` restreinte à l'adminToken

La création d'occurrence (`planning_occurrences.createRule`) exige l'`adminToken` du master propriétaire passé en query parameter `_token`. Elle n'accepte ni le `participantToken` ni l'authentification PocketBase (`@request.auth`), contrairement à l'`updateRule`.

## Contexte

L'audit de sécurité (`.scratch/security-audit/`, finding F4) a révélé que `createRule` était `""` (règle toujours vraie = publique). N'importe qui connaissant un `masterId` pouvait `POST /api/collections/planning_occurrences/records` et injecter de fausses occurrences visibles par tous les participants via le realtime.

## Décision

```json
"createRule": "@request.query._token != \"\" && master.adminToken = @request.query._token"
```

L'adminToken est généré côté client (`generateAdminToken()`) avant la création du master, puis forwardé à chaque opération du batch d'occurrences. C'est un chemin synchrone et déterministe — fiable.

## Alternatives rejetées

### Accepter le participantToken (cohérence avec l'updateRule)

Rejeté : dans le modèle d'usage actuel, les participants ne créent jamais d'occurrences — ils répondent (`submitResponse`), commentent (`addComment`), s'inscrivent aux tâches. La création est une prérogative d'organisation. Ouvrir cette capability au participant n'apporterait aucune fonctionnalité légitime et violerait le principe du moindre privilège. Si une feature « participant propose un créneau » arrive, on assouplira la règle à ce moment-là.

### Ajouter une branche auth (`@request.auth.id != "" && master.id ?= @request.auth.masterId.id`)

Rejeté : le `masterId` sur le user auth est peuplé par `/api/claim-admin`, appelé en fire-and-forget **après** `createPlanningWithOccurrences` dans le flow `/new`. Au moment où le batch d'occurrences est envoyé, le user auth n'a donc pas encore `masterId` pointant vers ce master. Se reposer sur cette branche introduirait une race condition. L'adminToken en query param est synchrone et évite ce problème.

### Ajouter un hook `onRecordCreateRequest` (défense en profondeur)

Rejeté (YAGNI) : aucune contrainte métier n'est aujourd'hui enforceée serveur à la création (cohérence date/horaire, doublons, etc.). La `createRule` seule ferme complètement la faille publique. Les hooks update existent car ils servent à la restriction de champs (F2) et au forgeage de `lastModifiedBy` (F5) — des besoins qui n'existent pas à la création.

## Conséquences

- Asymétrie assumée entre `createRule` (adminToken uniquement) et `updateRule` (adminToken || participantToken || auth admin). Cette asymétrie reflète la distinction entre « organiser » (admin) et « participer ».
- La suppression de la fonction morte `createOccurrence` (jamais importée) accompagne ce changement.
