<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import CommentSection from '$lib/components/CommentSection.svelte';
	import AccountBenefitsSidebar from '$lib/components/homepage/AccountBenefitsSidebar.svelte';
	import IdentifyModal from '$lib/components/IdentifyModal.svelte';
	import MobileHeader from '$lib/components/MobileHeader.svelte';
	import NetworkIndicator from '$lib/components/NetworkIndicator.svelte';
	import { commentStateStore } from '$lib/stores/commentStateStore.svelte';
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { modalStore } from '$lib/stores/modalStore.svelte';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { pwaStore } from '$lib/stores/pwaStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { Drawer, DrawerContent, DrawerOverlay } from '@abhivarde/svelte-drawer';
	import {
		CalendarPlus,
		Download,
		Code,
		LogOut,
		MessageSquareWarning,
		Moon,
		Settings,
		Sun,
		Trash2
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { Toaster, toast } from 'svelte-sonner';

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
	let showWelcomeModal = $state(false);

	onMount(() => {
		userStore.init();
		mediaQuery.init();
		pwaStore.init();
		commentStateStore.start();
	});

	// Notification de mise à jour de la PWA (Service Worker en attente d'activation).
	// Toast persistant (duration: Infinity) en top-center ; l'utilisateur déclenche
	// le reload via l'action. L'ID fixe évite tout doublon si l'$effect se rejoue.
	$effect(() => {
		if (!pwaStore.hasUpdate) return;
		toast('Une nouvelle version est disponible.', {
			id: 'sw-update',
			position: 'top-center',
			duration: Infinity,
			action: {
				label: 'Mettre à jour',
				onClick: () => pwaStore.applyUpdate()
			}
		});
	});

	// Ouvrir le modal de bienvenue au premier lancement PWA
	$effect(() => {
		if (
			userStore.isReady &&
			pwaStore.isInstalled &&
			!pwaStore.hasSeenWelcome &&
			!userStore.isLoggedIn
		) {
			showWelcomeModal = true;
			pwaStore.markWelcomeSeen();
		}
	});

	// Fermer le drawer des commentaires lors des changements de route
	afterNavigate(() => {
		drawerStore.close();
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
						href="https://github.com/QaldeK/oupla-planning/"
						target="_blank"
						rel="noopener noreferrer"
						class="hover:text-primary flex items-center gap-2 transition"
					>
						<Code size={20} /> Git -
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
				{#if userStore.isLoggedIn && planningStore.activeMasters.length > 0}
					<div class="divider"></div>
					<p class="text-base-content/60 px-2 text-sm font-semibold">Plannings sauvegardés</p>
					<div class="space-y-2">
						{#each planningStore.activeMasters.filter((m) => !m.participants.some((p) => p.userId === userStore.pbUser?.id && p.hasQuit)) as master (master.id)}
							<button
								class="btn w-full justify-start {planningStore.activeMasterId === master.id
									? 'ring-primary ring-2'
									: ''}"
								onclick={() => {
									modalStore.closeNavDrawer();
									goto(`/p/${master.participantToken}`);
								}}
							>
								<span class="truncate">{master.title}</span>
								<div class="ms-auto flex items-center gap-1">
									{#if commentStateStore.getUnreadCount(master.id) > 0}
										<div class="bg-info/20 rounded-full">
											<MessageSquareWarning size={20} class="p-1 opacity-70" />
										</div>
									{/if}
									{#if master.adminToken}
										<span class="badge badge-primary badge-xs">Admin</span>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
				{#if userStore.isLoggedIn && planningStore.deletedMasters.length > 0}
					<div class="divider"></div>
					<p class="text-base-content/50 px-2 text-sm font-semibold">Supprimés / introuvables</p>
					<div class="space-y-1">
						{#each planningStore.deletedMasters as master (master.id)}
							<button class="btn btn-sm btn-ghost w-full justify-start" disabled>
								<span class="text-base-content/70 truncate line-through">{master.title}</span>
								<span class="badge badge-error badge-soft badge-xs ms-auto">Supprimé</span>
							</button>
						{/each}
					</div>
					<button
						class="btn btn-ghost btn-sm mt-1 w-full text-xs"
						onclick={() => planningStore.cleanDeletedPlannings()}
					>
						<Trash2 size={14} />
						Nettoyer les plannings supprimés
					</button>
				{/if}
			</nav>

			<!-- Footer sidebar -->
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
						class="btn btn-accent w-full justify-start"
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

<AccountModal
	bind:open={showWelcomeModal}
	onClose={() => (showWelcomeModal = false)}
	onSuccess={() => {
		showWelcomeModal = false;
	}}
	defaultMode="register"
	welcomeMode
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
