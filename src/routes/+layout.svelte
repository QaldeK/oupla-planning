<script lang="ts">
	import '../app.css';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { pwaStore } from '$lib/stores/pwaStore.svelte';
	import { onMount } from 'svelte';
	import { Toaster, toast } from 'svelte-sonner';
	import { Menu, Calendar, Sun, Moon, CalendarPlus, Github, User, LogOut } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import IdentifyModal from '$lib/components/IdentifyModal.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { Drawer, DrawerOverlay, DrawerContent, DrawerHandle } from '@abhivarde/svelte-drawer';
	import CommentSection from '$lib/components/CommentSection.svelte';
	import NetworkIndicator from '$lib/components/NetworkIndicator.svelte';

	let { children } = $props();

	let drawerOpen = $state(false);
	let theme = $state('my');
	let showConfirmClearPlannings = $state(false);
	let showClearDataConfirm = $state(false);

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
				{#if userStore.savedPlannings.length > 0}
					<a href="/" class="btn btn-neutral w-full justify-start">
						<Calendar size={18} />
						Mes plannings
					</a>
				{/if}
				<a href="/new" class="btn btn-primary w-full justify-start">
					<CalendarPlus size={18} />
					Nouveau planning
				</a>

				<!-- Bouton connexion/inscription (si non connecté) -->
				{#if !userStore.isLoggedIn}
					<button
						class="btn btn-outline w-full justify-start"
						onclick={() => (userStore.authModal = { open: true, mode: 'homepage' })}
					>
						Créer un compte / Se connecter
					</button>
				{/if}

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

					<!-- Bouton oublier (uniquement si non connecté PocketBase) -->
					{#if !userStore.isLoggedIn}
						<button
							class="btn btn-ghost btn-xs btn-block mt-6 opacity-50 hover:opacity-100"
							onclick={() => (showConfirmClearPlannings = true)}
						>
							Oublier les plannings sauvegardés
						</button>
					{/if}
				{/if}
			</nav>

			<!-- Footer -->
			<div class="mt-auto space-y-4 pt-4">
				{#if userStore.globalProfile}
					<div class="flex gap-2">
						<!-- Bouton profil global -->
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
								{:else if !userStore.isLoggedIn && userStore.globalProfile.persist}
									<!-- Remplacer l'email par lien d'effacement -->
									<span
										role="button"
										tabindex="0"
										class="btn-link text-warning h-auto min-h-0 cursor-pointer p-0 text-xs no-underline"
										onclick={() => (showClearDataConfirm = true)}
										onkeydown={(e) => e.key === 'Enter' && (showClearDataConfirm = true)}
									>
										Effacer mes données sur ce navigateur
									</span>
								{/if}
							</div>
						</button>

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
				{:else}
					<button
						class="btn btn-block btn-outline sm:btn-sm"
						onclick={() => (userStore.authModal = { open: true, mode: 'homepage' })}
					>
						S'identifier / Créer un profil
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
	onPlanningIdentify={async (identity, isNewParticipant) => {
		// Appeler le handler enregistré par la page participant
		if (userStore.authModal.onPlanningIdentify) {
			await userStore.authModal.onPlanningIdentify(identity, isNewParticipant);
		}
	}}
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

<Toaster position="bottom-right" />

<NetworkIndicator />

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
