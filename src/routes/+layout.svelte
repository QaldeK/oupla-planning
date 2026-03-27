<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import CommentSection from '$lib/components/CommentSection.svelte';
	import AccountBenefitsSidebar from '$lib/components/homepage/AccountBenefitsSidebar.svelte';
	import IdentifyModal from '$lib/components/IdentifyModal.svelte';
	import MobileHeader from '$lib/components/MobileHeader.svelte';
	import NetworkIndicator from '$lib/components/NetworkIndicator.svelte';
	import { realtimeService } from '$lib/services/realtime.svelte';
	import { syncService } from '$lib/services/syncService';
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { modalStore } from '$lib/stores/modalStore.svelte';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { pwaStore } from '$lib/stores/pwaStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { Drawer, DrawerContent, DrawerOverlay } from '@abhivarde/svelte-drawer';
	import { CalendarPlus, Download, Github, LogOut, Moon, Settings, Sun } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-sonner';

	let { children } = $props();

	import { page } from '$app/state';

	// Layout-driven : observer $page.params.token pour activer/désactiver le planning
	$effect(() => {
		const token = page.params.token as string | undefined;

		// Détecter si on est sur la page archive pour passer le bon dateFilter
		const isArchivePage = page.url.pathname.includes('/archive');
		const dateFilter = isArchivePage ? 'past' : 'future';

		planningStore.setActiveToken(token, dateFilter);
	});

	let showAccountModal = $state(false);

	onMount(() => {
		userStore.init();
		mediaQuery.init();
		pwaStore.init();
	});

	// Fermer le drawer des commentaires lors des changements de route
	afterNavigate(() => {
		drawerStore.close();
	});

	$effect(() => {
		// Attendre que init() ait fini de charger savedPlannings depuis le localStorage
		if (!userStore.isReady) return;

		if (!userStore.isLoggedIn) {
			// Reset le flag au logout
			userStore.hasSyncedThisSession = false;
			return;
		}

		// Éviter les appels multiples
		if (userStore.hasSyncedThisSession) return;

		userStore.hasSyncedThisSession = true;

		// Uniquement nettoyer les souscriptions guest, pas le state du planning actif
		// (l'utilisateur peut être sur une page /p/[token] et rester sur cette page)
		realtimeService.unsubscribe();

		// Ordre important : sync → fetch → realtime
		syncService
			.sync(userStore.savedPlannings)
			.then(() => {
				realtimeService.subscribeGlobally();
			})
			.catch((err) => {
				console.error('Layout sync failed:', err);
				// Ne PAS reset le flag ici pour éviter la boucle infinie
				// L'utilisateur pourra réessayer en rechargeant la page
			});
	});

	$effect(() => {
		document.documentElement.setAttribute('data-theme', userStore.appPreferences.theme);
	});

	function toggleTheme() {
		const newTheme = userStore.appPreferences.theme === 'my' ? 'nord-dark' : 'my';
		userStore.setTheme(newTheme);
	}
</script>

