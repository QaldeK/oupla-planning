> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: bug · Urgence: light · Source: implémentation portage mur (26-10-29) · Ancre: src/routes/settings/+page.svelte:102

Le badge admin des réglages lit `userStore.pbUser?.adminOf`, mais le getter `pbUser`
(userStore.svelte.ts) ne retourne que `{ id, name, email }` → `adminOf` vaut toujours
`undefined` → `isAdmin` toujours faux pour toute entrée planning des settings.
Impact mineur (affichage seulement) mais visible : le rôle admin n'apparaît jamais là.
Reco : exposer `adminOf`/`masterId` via le getter (typé), ou lire `pb.authStore.record`
directement comme le fait `planningStore.hasAdminAccess`.
