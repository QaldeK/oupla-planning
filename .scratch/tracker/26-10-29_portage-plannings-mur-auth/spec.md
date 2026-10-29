# Spec — Portage des plannings guest au mur d'authentification (app installée)

Status: ready-for-agent
Date: 26-10-29
Origine : discussion portage multi-plannings (28–29 oct. 2026) ; absorbe le ticket backlog `26-10-28_debt_portage-multi-plannings-login`.

## Problem Statement

Un invité qui utilise l'app installée participe souvent à plusieurs plannings (sidebar locale, identités guest par planning). Le jour où il crée son compte depuis le mur d'authentification, la transition guest → auth détruit tout son état local : les plannings en cache sont effacés, leurs tokens disparaissent, ses identités guest n'existent plus nulle part ailleurs. Il repart d'une sidebar vide : seul le planning porté par l'URL est réclamé (à l'activation, après la levée du mur), et son identité n'est plus que devinée par son nom. S'il avait créé des plannings sur cet appareil, il perd aussi leur administration.

Cause racine : la transition ne réclame que le planning **actif** — or derrière le mur, aucun planning n'est activé — et vide ensuite l'intégralité du stockage local, y compris les deux seules données non reconstruisibles : les tokens d'accès et les identités guest.

## Solution

À la **création de compte** au mur d'authentification, une bascule « Rattacher les plannings de cet appareil » (affichée seulement s'il existe des plannings locaux, cochée par défaut) déclenche le rattachement batch de tous les plannings locaux au nouveau compte. Le nettoyage local devient sélectif : les tokens d'accès et les identités guest survivent, le reste ( cache technique jetable) est vidé comme aujourd'hui.

À la première ouverture de chaque planning rattaché, une suggestion exacte — « vous participiez ici en tant que X — rattacher cette identité ? » — permet la fusion d'identité via le modal existant (réponses et commentaires suivent le compte). Le refus garde le comportement actuel (participation sous l'identité du compte), mais annoncé.

**Le parcours des cas non installés (navigateur, desktop en onglet) et du login d'un compte existant reste strictement identique à aujourd'hui.**

## User Stories

1. En tant qu'invité multi-plannings sur l'app installée, je veux qu'à la création de compte au mur mes plannings locaux apparaissent dans ma sidebar, afin de ne pas perdre l'accès à mes plannings.
2. En tant qu'invité multi-plannings sur l'app installée, je veux une bascule pour refuser le rattachement, afin de garder ces plannings hors de mon compte (appareil ou profil partagé).
3. En tant qu'invité créateur de plannings sur l'app installée, je veux que le rattachement me rende le rôle admin des plannings créés sur cet appareil, afin de continuer à les administrer sous mon compte.
4. En tant qu'invité qui crée son compte au mur, je veux que le rattachement soit effectif immédiatement côté serveur (claim batch à la transition), afin d'avoir le realtime actif sans attendre une sync ultérieure.
5. En tant que nouveau compte rattaché, je veux qu'à la première ouverture de chaque planning la suggestion exacte de mon identité guest soit proposée, afin de récupérer mes réponses et commentaires sans devinette.
6. En tant que nouveau compte rattaché, je veux refuser la suggestion, afin de participer sous l'identité de mon compte — avec un message clair annonçant sous quel nom je participe désormais.
7. En tant que nouveau compte rattaché, je veux décider planning par planning (fusionner ici, refuser là), afin de garder le contrôle de mon identité dans chaque planning.
8. En tant qu'utilisateur ayant refusé une suggestion, je veux ne plus être sollicité pour ce planning, afin d'éviter la re-proposition à chaque visite.
9. En tant qu'utilisateur qui ouvre manuellement le menu identité, je veux retrouver l'étape principale (jamais la suggestion), afin d'un comportement inchangé.
10. En tant qu'utilisateur connecté, je veux que la suggestion n'apparaisse que si je ne suis pas déjà lié à un participant du planning, afin de ne pas polluer un état déjà résolu.
11. En tant qu'invité hors-ligne au moment de la création de compte, je veux que mes plannings restent visibles et fonctionnels dans la sidebar, afin de continuer à les consulter et à y répondre ; le rattachement serveur retentera à la prochaine activation ou sync.
12. En tant qu'invité hors-ligne, je veux que l'échec du claim ne détruise rien localement, afin d'une auto-réparation sans perte de données.
13. En tant qu'invité sur iOS (stockage isolé par nature), je veux qu'aucune bascule ne s'affiche si aucun planning local n'existe, afin de ne pas me proposer un portage vide.
14. En tant qu'utilisateur sur la PWA desktop installée, je veux le même portage que sur mobile Android, afin d'un comportement cohérent — le stockage y est partagé avec le profil du navigateur.
15. En tant qu'utilisateur du navigateur (app non installée), je veux que ma transition guest → auth soit byte-identique à aujourd'hui (claim du planning actif + clear total), afin qu'aucun comportement ne change sur mon parcours.
16. En tant que détenteur d'un compte existant qui se connecte au mur, je veux retrouver les plannings de mon compte via la sync standard, afin de retrouver mon environnement — les plannings guest locaux ne sont pas portés dans ce cas.
17. En tant qu'invité qui avait quitté un planning avant de créer son compte, je veux un nouveau départ propre dans ce planning (pas de blocage), afin de ne pas être enfermé dans un état quit hérité.
18. En tant qu'utilisateur multi-appareils, je veux pouvoir rattraper plus tard un doublon créé sur un autre appareil via le menu identité (fusion manuelle), afin de consolider mes participations à ma convenance.
19. En tant qu'utilisateur qui se déconnecte, je veux que tout soit vidé — identités préservées comprises, afin que le logout signifie un départ de zéro sur cet appareil.
20. En tant qu'utilisateur sur un appareil partagé, je veux un libellé de bascule qui dit ce qu'il fait (rattachement définitif à mon compte), afin de décider en connaissance de cause.
21. En tant que nouvel inscrit sans aucun planning local, je veux un mur épuré sans bascule, afin de ne pas voir d'option sans objet.
22. En tant que mainteneur, je veux que la distinction entre claim de plannings (accès) et claim d'identité (participation) soit tranchée dans les docs, afin de ne plus confondre les deux notions.

