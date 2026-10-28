# Politique compte utilisateur après installation PWA

Status: needs-triage
Type: design (grilling)

## Problème

L'invite post-installation (AccountModal en `welcomeMode`) est fermable définitivement :
marquée « vue » à l'ouverture, jamais réaffichée. Une installation sans compte crée des
comportements inattendus — pas de centralisation des plannings, notifications incertaines.
Question de fond : une installation sans création de compte a-t-elle du sens, et faut-il
« forcer » la création de compte ?

## Questions ouvertes (dans l'ordre)

1. **Factuel d'abord** : que perd réellement un invité sans compte aujourd'hui ?
   - Les invités reçoivent-ils déjà les push ? (cf. `docs/architecture/push-notifications.md`
     + ADR-0014 — à vérifier, la prémisse « absence de notification » est peut-être fausse
     pour les invités identifiés.)
   - Que manque-t-il exactement sans compte : la liste centralisée des plannings, le
     multi-device, autre ?
2. **Politique** : trois candidats.
   - a) Mur : compte requis à l'installation (ou au premier lancement).
   - b) Progressif : invité par défaut, incitation renforcée quand la valeur apparaît
     (2e planning, retour sur l'app, activation push).
   - c) Hybride : compte requis pour *créer* un planning, invité accepté pour *participer*.
3. **Si mur** : à quel moment exact ? Que devient le parcours participant invité
   (IdentifyModal, identité scopée au planning — ADR-0002) ?
4. **Migration** : que deviennent les données invitées (Dexie/localMeta, ADR-0003) quand
   un invité crée ensuite un compte ?

## Contrainte

Ne pas casser le parcours d'adoption par lien partagé : un participant invité doit rester
capable de répondre à un planning sans friction compte. Toute politique « forcer » doit
mesurer l'impact sur ce parcours.

## Prochain pas

Session `/grill-with-docs` dédiée après vérification du point 1.
