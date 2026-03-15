# UI/UX Improvements Design Document

**Date**: 2025-03-15
**Auteur**: Claude (Brainstorming session with user)
**Statut**: ✅ Design validé, prêt pour implémentation

---

## Executive Summary

Ce document décrit le design pour 3 améliorations UI/UX majeures de l'application Oupla Planning :

1. **PWA Store & Installation** - Détection et installation PWA avec synchronisation PocketBase
2. **Refonte Cards /p/[token]** - Regroupement de 5 cards en 2 cards plus compactes
3. **Refonte HomePage** - AuthForm inline au lieu du modal automatique

**Approche d'implémentation**: Par feature complète (3 jours)

---

## Background & Motivation

### Problèmes identifiés (TODO.md)

1. **Cards /p/[token]**: Trop volumineux sur mobile (5 cards empilées)
2. **HomePage**: identifyModal automatique intrusif, pas de mise en avant du PWA
3. **PWA**: Pas de détection/invitation à l'installation

### Objectifs UX

- **Lisibilité mobile**: Réduire le scroll avec des cards plus compactes
- **Clarification**: Regrouper par thématique plutôt que disperser l'information
- **Conversion**: Inciter à l'installation PWA et à la création de compte
- **Fluidité**: Éviter les modals automatiques intrusifs

---

## Feature 1: PWA Store & Installation

### Objectif

Détecter si l'application tourne en mode PWA installée et offrir un bouton d'installation conditionnel.

### Architecture

**Nouveau fichier**: `src/lib/stores/pwaStore.svelte.ts`

```typescript
class PwaStore {
	isInstalled = $state(false);
	canInstall = $state(false);
	deferredPrompt = $state<any>(null);
	#initialized = false;

	async init() {
		if (this.#initialized) return;
		this.#initialized = true;

		// Détection client
		this.isInstalled =
			window.matchMedia('(display-mode: standalone)').matches ||
			window.matchMedia('(display-mode: fullscreen)').matches ||
			(window.navigator as any).standalone === true;

		// Sync PocketBase
		if (pb.authStore.isValid) {
			try {
				const user = await pb.collection('users').getOne(pb.authStore.record!.id);
				this.isInstalled = this.isInstalled || (user.pwa_installed ?? false);
			} catch {
				/* ignore */
			}
		}

		// Listeners avec on() pour cleanup
		on(window, 'beforeinstallprompt', (e) => {
			e.preventDefault();
			this.canInstall = true;
			this.deferredPrompt = e;
		});

		on(window, 'appinstalled', () => {
			this.isInstalled = true;
			this.canInstall = false;
			this.deferredPrompt = null;
			this.#syncToPocketBase();
		});

		on(window.matchMedia('(display-mode: standalone)'), 'change', (e) => {
			this.isInstalled = e.matches;
		});
	}

	async install() {
		/* ... */
	}
	async #syncToPocketBase() {
		/* ... */
	}
}
```

**Intégration**: `src/routes/+layout.svelte`

```typescript
import { pwaStore } from '$lib/stores/pwaStore.svelte';
pwaStore.init(); // Direct, pas de onMount
```

### Composant: PwaInstallCard

**Nouveau fichier**: `src/lib/components/PwaInstallCard.svelte`

**Design**: Alert-success avec:

- Icône Download (size 20-24)
- Titre: "Installez l'application pour rester informé"
- Liste des bénéfices (messages, participants manquants, annulations)
- Bouton "Installer" + "Plus tard" (dismissible)

**Condition d'affichage**:

```svelte
{#if !pwaStore.isInstalled && pwaStore.canInstall && !dismissed}
	<PwaInstallCard />
{/if}
```

### Décisions de design

**Pourquoi store dédié ?**

- userStore déjà complexe
- Séparation des préoccupations
- Plus testable avec Svelte 5 runes

**Pourquoi alert-success ?**

- Vert = incitation à l'action
- Bénéfice positif mis en avant

**Pourquoi dismissible ?**

- Évite la frustration si l'utilisateur ne veut pas installer
- Réaffiche au prochain visit si besoin

---

## Feature 2: Refonte Cards /p/[token]

### Objectif