## Implementation Decisions

### Périmètre et activation

- Le portage s'active si et seulement si : app installée (détection `display-mode: standalone`, évaluée par contexte de navigation — toujours fausse dans un onglet), **création de compte** (pas le login d'un compte existant), bascule acceptée, et au moins un master local. Tout autre cas garde le comportement actuel : claim du planning actif seul + clear total.
- Le mur est la seule surface de login possible en app installée déconnectée (il remplace toute l'UI) : la condition « app installée » équivaut donc à « origine mur ».

### Transmission du consentement

- La transition est déclenchée par le callback `authStore.onChange` (sans argument, fire-and-forget). Le consentement de la bascule transite par un état du wrapper de transition : posé réactivement par le mur (seulement en mode création), lu puis **réinitialisé** par la transition — consommé une seule fois, pas de fuite vers un login ultérieur.

### Transition — claim

- Si portage : claim **batch** de tous les masters locaux via l'endpoint idempotent existant (il valide les tokens par paire, ignore silencieusement les invalides, peuple `masterId` et `adminOf`).
- Suivi d'un `authRefresh` pour propager `masterId`/`adminOf` au record d'auth local dans la session — sinon les guards UI d'accès admin resteraient obsolètes jusqu'à la première activation d'un planning.
- Sinon : claim unique du planning actif (statu quo strict ; derrière le mur, c'est déjà un no-op puisque aucun planning n'est activé).

### Transition — clear

- Si portage : clear **sélectif** — occurrences et commentState vidés ; pour localMeta, tout sauf `currentUser` (`lastFetchAt`, `hasQuit` vidés) ; masters **non** vidés. Les tokens font exister la sidebar ; `currentUser` est la seule donnée non reconstruisible.
- Sinon : clear total (statu quo).

### Politique d'échec

- Bénigne par construction : la re-sync post-login est un upsert pur qui ne supprime jamais les enregistrements locaux absents du serveur. Un claim raté (hors-ligne) laisse donc les plannings visibles et fonctionnels via leurs tokens locaux ; sans realtime jusqu'à réclamation. Auto-réparé à l'activation d'un planning ou à la prochaine sync, qui réclament tous les masters connus.

### Suggestion d'identité (fusion)

- La source de l'indice passe d'un slot mémoire unique (snapshot pris pendant la transition, planning actif seul, non persistant) à l'identité guest persistée par planning dans localMeta, durable jusqu'au logout.
- Input de stratégie **unifié** : slot mémoire **ou** indice persistant (le slot reste la seule source possible sur le parcours navigateur, où le clear total détruit l'indice). Ordre de priorité inchangé : CAS A (déjà lié) > suggestion exacte > CAS B (nom) > CAS C (conflit/auto-add).
- Gardes de validité inchangées : participant cible non lié (sans `userId`) et non quitté.
- **Refus** : efface l'indice persistant du planning concerné (nouvel accesseur du store d'état guest) en plus du slot mémoire ; pas de re-proposition pour ce planning. L'auto-add sans conflit reste le comportement, désormais **annoncé** (message « vous participez désormais en tant que [nom du compte] »).
- Ouverture manuelle du menu identité : étape principale, jamais la suggestion (statu quo).
- La fusion d'identité reste strictement manuelle, par planning, via le modal existant.

### Mur

- Bascule visible si mode création + au moins un master local (lecture Dexie au montage), cochée par défaut ; libellé de famille i18n nommée d'après le contenu (règle projet).

### Décisions de non-action (explicites)

- Aucun changement serveur : les deux endpoints existants suffisent.
- Pas de propagation serveur de l'indice de suggestion (pas de `pendingClaims` sur users) — le doublon cross-device est accepté et récupérable via fusion manuelle.
- `hasQuit` non préservé : fresh start (cohérent avec le serveur, qui refuse le claim sur un participant quitté).
- Logout : clear total, identités comprises — la fenêtre de fusion exacte est la session.

## Testing Decisions

- Philosophie : tester le comportement externe uniquement — fonctions pures à dépendances injectées pour la décision, chaînes d'intégration réelles contre l'instance PocketBase jetable pour le déroulé. Pas de tests d'internals.
- Trois seams, **tous existants** :
  1. **Orchestration de transition** (unitaire, fakes existants) : chemins portage / défaut, ordre des étapes, contenu exact du clear sélectif (masters et `currentUser` survivent, `hasQuit`/`lastFetchAt` vidés), claim batch vs claim unique, authRefresh après batch.
  2. **Stratégie d'identité** (unitaire) : suggestion depuis l'indice persistant, priorité sur CAS B/C, expiration sur indice invalide, repli CAS B/C après refus (indice absent).
  3. **Transition complète** (intégration, instance jetable) : claim batch visible côté serveur (`masterId`/`adminOf` peuplés sur le record users), survie des masters et `currentUser` dans Dexie, vidage du reste. Couvre l'exigence « cas d'intégration sur l'endpoint batch » du ticket backlog absorbé.
- Refus de la suggestion : testé indirectement (option a) — l'écriture de suppression d'indice au seam 3, le comportement « indice absent » au seam 2 ; la glue de la page reste couverte par `check` + svelte-autofixer.
- Validation complète de fin de feature : `bun run check` + `test:unit` + `test:integration`, les trois obligatoires (convention repo).

## Out of Scope

- Transition guest → auth **dans le navigateur** (statu quo intégral, contrainte explicite).
- Portage au **login d'un compte existant** (ses plannings sont servis par la sync du compte).
- Fusion d'identité en lot ou automatique.
- Liste à cocher par planning au mur.
- Route de détachement d'un planning d'un compte (si besoin émergent : nouvelle entrée backlog).
- Propagation serveur de l'indice de suggestion (`pendingClaims`).
- Réactivation d'une suggestion refusée (l'indice est détruit au refus).
- Tauri, canal notificatif invité (déjà tranchés par la spec install-sans-compte).

## Further Notes

- **Vocabulaire** (confusion récurrente, à inscrire dans le glossaire) : **claim de plannings** = rattachement de l'accès (endpoint batch, idempotent, lecture seule côté compte, irréversible) ; **claim d'identité** = fusion d'une participation guest dans le compte (endpoint transactionnel, réponses et commentaires migrés, doublon auto-add récupérable comme source supprimée).
- **Docs à mettre à jour dans la même passe** : doc architecture auth (sections transition + claims, passages « planning actif seul »), doc PWA (§ mur), doc stores et doc offline-sync (références au clear total de localMeta), guide PWA utilisateur, glossaire du domaine.
- **Limites utilisateur-visibles à documenter** : fenêtre de fusion exacte = la session (logout vidant tout) ; doublon silencieux possible sur un autre appareil du compte avant fusion (récupérable via le menu identité) ; sidebar = vérité locale (plannings non réclamés visibles sans realtime jusqu'à réclamation).
- Plateformes : iOS = stockage isolé → la bascule ne s'affiche pas (aucun candidat) ; Android WebAPK et desktop Chrome/Edge installés = stockage partagé avec le profil → tous les plannings guest du profil sont candidats. « Installé » est un moment de conversion déclaré, pas une preuve de propriété du terminal.