<div class="drawer lg:drawer-open min-h-dvh">
	<input
		id="main-drawer"
		type="checkbox"
		class="drawer-toggle"
		checked={modalStore.drawerNavOpen}
		onchange={() => modalStore.toggleNavDrawer()}
	/>
	<div class="drawer-content flex flex-col">
		<!-- Header mobile rétractable -->
		<MobileHeader />

		<!-- Contenu principal -->
		<main class="bg-base-200 flex-1 p-2 md:p-4 lg:p-8">
			{@render children()}
		</main>

		<!-- Footer -->
		<footer class="border-base-300 mt-auto border-t py-4">
			<div class="flex flex-col items-center justify-center gap-4">
				<!-- Bouton d'installation PWA (mobile uniquement) -->
				{#if !pwaStore.isInstalled && pwaStore.canInstall}
					<button
						class="btn btn-soft btn-primary btn-sm lg:hidden"
						onclick={() => pwaStore.install()}
						aria-label="Installer l'application"
					>
						<Download size={16} />
						<span>Installer l'app</span>
					</button>
				{/if}

				<!-- Links existants -->
				<div class="text-base-content/60 flex items-center justify-center gap-2">
					<a
						href="https://github.com/yourusername/yourrepo"
						target="_blank"
						rel="noopener noreferrer"
						class="hover:text-primary flex items-center gap-2 transition"
					>
						<Github size={20} />
					</a>
					<a
						href="https://www.gnu.org/licenses/agpl-3.0.html"
						target="_blank"
						rel="noopener noreferrer"
						class="hover:text-primary transition"
					>
						Open Source - AGPL v3
					</a>
				</div>
			</div>
		</footer>
	</div>

	<!-- Sidebar -->
	<div class="drawer-side">
		<label for="main-drawer" class="drawer-overlay" aria-label="Fermer le menu"></label>
		<aside class="bg-base-300 z-50 flex min-h-dvh w-80 max-w-[85vw] flex-col p-4 pt-14 lg:pt-4">
			<!-- Logo/Titre -->
			<div class="mb-6 flex items-center justify-between">
				<a href="/" class="flex items-center gap-2">
					<img src="/favicon.svg" alt="Oupla planning" class="size-8" />
					<h1 class="text-lg font-bold sm:text-xl">Oupla Planning</h1>
				</a>

				<!-- Toggle thème -->
				<label class="swap swap-rotate btn btn-ghost btn-circle sm:btn-sm">
					<input
						type="checkbox"
						checked={userStore.appPreferences.theme === 'nord-dark'}
						onchange={toggleTheme}
					/>
					<Sun class="swap-off" size={20} />
					<Moon class="swap-on" size={20} />
				</label>
			</div>

			<!-- Navigation -->
			<nav class="mb-4 flex-1 space-y-2">
				<a
					href="/new"
					class="btn btn-primary w-full justify-start"
					onclick={() => modalStore.closeNavDrawer()}
				>
					<CalendarPlus size={18} />
					Nouveau planning
				</a>

				<!-- Plannings sauvegardés - UNIQUEMENT si connecté -->
				{#if userStore.isLoggedIn && userStore.savedPlannings.length > 0}
					<div class="divider"></div>
					<p class="text-base-content/60 px-2 text-sm font-semibold">Plannings sauvegardés</p>
					<div class="space-y-2">
						{#each userStore.savedPlannings as planning (planning.masterId)}
							<button
								class="btn w-full justify-start {planningStore.activeMasterId === planning.masterId
									? 'ring-primary ring-2'
									: ''}"
								onclick={() => {
									modalStore.closeNavDrawer();
									goto(`/p/${planning.participantToken}`);
								}}
							>
								<span class="truncate">{planning.title}</span>
								{#if userStore.hasAdminAccess(planning.masterId)}
									<span class="badge badge-primary badge-xs ms-auto">Admin</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</nav>

			<!-- Footer -->
			<div>
				{#if userStore.isLoggedIn && userStore.pbUser}
					<!-- User authentifié → lien vers /settings + déconnexion -->
					<div class="flex gap-2">
						<button
							onclick={() => {
								modalStore.closeNavDrawer();
								goto('/settings');
							}}
							class="btn btn-accent flex flex-1 items-center justify-start gap-2 text-left"
						>
							<Settings class="size-5 opacity-70" />
							<div class="flex flex-col items-start py-0.5 text-left">
								<div class="text-sm font-medium">{userStore.pbUser.name}</div>
								<div class="text-base-content/60 text-xs">
									{userStore.pbUser.email}
								</div>
							</div>
						</button>

						<button
							class="btn btn-square btn-ghost"
							onclick={() => userStore.logout()}
							aria-label="Se déconnecter"
						>
							<LogOut size={18} />
						</button>
					</div>
				{:else}
					<!-- Guest : Alerte avantages compte + bouton connexion -->
					<div class="flex flex-1 py-4">
						<AccountBenefitsSidebar />
					</div>
					<button
						class="btn btn-outline w-full justify-start"
						onclick={() => (showAccountModal = true)}
					>
						Créer un compte / Se connecter
					</button>
				{/if}
			</div>
		</aside>
	</div>
</div>

<IdentifyModal
	open={userStore.authModal.open}
	masterId={userStore.authModal.masterId}
	existingParticipants={userStore.authModal.existingParticipants || []}
	initialName={userStore.authModal.initialName}
	hideExistingParticipants={userStore.authModal.hideExistingParticipants}
	currentIdentity={userStore.authModal.currentIdentity}
	onClose={() => (userStore.authModal = { ...userStore.authModal, open: false })}
	onPlanningIdentify={userStore.authModal.onPlanningIdentify}
/>

<AccountModal
	bind:open={showAccountModal}
	onClose={() => (showAccountModal = false)}
	onSuccess={() => {
		showAccountModal = false;
	}}
	defaultMode="register"
/>

<Toaster position="bottom-right" />

<NetworkIndicator />

<!-- Drawer Global pour les Commentaires -->
<Drawer bind:open={drawerStore.open} portal={true} direction="right">
	<DrawerOverlay class="fixed bg-black/40" />
	<DrawerContent
		class="bg-base-100 fixed top-0 right-0 bottom-0 z-50 h-dvh w-dvw shadow-2xl sm:w-120 sm:max-w-[85vw]"
	>
		{#if drawerStore.open}
			<CommentSection />
		{/if}
	</DrawerContent>
</Drawer>
