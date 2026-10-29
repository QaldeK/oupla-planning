# Spec — Intégrité de `planning_participants` : déduplication, unicité, defaults alignés

Date : 2026-10-29
Status: ready-for-agent

## Problème

Les préférences de notification d'un Compte sur un planning (push, email, messages, rappels,
marques de lecture) vivent dans une ligne `planning_participants` par couple
(planning, utilisateur). Rien en base n'interdit les doublons : l'index existant sur ce couple
n'est pas unique et `user` n'est pas obligatoire. En prod, 8 couples existent en plusieurs
exemplaires (jusqu'à 3 lignes) et deux lignes n'ont pas de propriétaire (`user` vide).

La lecture applicative prend la première ligne rencontrée. Les préférences appliquées à l'envoi
et celles affichées dans le modal peuvent donc être deux lignes différentes : l'utilisateur coupe
une notification, elle continue de partir — ou l'inverse. Quatre chemins créent des doublons :
une lecture qui confond « erreur réseau/serveur » et « absent » puis crée ; des créations
concurrentes non atomiques (client et serveur) ; des appels multiples depuis les effets de page
et le claim d'identité ; et l'absence de toute contrainte en base.

## Solution

Un seul enregistrement par (planning, utilisateur), garanti par un index unique et un champ
`user` obligatoire. Une migration transactionnelle unique fusionne les doublons existants selon
une règle déterministe — la ligne la plus récemment modifiée gagne, l'historique de lecture
fusionne clé par clé en gardant la date la plus récente, les lignes sans propriétaire sont
supprimées — et comble le périmètre de messages vide selon le rôle. Le client ne crée qu'en
l'absence certaine (404) et, en cas de course, relit la ligne gagnante au lieu de jeter. Les
defaults posés à la création dépendent du rôle des deux côtés, alignés.

## User stories

1. En tant que participant authentifié, je veux que les préférences appliquées à l'envoi soient
   exactement celles que j'affiche et modifie, afin qu'une notification coupée le soit réellement.
2. En tant que participant, je veux que rouvrir le modal de notifications montre ce que j'ai
   enregistré, afin de pouvoir faire confiance à l'interface.
3. En tant que participant, je veux que mes marques « message lu » survivent à la fusion, afin de
   ne pas recevoir des notifications pour des messages déjà lus.
4. En tant que participant, je veux que la date de lecture conservée pour un message soit la plus
   récente des lignes fusionnées, afin que la fusion n'invente ni lecture ni relecture.
5. En tant que participant, je veux qu'un échec réseau pendant la vérification d'existence ne
   crée pas de seconde ligne, afin que mes préférences restent uniques.
6. En tant que participant utilisant deux appareils en même temps, je veux que l'ouverture
   simultanée de l'app ne duplique pas mes préférences, afin que l'état reste cohérent.
7. En tant que participant, je veux qu'une création qui perd une course relise la ligne gagnante
   au lieu d'échouer, afin que rejoindre un planning reste silencieux et sans erreur.
8. En tant qu'organisateur, je veux recevoir les alertes de confirmation par défaut dès la
   création de ma ligne côté client, afin que mon rôle soit pris en compte quelle que soit la
   voie de création.
9. En tant qu'organisateur promu par le claim admin, je veux une ligne créée avec un périmètre de
   messages défini (`all`), afin de suivre les conversations sans réglage manuel.
10. En tant que participant créé par une voie serveur, je veux un périmètre de messages par
    défaut défini (`concerned`), afin de ne pas être coupé des messages sans l'avoir choisi.
11. En tant que participant dont la ligne porte un périmètre vide (état hérité d'un bug), je veux
    qu'il soit comblé selon mon rôle sur le planning, afin que l'application retrouve l'intention
    du design au lieu d'un opt-out silencieux.
12. En tant que système (cron de notifications), je veux lire au plus une ligne de préférences par
    (planning, utilisateur), afin que le fan-out soit déterministe.
13. En tant que système, je veux qu'une tentative de création dupliquée échoue en base, afin
    qu'aucun chemin applicatif, présent ou futur, ne réintroduise le problème.
14. En tant qu'opérateur, je veux que la fusion, le comblement et la pose de l'index se fassent
    dans une seule transaction, afin qu'un échec ne laisse jamais la base à moitié traitée.
15. En tant qu'opérateur, je veux un rapport loggé par groupe (ligne gardée, lignes supprimées,
    champs comblés, clés de lecture fusionnées), afin de pouvoir auditer l'opération.
16. En tant qu'opérateur, je veux pouvoir exécuter la migration sur une copie de la base, afin de
    valider le rapport sans toucher aux données.
17. En tant qu'opérateur, je veux que le `down` restaure le schéma (index non unique, `user`
    optionnel), afin qu'un retour arrière structurel reste possible — les fusions de données
    restant, elles, irréversibles.
