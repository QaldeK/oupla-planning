> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: `bug` · Urgence: `soon` · Source: run d'intégration de la migration bun fmt (28-10) · Ancre: `generateHooks.pb.js` (chemin relatif `pb_data/data.db`)

- Dérive schéma dev vs migrations : `pocketbase/pb_data` n'a pas `notification_deliveries` (migration `1793059200` jamais appliquée à l'instance de dev) alors que la base jetable de test l'a. Tout run d'intégration dont un test touche une collection déclenche `generateHooks.pb.js`, qui régénère `pocketbase-types.ts` depuis la base **dev** → types amputés de la collection en working tree, silencieusement. À décider : appliquer la migration à la base dev et/ou rendre le chemin du typegen indépendant de l'instance (absolu, ou dérivé de `--dir`).
