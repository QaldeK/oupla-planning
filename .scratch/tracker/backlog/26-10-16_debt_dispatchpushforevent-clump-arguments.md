> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: `debt` · Urgence: `light` · Source: code-review du diff issue 01 · Ancre: `notify-on-occurrence-update.pb.js` (~181 et ~258)

- Clump d'arguments de `dispatchPushForEvent` (8 champs, dont 5 invariants : `resolveUser`, `buildPushTitle`, `buildPushBody`, `sendPushNotification` + `recipients`), dupliqué aux deux sites — préexistant, un `pushEventForOccurrence(...)` l'absorberait.
