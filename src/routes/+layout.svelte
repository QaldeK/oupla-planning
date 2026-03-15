<script lang="ts">
	import '../app.css';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-sonner';
	import { Menu, Calendar, Sun, Moon, CalendarPlus, Github } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import IdentifyModal from '$lib/components/IdentifyModal.svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { Drawer, DrawerOverlay, DrawerContent, DrawerHandle } from '@abhivarde/svelte-drawer';
	import CommentSection from '$lib/components/CommentSection.svelte';
	import { getRecurrenceLabel } from '$lib/utils/recurrence';

	let { children } = $props();

	let drawerOpen = $state(false);
	let theme = $state('my');

	onMount(() => {
		userStore.init();
		mediaQuery.init();

		const savedTheme = localStorage.getItem('theme');
		if (savedTheme) {
			theme = savedTheme;
		}

		// Enregistrer le Service Worker pour les notifications push
		if ('serviceWorker' in navigator && import.meta.env.PROD) {
			navigator.serviceWorker
				.register('/service-worker.js')
				.then((reg) => {
					console.log('✅ Service Worker enregistré:', reg.scope);
				})
				.catch((err) => {
					console.error('❌ Erreur enregistrement SW:', err);
				});
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
				<label class="swap swap-rotate btn btn-ghost btn-circle btn-sm">
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
			<div class="mt-auto space-y-4 pt-4">
				{#if userStore.savedPlannings.length > 0}
					<button
						class="btn btn-ghost btn-xs btn-block opacity-50 hover:opacity-100"
						onclick={() => {
							if (
								confirm(
									'Voulez-vous vraiment oublier tous les plannings sauvegardés sur cet appareil ?'
								)
							) {
								userStore.clearSavedPlannings();
							}
						}}
					>
						Oublier les plannings sauvegardés
					</button>
				{/if}

				{#if userStore.isLoggedIn}
					<button class="btn btn-outline btn-block btn-sm mb-2" onclick={() => userStore.logout()}>
						Se déconnecter
					</button>
				{/if}

				{#if userStore.globalProfile}
					<button
						class="btn btn-block btn-accent"
						onclick={() => (userStore.authModal = { open: true, mode: 'edit-global' })}
					>
						<p class="text-sm font-medium">{userStore.globalProfile.defaultName}</p>
						{#if userStore.globalProfile.defaultEmail}
							<p class="text-base-content/60 text-xs">{userStore.globalProfile.defaultEmail}</p>
						{/if}
					</button>
				{:else}
					<button
						class="btn btn-block btn-outline btn-sm"
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

<Toaster position="bottom-right" />

<!-- Drawer Global pour les Commentaires -->
<Drawer bind:open={drawerStore.open} portal={true} direction="right">
	<DrawerOverlay />
	<DrawerContent
		class="bg-base-100 fixed top-0 right-0 bottom-0 z-50 w-120 max-w-[85vw] shadow-2xl"
	>
		<DrawerHandle class="my-4 ml-4" />
		{#if drawerStore.open}
			<CommentSection />
		{/if}
	</DrawerContent>
</Drawer>
