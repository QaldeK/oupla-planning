# 03: Détection de déploiement — `updated` vs mécanique maison

**What to build:** Une décision tranchée et implémentée sur la détection des nouveaux déploiements. Kit 3 introduit une détection native (`updated` de `$app/state` : réponses data/remote/form, focus et visibilité de l'onglet, polling `version.pollInterval` — désormais 1 h par défaut). Elle cohabite avec la mécanique maison d'activation automatique du SW (ticket du 26-10-14). Arbitrer : garder la mécanique maison, adopter `updated`, ou hybride — et configurer `pollInterval` explicitement pour ne rien subir du défaut. Aucun scénario de double rechargement ou de double prompt ne doit rester possible.

**Blocked by:** 02 (Service worker modernisé).

**Status:** ready-for-agent

- [ ] Décision documentée avec rationale (garder maison / adopter `updated` / hybride) — ADR si adoption
- [ ] `version.pollInterval` configuré explicitement (valeur choisie, pas le défaut subi)
- [ ] Aucun scénario de double rechargement ni de double prompt utilisateur
- [ ] Tests unitaires couvrant la logique retenue
