# Créneau du cron quotidien de notifications — 08h UTC

Le run quotidien de notifications (`cronAdd('notifications-daily', …)` dans `pocketbase/pb_hooks/cron-notifications.pb.js`) tourne à **08h00 UTC**, soit 9h en hiver et 10h en été à Paris. Le critère qui tranche est l'heure de réception, pas la charge serveur : le créneau était à 00h UTC, c'est-à-dire **1h ou 2h du matin** pour les destinataires, et un push programmé réveille un appareil dont le mode « ne pas déranger » n'est pas activé — le cas courant.

## Contexte

Le pipeline a deux producteurs (`docs/architecture/push-notifications.md`) : le cron, qui planifie les rappels J-X (J-1, J-3, J-7, J-15), et le hook occurrence-update, qui pousse immédiatement les faits réactifs (commentaire, changement d'horaire, annulation) et ne laisse que leur email au run suivant. Le cron est donc **le seul endroit où l'application choisit l'heure à laquelle elle dérange quelqu'un**.

Le créneau d'origine se justifiait par la charge serveur — un VPS peu sollicé la nuit. L'argument ne tient pas à cette échelle : un run envoie quelques emails et une poignée de push sur une instance qui héberge déjà tout le reste. Le seul coût du déplacement est humain, et il penche du côté du déplacement.

Point de lecture qui a motivé la correction des docs : le conteneur ne fixe aucun `TZ` et tourne en **UTC**. « 00h » dans l'expression cron et dans la doc ne voulait donc pas dire minuit à Paris, mais 1h (hiver) ou 2h (été).

## Décision

`0 8 * * *` UTC, un seul run quotidien, les deux canaux au même instant (le registre de livraison les règle dans la même passe).

- **Pourquoi 08h UTC et pas 10h** : la France vit en UTC+1 (hiver) et UTC+2 (été). 08h UTC donne 9h en hiver et 10h en été — une bande « matin » resserrée, jamais avant 9h, jamais après 10h. `0 10 * * *` UTC aurait donné 11h-12h, plus proche de midi que du matin.
- **Pourquoi rester en UTC** : une expression UTC fixe dérive d'une heure au changement d'heure, imperceptible pour un rappel quotidien. L'alternative exacte (`TZ=Europe/Paris` sur le conteneur, puis `0 10 * * *`) règle le fuseau de **tout le process** — horodatage des logs, macros `@todayStart` de PocketBase, les autres crons — pour gagner cette heure de dérive.

## Invariant : l'heure du run ne décale aucun rappel

La détection J-X est indexée sur le **jour UTC** : `computeDaysUntil` (`pocketbase/pb-helpers.cjs`) ramène l'occurrence et le « maintenant » à minuit UTC avant de soustraire. La fenêtre de balayage (`aujourd'hui → aujourd'hui+20`) et le test « occurrence passée → morte » reposent sur les mêmes bornes. Toute heure du même jour UTC produit donc les mêmes events : un run à 8h ou à minuit, c'est le même lot de rappels. Contrainte à respecter si le créneau bouge encore : rester dans le jour UTC que l'on veut traiter — un run à 23h UTC traiterait bien le bon jour, mais arriverait à 00h-01h à Paris, ce qui annule l'objet de cette décision.

## Considérations rejetées

- **Conserver 00h UTC pour la charge serveur** : argument machine contre argument humain, sur un coût machine négligeable à cette échelle.
- **`0 10 * * *` UTC** : 11h-12h à Paris, au-delà du matin.
- **`TZ=Europe/Paris` + `0 10 * * *`** : 10h pile toute l'année, au prix d'un réglage qui déborde du périmètre des notifications.
- **Heure de réception choisie par l'utilisateur** : une préférence de plus à stocker, exposer et maintenir pour un gain marginal — YAGNI.
- **Garde de silence nocturne dans le code** : le seul chemin planifié est désormais en journée ; le chemin réactif est déclenché par une action humaine, le retarder reviendrait à différer une notification que l'auteur vient de provoquer. Le mode « ne pas déranger » de l'appareil reste la responsabilité du système.
- **Décaler aussi `planning-purge` (01h UTC) pour préserver l'ordre notifications → purge** : l'ordre n'a aucun poids. Un master soft-deleted rend un contexte `null` (`createMasterContextResolver`), donc ne produit aucune notification ; la purge garde son créneau de maintenance.

## Conséquences

- Les rappels J-X arrivent à 9h-10h (Paris).
- L'email des events réactifs (commentaire, changement, annulation) reste agrégé au run quotidien : il est désormais délivré vers 9h-10h le lendemain, au lieu de 1h-2h. Leur **push** part immédiatement depuis le hook et n'est pas concerné. Si la fraîcheur de cet email devient un besoin, le remède est un dispatch immédiat sous garde d'heures calmes — pas un retour au créneau nocturne.
- La purge hebdomadaire des events terminaux (lundi 00h30 UTC) précède maintenant le run du lundi : sans effet, elle ne supprime que des events terminaux de plus de 60 jours.
- Le cron est enregistré au démarrage de PocketBase : le nouveau créneau s'applique au redéploiement du conteneur, sans migration.