Regrouper 5 cards séparées en 2 cards thématiques plus compactes.

### Structure cible

**Avant (5 cards)**:

1. Card Description
2. Card Récurrence
3. Card Participants
4. Card Notifications
5. Card Identification

**Après (2 cards)**:

- **Card 1: Infos Planning** - Récurrence, Description (conditionnel), Participants
- **Card 2: Votre Expérience** - Identité, Notifications

### Design minimaliste

- **Pas de titre principal** aux cards
- **Icones discrètes**: size 18 (au lieu de 24), text-primary/70
- **Layout responsive**: flex-wrap avec min-width 50%

### Implémentation technique

```html
<!-- Card 1: Infos Planning -->
<div class="flex flex-wrap items-start gap-4">
	<!-- Récurrence -->
	<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
		<Calendar size="{18}" class="text-primary/70 mt-0.5 shrink-0" />
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-medium">{getRecurrenceLabel(master.recurrence)}</p>
			<p class="text-base-content/60 text-xs">
				{master.defaultStartTime} — {master.defaultEndTime}
			</p>
		</div>
	</div>

	<!-- Description (conditionnel) -->
	{#if master.description}
	<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
		<InfoIcon size="{18}" class="text-primary/70 mt-0.5 shrink-0" />
		<p class="text-base-content/80 line-clamp-2 text-sm">{master.description}</p>
	</div>
	{/if}

	<!-- Participants -->
	<div
		class="{master.description ? 'min-w-[calc(50%-0.5rem)]' : 'w-full'} flex flex-1 items-start gap-2"
	>
		<Users size="{18}" class="text-primary/70 mt-0.5 shrink-0" />
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">
				{master.participants.length} participant{master.participants.length > 1 ? 's' : ''}
			</p>
			<div class="mt-1 flex flex-wrap gap-1.5">
				{#each master.participants as p (p.id)}
				<span class="badge badge-sm badge-ghost opacity-70">{p.name}</span>
				{/each}
			</div>
		</div>
	</div>
</div>
```

**Explication flex-wrap**:

- `gap-4` = 1rem = 16px
- `min-w-[calc(50%-0.5rem)]` = 50% - 8px par élément
- Si description absente: participants prend `w-full` (100%)
- Si description présente: participants a `min-w-[calc(50%-0.5rem)]`

**Comportement attendu**:

- Desktop AVEC description: Récurrence (50%), Description (50%), Participants (50%) → 3 éléments sur 2 lignes
- Desktop SANS description: Récurrence (50%), Participants (100%) → 2 éléments sur 2 lignes
- Mobile: Empilement vertical naturel

### Ordre: Identité → Notifications

**Logique UX**: L'utilisateur doit d'abord savoir qui il est avant de configurer ce qu'il reçoit.

**Impact**: Boutons d'action plus cohérents (S'identifier → Changer, puis Configurer)

### Décisions de design

**Pourquoi 2 cards ?**

- Trop de scroll sur mobile avec 5 cards
- Regroupement thématique plus clair
- "Infos Planning" vs "Votre Expérience"

**Pourquoi flex-wrap ?**

- Flexibilité si un élément est absent (description)
- Participants peut prendre plus de place si besoin
- Responsive naturel avec min-width

**Pourquoi Identité avant Notifications ?**

- Logique: d'abord qui je suis, ensuite ce que je reçois
- Cohérence des boutons d'action

---

## Feature 3: Refonte HomePage

### Objectif

Remplacer le identifyModal automatique par une AuthForm inline avec alert-info explicative.

### Composant: AuthSection

**Nouveau fichier**: `src/lib/components/homepage/AuthSection.svelte`

**Structure**:

1. **Alert-info**: 3 bénéfices du compte
   - Retrouver ses plannings sur tous les appareils
   - Recevoir des notifications par email
   - Protéger son identité
2. **AuthForm inline**: Formulaire d'inscription/connexion
3. **Bascule**: Register ↔ Login

**Design**:

- Alert-info (bleu) = information neutre
- Card autour du AuthForm pour délimitation
- Boutons d'action clairs

### Intégration HomePage

**Fichier**: `src/routes/+page.svelte`

**Avant**: Si pas de globalProfile → identifyModal automatique