18. En tant que développeur, je veux une règle de fusion déterministe (mêmes entrées → mêmes
    sorties), afin que le résultat ne dépende pas de l'ordre d'exécution.
19. En tant que développeur, je veux que seule l'erreur 404 signifie « absent », afin que les
    erreurs réseau ou serveur remontent au lieu d'être interprétées comme une absence.
20. En tant que développeur, je veux que les defaults dépendant du rôle soient couverts par les
    tests unitaires existants, afin que l'alignement client/serveur soit verrouillé.

## Décisions d'implémentation

- **Contrainte en base** : l'index sur (`planning`, `user`) devient unique (même nom, contrainte
  renforcée) et `user` devient requis. L'index simple sur `planning` reste inchangé.
- **Migration unique, transactionnelle, autosuffisante** — ordre imposé : suppression des lignes
  à `user` vide → fusion des groupes dupliqués → comblement du périmètre vide → `user` requis →
  index unique. Tout dans `migrate(up, down)` avec l'app transactionnelle reçue en paramètre ;
  un échec à n'importe quelle étape annule tout et la migration n'est pas marquée appliquée.
- **Règle de fusion (déterministe)** :
  - groupement par (`planning`, `user`) tels qu'enregistrés, y compris valeurs vides ;
  - lignes canoniques : `updated` le plus récent, départage `created` décroissant, puis `id`
    décroissant ;
  - champs scalaires : la canonique gagne ; une valeur vide (null, chaîne vide, tableau vide) est
    complétée par la valeur non vide la plus récente des autres lignes du groupe — seuls le
    périmètre de messages et les deux selects jours peuvent être vides (les booléens ont toujours
    une valeur, les relations `planning`/`user` sont les clés de groupement) ;
  - `commentReadState` : union des clés, timestamp le plus récent gagne par clé (comparaison
    lexicographique, les timestamps sont ISO 8601) ;
  - périmètre de messages vide comblé : `all` si l'entrée participant correspondante dans le
    JSON `participants` du master porte `isAdmin`, sinon `concerned` ; rôle indéterminable →
    `concerned` ;
  - rapport loggé par groupe : ligne gardée, lignes supprimées, champs comblés, nombre de clés
    de lecture fusionnées.
- **Pas de hook de garde** : l'index unique est la garde. La sécurité vit dans les API Rules et
  les contraintes DB, pas en JS ; un `create` dupliqué répond 400.
