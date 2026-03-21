<script lang="ts">
	import { goto } from '$app/navigation';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import CommentSection from '$lib/components/CommentSection.svelte';
	import IdentifyModal from '$lib/components/IdentifyModal.svelte';
	import MobileHeader from '$lib/components/MobileHeader.svelte';
	import NetworkIndicator from '$lib/components/NetworkIndicator.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import { realtimeService } from '$lib/services/realtime.svelte';
	import { syncService } from '$lib/services/syncService';
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { pwaStore } from '$lib/stores/pwaStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { Drawer, DrawerContent, DrawerHandle, DrawerOverlay } from '@abhivarde/svelte-drawer';
	import { CalendarPlus, Download, Github, LogOut, Menu, Moon, Sun, User } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { Toaster, toast } from 'svelte-sonner';

	let { children } = $props();

	let drawerOpen = $state(false);
	let theme = $state('my');
	let showConfirmClearPlannings = $state(false);
	let showClearDataConfirm = $state(false);
	let showAccountModal = $state(false);

	onMount(() => {
		userStore.init();
		mediaQuery.init();
		pwaStore.init();

		const savedTheme = localStorage.getItem('theme');
		if (savedTheme) {
			theme = savedTheme;
		}
	});

	$effect(() => {
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
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem('theme', theme);
	});

	function toggleTheme() {
		theme = theme === 'my' ? 'nord-dark' : 'my';
	}

	async function handleGlobalProfileCreate(name: string, email?: string, persist = true) {
		await userStore.createGlobalProfile(name, email, persist);
		userStore.authModal.open = false;
	}

	async function handleGlobalProfileUpdate(name: string, email?: string, persist = true) {
		await userStore.updateGlobalProfile({ defaultName: name, defaultEmail: email }, persist);
		userStore.authModal.open = false;
	}

	async function handleClearData() {
		try {
			await userStore.clearUser();
			showClearDataConfirm = false;
			toast.success('Données effacées de cet appareil');
		} catch (error) {
			toast.error("Erreur lors de l'effacement des données");
		}
	}
</script>

