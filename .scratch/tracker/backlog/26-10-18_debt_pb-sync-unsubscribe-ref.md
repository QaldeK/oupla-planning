> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: `debt` · Urgence: `conditional` · Source: implémentation 05a · Ancre: `src/lib/pb-sync/` (`unsubscribe(ref)`)

- `unsubscribe(ref)` (référence, unitaire) n'est appelé nulle part dans l'app et n'est couvert par aucun test ; il ne prévient pas `onSubscriptionChange`, donc `hasActiveSubscription` resterait vrai après un tel appel.