- **Client — lecture** : seule l'erreur 404 signifie « absent » ; toute autre erreur propage.
  Concerné par les trois lectures de lignes de préférences (lecture simple, mise à jour,
  garantie d'existence).
- **Client — création en course** : échec de `create` → relecture du couple ; ligne trouvée =
  succès ; sinon l'erreur d'origine relance. La garantie d'existence ne réécrit jamais une ligne
  existante ; la mise à jour passe par le même chemin lecture puis création.
- **Defaults alignés, posés à la création seulement** : côté client, `onConfirmationNeeded`
  suit le rôle (admin → `true`, aujourd'hui toujours `false`) ; côté serveur, `newCommentScope`
  est posé à la création (`all` si admin, sinon `concerned`, aujourd'hui absent → null). Les
  transitions de rôle ultérieures ne réécrivent pas les prefs — sauf le comportement existant de
  la promotion admin qui force les alertes de confirmation.
- **Types régénérés avec la migration** : `migrate:up` enchaîne application + génération ; le
  diff des types est committé avec la migration (gate schéma du dépôt).
- **Pas de script de dry-run parallèle** : le dry-run consiste à exécuter la migration elle-même
  sur une copie de la base (`sqlite3 .backup` vers un dossier temporaire, puis `migrate up` sur
  cette copie), puis à l'inspecter en SQL. Une seule implémentation de la règle de fusion — un
  script dupliquerait la logique et dériverait. Remplace le script Bun évoqué en amont.

## Décisions de test

- Bon test = comportement externe uniquement (lignes en base, réponses d'API, erreurs
  propagées), jamais l'ordre interne des appels.
- **Seam automatisé unique** : l'instance jetable PocketBase des tests d'intégration (port
  8091), seam existant, plus des tests unitaires du service client avec le client PB mocké.
  Prior art : les tests d'intégration créent déjà des lignes `planning_participants`
  (`notifications-cron`), couvrent `/api/claim-admin` (`planning-store-auth-claim`) ; les
  tests unitaires mockent déjà des modules (fichiers `PlanningForm-*`).
- Cas d'intégration :
  - garantie d'existence appelée deux fois séquentiellement → une seule ligne ;
  - garantie d'existence appelée deux fois concurrentes → une seule ligne, aucune erreur ;
  - `create` dupliqué direct via l'API → 400 (l'index existe et s'applique) ;
  - `/api/claim-admin` sur un user sans ligne → ligne créée avec périmètre `all` et alertes de
    confirmation à `true`.
- Cas unitaires :
  - lecture renvoyant une erreur non-404 → l'erreur propage, aucun `create` émis ;
  - `create` en échec puis relecture trouvée → succès ;
  - defaults par rôle : `getDefaultPlanningPrefs` expose `onConfirmationNeeded` dépendant du
    rôle (mise à jour du test existant qui fige aujourd'hui l'inverse) ;
  - defaults serveur : `getDefaultParticipantPrefs` expose `newCommentScope` selon le rôle.
- **Migration hors suite automatisée** (règle du dépôt : pas de rejeu de migration dans les
  tests d'intégration). Validation manuelle sur la base dev : copie cohérente de `data.db`,
  migration appliquée sur la copie, inspection SQL (zéro doublon, index unique présent, zéro
  `user` vide, échantillons d'historique de lecture fusionné, rapport relu), puis application
  réelle sur dev.
- Gate complet de fin de feature : `check` + tests unitaires + tests d'intégration.

## Hors périmètre

- Modèle B (mute par appareil, `muted_plannings`) et sa migration de backfill.
- Refonte UI du modal de notifications (modèle A — état local, bouton d'activation par appareil).
- Retrait du champ legacy `users.push_subscription` (chantier suivant).
- Réécriture de préférences existantes non vides : seul le périmètre vide est comblé.
- `planning` requis (aucune ligne vide observée ; suivi possible, même mécanique).
- Application des migrations au boot en prod (déjà livré séparément).

## Notes

- Volume faible : 8 groupes en prod. La base dev, plus riche en doublons, est le meilleur
  terrain pour observer des groupes aux préférences divergentes — le rapport du dry-run doit y
  être relu avant toute application prod.
- La règle « la plus récente gagne » peut perdre un choix utilisateur si le doublon le plus
  récent porte des defaults purs (création née d'une erreur réseau juste après une modif). La
  fusion des champs vides et le rapport loggé rendent ce cas visible ; il reste acceptable au
  volume observé.
- Les lignes à `user` vide sont illisibles par la règle d'accès (`user.id = @request.auth.id`) :
  leur suppression ne retire rien à personne. Aucune collection ne référence
  `planning_participants` par relation : pas de cascade entrante à préserver.
- Le `down` restaure l'index non unique et `user` optionnel, mais ne ressuscite pas les lignes
  fusionnées : le rollback données passe par le backup du volume.
