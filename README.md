# Oupla Planning

<p align="center">
  <img src="static/logo.svg" alt="Oupla Planning" width="120" />
</p>

<p align="center">
  Planifiez et suivez vos activités récurrentes — simple, gratuit, sans inscription.
</p>

<p align="center">
  <a href="https://svelte.dev"><img src="https://img.shields.io/badge/SvelteKit-5-ff3e00?logo=svelte" alt="SvelteKit 5" /></a>
  <a href="https://pocketbase.io"><img src="https://img.shields.io/badge/PocketBase-0.36-b8dde6?logo=pocketbase" alt="PocketBase 0.36" /></a>
  <a href="https://web.dev/progressive-web-apps/"><img src="https://img.shields.io/badge/PWA-yes-5a0fc8" alt="PWA" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="AGPL-3.0" /></a>
</p>

---

## Qu'est-ce que c'est ?

Oupla est une application web progressive (PWA) pour gérer les présences et la coordination de tâches lors d'événements récurrents. Elle fonctionne sans inscription : il suffit d'un nom pour participer, et d'un lien pour créer un planning. Visiter le site: https://planning.oupla.net/

### Comment ça marche

1. **Créez votre planning** — Définissez la récurrence (quotidien, hebdomadaire, mensuel…), les horaires et les tâches à pourvoir.
2. **Partagez le lien** — Envoyez le lien participant à votre groupe. Aucune inscription n'est requise pour répondre.
3. **Suivez les réponses** — Voyez qui sera présent·e, qui s'occupe de quoi, et communiquez via les commentaires en temps réel.

---

## Fonctionnalités

### Gestion des présences

Chaque participant·e indique sa disponibilité (présent·e, si besoin, peut-être, absent·e). Les administrateur·ices peuvent activer/désactiver chaque type de réponse indépendamment. Un indicateur de quorum montre en temps réel le nombre de présent·es par rapport au minimum requis.

### Tâches et bénévolat

Créez des tâches avec un nombre de volontaires requis, catégorisées par moment (avant, pendant, après l'événement). Les participant·es s'inscrivent librement. L'inscription à une tâche « pendant l'événement » marque automatiquement le participant·e comme présent·e. Les admin·es peuvent aussi assigner manuellement des volontaires.

### Récurrence flexible

6 modes de génération de dates : quotidien, hebdomadaire, bihebdomadaire, mensuel par date, mensuel par jour (ex. « 3ᵉ vendredi »), et mode libre avec sélection manuelle. Chaque occurrence peut être modifiée individuellement (horaire, lieu, tâches, description).

### Commentaires

Fil de discussion intégré à chaque événement, avec suivi des messages non lus (indicateur visuel dans la sidebar). Les conversations passées sont en lecture seule.

### Notifications

Alertes push (Web Push API) et email, configurables par planning : rappels de participation, alertes d'absent·es, notifications de changement d'horaire, d'annulation et de nouveaux messages.

### Confirmation d'événements

Mode « à confirmer » : les événements nécessitent une validation explicite de l'admin avant d'être considérés comme actifs. L'admin est alerté·e si le quorum n'est pas atteint ou si des tâches manquent de volontaires.

---

## Pour qui ?

Oupla s'adresse à tout groupe ayant besoin de coordonner des présences et des rôles sur des créneaux récurrents : associations, clubs sportifs, groupes musicaux, équipes bénévoles, comités…

---

## Pourquoi Oupla

- **Sans inscription** — Participez simplement avec votre nom. Créez un planning sans créer de compte.
- **Installable** — Ajoutez l'app à votre écran d'accueil pour une expérience native avec notifications push.
- **Rapide** — Stockage local pour un affichage instantané, synchronisation automatique avec le serveur.

---

## Stack technique

| Couche          | Technologie                                   |
| --------------- | --------------------------------------------- |
| Frontend        | Svelte 5 (runes), SvelteKit 2, TypeScript     |
| Backend         | PocketBase 0.36                               |
| Stockage local  | Dexie (IndexedDB)                             |
| Synchronisation | pb-sync (couche custom avec merge strategies) |
| Desktop         | Tauri 2                                       |
| Déploiement     | Cloudflare Pages                              |
| Styles          | Tailwind CSS 4 + DaisyUI 5                    |
| Icônes          | lucide-svelte                                 |

## Développement

### Prérequis

- [Bun](https://bun.sh)
- Le binaire PocketBase est inclus dans le dépôt (`pocketbase/pocketbase`)

### Lancer l'app (2 terminaux)

```bash
bun install

# Terminal 1 — front (http://localhost:5173)
bun run dev

# Terminal 2 — PocketBase (http://127.0.0.1:8090)
cd pocketbase && ./pocketbase serve --dev
```

`--dev` recharge les hooks (`pb_hooks/`) à chaud et active le logging verbeux.

### Tester les notifications push (3ᵉ terminal)

Le push end-to-end (navigateur → PocketBase → notify-service → appareil) nécessite
le **notify-service** (dépôt séparé) et deux variables d'environnement côté PocketBase :

```bash
# Terminal 3 — notify-service (http://localhost:3001)
cd <notify-service> && bun run dev

# Terminal 2 (relancé ainsi) — envoi vers le service local, liens vers le dev
cd pocketbase
NOTIFY_SERVICE_URL=http://127.0.0.1:3001/notify \
PUBLIC_BASE_URL=http://localhost:5173 \
./pocketbase serve --dev
```

| Variable              | Rôle                                        | Défaut                                          |
| --------------------- | ------------------------------------------- | ----------------------------------------------- |
| `NOTIFY_SERVICE_URL`  | URL d'envoi des push                       | Service Docker interne (prod)                   |
| `PUBLIC_BASE_URL`     | Base des liens de clic des notifications   | `https://planning.oupla.net`                    |

Côté front, `.env.local` (gitignoré) doit définir la clé publique VAPID —
la **même paire** que le notify-service visé :

```bash
VITE_VAPID_PUBLIC_KEY=<clé publique de la paire du notify-service>
```

Déclencheur de test : activer les push dans un planning (modal Notifications),
puis modifier l'horaire d'une occurrence future → push immédiat.

### Vérifications

```bash
bun run check             # typecheck (svelte-check)
bun run test:unit         # tests unitaires
bun run test:integration  # tests d'intégration (PocketBase requis sur 127.0.0.1:8090)
bun run lint              # biome
```

---

## Licence

Ce projet est distribué sous licence [AGPL-3.0](LICENSE).
