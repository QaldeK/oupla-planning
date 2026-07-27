# Consistency list — vocabulaire anglais des termes métier

Référence unique pour qu'un même concept se traduise par le même mot anglais
partout dans l'UI. Toute ambiguïté tranchée ici l'emporte sur les messages JSON.

## Entités principales

| Terme FR (source) | Traduction EN | Notes |
| --- | --- | --- |
| Planning | **Planning** | "Schedule" est rejeté : trop générique et moins fidèle au produit. "Planning" existe en anglais (planning = l'acte, un planning = le document) — utilisé comme nom propre de l'entité. |
| Occurrence | **Occurrence** | Instance datée d'un Planning. Terme technique identique EN/FR. |
| Participant | **Participant** | Sens identique EN/FR. |

## TaskType (affectations de tâches)

| Code (enum) | FR | EN |
| --- | --- | --- |
| `before` | Avant | **Before** |
| `on` | Pendant | **During** |
| `after` | Après | **After** |

`on` → **During** (et non "On") : "on" seul est non idiomatique pour une tâche
qui se passe *pendant* l'événement. L'enum interne reste `on` (stable, pas de
migration) — seule l'étiquette affichée change.

## RecurrenceType

| Code (enum) | FR | EN |
| --- | --- | --- |
| `DAILY` | Quotidienne | **Daily** |
| `WEEKLY` | Hebdomadaire | **Weekly** |
| `BIWEEKLY` | Bi-hebdomadaire | **Biweekly** |
| `MONTHLY_BY_DATE` | Mensuel (date fixe) | **Monthly (fixed date)** |
| `MONTHLY_BY_DAY` | Mensuel | **Monthly** |
| `CUSTOM` | Choix libre des dates | **Custom dates** |

## ResponseType (réponses de présence)

| Code (enum) | FR | EN |
| --- | --- | --- |
| `present` | Présent | **Present** |
| `if_needed` | Si besoin | **If needed** |
| `maybe` | Peut-être | **Maybe** |
| `absent` | Absent | **Absent** |

## Interface (UI)

| Terme FR (source) | Traduction EN | Notes |
| --- | --- | --- |
| Profil | **Profile** | Onglet et section de la page Settings. |
| Sécurité | **Security** | Onglet de la page Settings. |
| Mot de passe | **Password** | Titre de section, modale, labels. |
| Session | **Session** | Titre de section pour la déconnexion. |
| Enregistrer | **Save** | Bouton principal de sauvegarde. |
| Modifier | **Edit** | Bouton d'édition inline. |
| Annuler | **Cancel** | Bouton d'annulation dans les modales. |
| Déconnexion | **Log out** | Bouton de déconnexion (pas "Logout" en un mot). |

## Conventions de clés

- Format : `<feature>_<sujet>[_<détail>]`, snake_case, préfixe `common_` pour
  le partagé.
- Les clés sont rédigées en **anglais** (ex. `common_install_app`), pas en FR.
- Le FR est la locale source (`baseLocale: "fr"`) ; l'EN est dérivé.