**Après**: Si pas de globalProfile → PwaInstallCard + AuthSection

```svelte
{#if !userStore.globalProfile}
	<div class="space-y-6">
		<PwaInstallCard />
		<AuthSection />
	</div>
{:else}
	<!-- Liste des plannings (existante) -->
{/if}
```

### Suppression identifyModal auto

**Fichier**: `src/lib/stores/userStore.svelte.ts`

**Avant**:

```typescript
// Dans init()
if (!this.globalProfile) {
	this.authModal = { open: true, mode: 'homepage' };
}
```

**Après**:

```typescript
// Supprimer ce bloc - plus de modal auto sur homepage
```

**IMPORTANT**: Garder le modal pour:

- `/p/[token]` → mode: 'planning'
- `/admin/[token]` → mode: 'planning'

### Décisions de design

**Pourquoi page dynamique ?**

- Moins de routes (pas de /dashboard séparé)
- Transition fluide après connexion
- Pas de redirect nécessaire

**Pourquoi AuthForm inline ?**

- Moins intrusif qu'un modal
- L'utilisateur voit le contexte
- Meilleure conversion

**Pourquoi alert-info ?**

- Explique l'intérêt du compte
- Bleu = neutre/informatif (contrairement au PWA en vert)

---

## Tests & Validation

### Feature 1: PWA Store

**Tests manuels**:

- [ ] Chrome desktop: beforeinstallprompt, installation fonctionne
- [ ] Chrome Android: display-mode: standalone après installation
- [ ] Safari iOS: navigator.standalone après installation
- [ ] PocketBase sync: users.pwa_installed = true après installation
- [ ] Cross-device: Flag sync sur desktop → mobile

**Critères de succès**:

- Bouton PWA affiché SEULEMENT si !isInstalled && canInstall
- Installation fonctionne sur Chrome/Edge
- display-mode détecté correctement
- Sync PocketBase fonctionnel

### Feature 2: Cards Refactor

**Tests visuels**:

- [ ] Desktop AVEC description: 3 éléments sur 2 lignes
- [ ] Desktop SANS description: 2 éléments, Participants 100%
- [ ] Mobile: Empilement vertical
- [ ] Icones discrètes (size 18, text-primary/70)
- [ ] Pas de titre principal

**Tests fonctionnels**:

- [ ] Truncation texte long (truncate, line-clamp-2)
- [ ] Ordre: Identité → Notifications
- [ ] Participants: badges compact, gestion du trop-plein

**Critères de succès**:

- Cards regroupées par thématique
- Flex-wrap fonctionne avec/sans description
- Responsive respecté

### Feature 3: HomePage

**Tests flux**:

- [ ] Non-connecté: Voit PwaInstallCard + AuthSection
- [ ] Après connexion: Page se transforme (pas de redirect)
- [ ] identifyModal ne s'ouvre PAS sur homepage
- [ ] identifyModal s'ouvre TOUJOURS sur /p/[token]

**Critères de succès**:

- Plus de modal auto sur homepage
- AuthForm inline fonctionnel
- Transformation page fluide

---

## Points d'attention

1. **PWA Detection**: Utiliser `on()` de Svelte pour cleanup automatique
2. **PocketBase Sync**: Sync seulement si `pb.authStore.isValid`
3. **Flex-wrap**: Participants prend 100% si pas de description
4. **Ordre**: Card 2 = Identité AVANT Notifications
5. **Modal**: Supprimer identifyModal auto SEULEMENT sur homepage

---

## Implémentation

Ordre suggéré (3 jours):

**Jour 1**: PWA Store + PwaInstallCard
**Jour 2**: Cards refactor /p/[token]
**Jour 3**: HomePage refactor + Tests finaux

Voir plan d'implémentation détaillé: `agent/plan/2025-03-15-ui-ux-improvements-plan.md`

---

## Annexes

### Maquettes visuelles

Disponibles dans le compagnon visuel: http://localhost:8765

### Références

- TODO.md: Liste des améliorations UI/UX
- Plan d'implémentation: agent/plan/2025-03-15-ui-ux-improvements-plan.md
- Documentation PWA: Investigations complétées dans TODO.md