<div class="drawer lg:drawer-open min-h-screen">
	<input id="main-drawer" type="checkbox" class="drawer-toggle" bind:checked={drawerOpen} />
	<div class="drawer-content flex flex-col">
		<!-- Header mobile rétractable -->
		<MobileHeader />

		<!-- Navbar -->
		<div class="navbar bg-base-200 lg:hidden">
			<div class="flex-none">
				<label for="main-drawer" class="btn btn-square btn-ghost" aria-label="Ouvrir le menu">
					<Menu size={24} />
				</label>
			</div>
			<div class="flex-1">
				<a href="/" class="btn btn-ghost text-xl">Planning</a>
			</div>
		</div>

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
		<aside class="bg-base-300 flex min-h-full w-80 flex-col p-4">
			<!-- Logo/Titre -->
			<div class="mb-6 flex items-center justify-between">
				<a href="/" class="flex items-center gap-2">
					<img src="/favicon.svg" alt="Oupla planning" class="size-8" />
					<h1 class="text-lg font-bold sm:text-xl">Oupla Planning</h1>
				</a>
				<label class="swap swap-rotate btn btn-ghost btn-circle sm:btn-sm">
					<input type="checkbox" checked={theme === 'nord-dark'} onchange={toggleTheme} />
					<Sun class="swap-off" size={20} />
					<Moon class="swap-on" size={20} />
				</label>
			</div>

			<!-- Navigation -->
			<nav class="flex-1 space-y-2">
				<a href="/new" class="btn btn-primary w-full justify-start">
					<CalendarPlus size={18} />
					Nouveau planning
				</a>

				<!-- Plannings sauvegardés -->
				{#if userStore.savedPlannings.length > 0}
					<div class="divider"></div>
					<p class="text-base-content/60 px-2 text-sm font-semibold">Plannings sauvegardés</p>
					<div class="space-y-2">
						{#each userStore.savedPlannings as planning (planning.masterId)}
							<button
								class="btn w-full justify-start"
								onclick={() => goto(`/p/${planning.participantToken}`)}
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
			<div class="mt-auto">
				{#if userStore.globalProfile}
					<div class="flex gap-2">
						<!-- Bouton profil global -->
						{#if userStore.isLoggedIn}
							<!-- User authentifié → lien vers /settings -->
							<a
								href="/settings"
								class="btn btn-accent flex flex-1 items-center justify-start gap-2 text-left"
							>
								<User class="size-5 opacity-70" />
								<div class="flex flex-col items-start py-0.5 text-left">
									<div class="text-sm font-medium">{userStore.globalProfile.defaultName}</div>
									{#if userStore.globalProfile.defaultEmail}
										<div class="text-base-content/60 text-xs">
											{userStore.globalProfile.defaultEmail}
										</div>
									{/if}
								</div>
							</a>
						{:else}
							<!-- Guest → ouvre IdentifyModal pour modifier le profil local -->
							<button
								class="btn btn-accent flex flex-1 items-center justify-start gap-2 text-left"
								onclick={() => (userStore.authModal = { open: true, mode: 'edit-global' })}
							>
								<User class="size-5 opacity-70" />
								<div class="flex flex-col items-start py-0.5 text-left">
									<div class="text-sm font-medium">{userStore.globalProfile.defaultName}</div>
									{#if userStore.globalProfile.defaultEmail}
										<div class="text-base-content/60 text-xs">
											{userStore.globalProfile.defaultEmail}
										</div>
									{/if}
								</div>
							</button>
						{/if}

						<!-- Bouton déconnexion (si connecté ET persist) -->
						{#if userStore.isLoggedIn && userStore.globalProfile.persist}
							<button
								class="btn btn-square btn-ghost"
								onclick={() => userStore.logout()}
								aria-label="Se déconnecter"
							>
								<LogOut size={18} />
							</button>
						{/if}
					</div>
					{#if !userStore.isLoggedIn && userStore.globalProfile.persist}
						<!-- lien d'effacement -->

						<div class="text-end">
							<button
								tabindex="0"
								class="btn-link btn btn-sm text-accent-content/60 h-auto min-h-0 self-end"
								onclick={() => (showClearDataConfirm = true)}
								onkeydown={(e) => e.key === 'Enter' && (showClearDataConfirm = true)}
							>
								Effacer mes données sur ce navigateur
							</button>
						</div>
					{/if}
				{:else if !userStore.isLoggedIn}
					<!-- Bouton connexion/inscription (si non connecté) -->
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
	mode={userStore.authModal.mode}
	existingParticipants={userStore.authModal.existingParticipants || []}
	onClose={() => (userStore.authModal = { ...userStore.authModal, open: false })}
	onGlobalProfileCreate={handleGlobalProfileCreate}
	onGlobalProfileUpdate={handleGlobalProfileUpdate}
/>

<ConfirmModal
	bind:open={showConfirmClearPlannings}
	onClose={() => (showConfirmClearPlannings = false)}
	onConfirm={async () => {
		await userStore.clearSavedPlannings();
		showConfirmClearPlannings = false;
	}}
	title="Effacer les plannings sauvegardés ?"
	message="Voulez-vous vraiment oublier tous les plannings sauvegardés sur cet appareil ?"
	description="Cette action est irréversible. Vous devrez utiliser les liens des plannings pour y accéder à nouveau."
	confirmLabel="Effacer tout"
	variant="danger"
/>

<ConfirmModal
	bind:open={showClearDataConfirm}
	onClose={() => (showClearDataConfirm = false)}
	onConfirm={handleClearData}
	title="Effacer vos données ?"
	message="Voulez-vous vraiment effacer toutes vos données sur cet appareil ?"
	description="Cela supprimera votre profil et la liste de vos plannings enregistrés localement. Vos participations sur les plannings eux-mêmes ne seront pas supprimées."
	confirmLabel="Effacer tout"
	variant="danger"
/>

<AccountModal
	bind:open={showAccountModal}
	onClose={() => (showAccountModal = false)}
	onSuccess={() => {
		// Après création/connexion du compte, ouvrir le modal de notifications
		showAccountModal = false;
	}}
	defaultMode="register"
/>

<Toaster position="bottom-right" />

{#if userStore.isLoggedIn}
	<NetworkIndicator />
{/if}

<!-- Drawer Global pour les Commentaires -->
<Drawer bind:open={drawerStore.open} portal={true} direction="right">
	<DrawerOverlay />
	<DrawerContent
		class="bg-base-100 fixed top-0 right-0 bottom-0 z-50 h-dvh w-120 max-w-[85vw] shadow-2xl"
	>
		<DrawerHandle class="my-4 ml-4" />
		{#if drawerStore.open}
			<div class="h-full pb-6"><CommentSection /></div>
		{/if}
	</DrawerContent>
</Drawer>
