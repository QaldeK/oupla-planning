# Ouvrir les liens Oupla dans la PWA installée

Status: needs-info (checklist device en attente — bloquée sur push/déploiement)

## Problème

Les liens Oupla (invitations de planning) s'ouvrent dans le navigateur, même quand l'app
est installée sur le terminal. Attendu : quand la PWA est installée, un lien in-scope
devrait s'ouvrir dans l'app.

## Faits (recherche octobre 2026)

- **Desktop Chrome/Edge 139+** : « navigation capturing » par défaut — un lien in-scope
  s'ouvre dans la PWA installée, sauf opt-out utilisateur. Plus rien à faire.
  (source : developer.chrome.com/docs/capabilities/pwa-navigation-management)
- **Android (WebAPK, install via Chrome/Chromium)** : la PWA s'enregistre comme handler
  de son scope ; effectif selon le réglage du terminal (Infos app → Liens supportés →
  Oupla). Aucun contrôle développeur direct.
- **`handle_links`** (membre de manifest) : proposition WICG non implémentée, ignorée
  par Chrome 155 → aucun levier déclaratif aujourd'hui.
- **`launch_handler: { client_mode: "navigate-existing" }`** : contrôle comment la PWA
  s'ouvre une fois un lien capturé (focus de la fenêtre existante au lieu d'une nouvelle
  fenêtre). Supporté Chromium 96+.
- **iOS/iPadOS** : une PWA installée depuis Safari ne peut pas capturer d'URL. Hors de
  notre contrôle.

## Travail

1. **Prérequis (chantier labelling PWA, si accord)** : hardening du manifest — `id`
   explicite, `scope: "/"`, `launch_handler`.
   ✅ Fait — commit `57a1b5d` (`id`, `scope`, `launch_handler` navigate-existing,
   `related_applications` en sus pour le gate de détection).
2. **Vérification device** : liens partagés via une app tierce (mail, WhatsApp) vers
   `/p/[token]` — où s'ouvrent-ils ? Chrome Android, Brave Android, Chrome desktop
   139+. Noter les écarts.
   ⬜ Bloqué sur le push/déploiement — checklist prête dans le guide (§ Capture de
   liens), à remplir sur device.
3. **Guide utilisateur** : enrichir `.agents/doc/user_guide/pwa-guide.md` avec le
   réglage « Ouvrir les liens supportés » (Android) et le comportement desktop.
   ✅ Fait — section « Capture de liens » ajoutée ; au passage, les sections décrivant
   l'ancien `pwaStore`/`PwaInstallCard` ont été mises à jour (scission installStore /
   swUpdateStore, invite permanente, gate terminal).
4. **Optionnel** : explorer `assetlinks.json` (`common.query_webapk`) — détection
   cross-browser d'un WebAPK sur Android ; à relier au chantier de détection
   d'installation.
   ❌ Écarté par l'auteur (28-10-2026) : trop edge case. À réouvrir si le besoin
   cross-browser émerge.

## Acceptation

- [ ] Checklist device remplie (où s'ouvrent les liens selon navigateur/OS) — bloqué
      sur push/déploiement ; template dans le guide (§ Capture de liens).
- [x] Guide utilisateur à jour.
- [x] Manifest durci (fait dans le chantier labelling).
