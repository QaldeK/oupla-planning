<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import PwaInstallCard from '$lib/components/PwaInstallCard.svelte';
	import AuthSection from '$lib/components/homepage/AuthSection.svelte';

	import { goto } from '$app/navigation';
	import { Plus } from 'lucide-svelte';

	function navigateToPlanning(participantToken: string) {
		goto(`/p/${participantToken}`);
	}
</script>

<svelte:head>
	<title>Mes Plannings</title>
</svelte:head>

<div class="mx-auto max-w-4xl pb-10">
	<!-- Branding (always visible) -->
	<div class="mb-8 flex min-h-[30vh] flex-col items-center justify-center space-y-6 text-center">
		<div class="space-y-4">
			<img src="/logo.svg" class="mx-auto size-48 sm:size-54" alt="Oupla planning" />
			<h1 class="text-6xl font-black">Oupla planning</h1>
			<p class="text-base-content/70 max-w-md text-lg">
				Gérez les présences et les tâches de vos activités récurrentes.
			</p>
		</div>
	</div>

	<!-- Actions rapides -->
	<div class="mb-8 flex justify-center">
		<button onclick={() => goto('/new')} class="btn btn-primary btn-lg gap-3">
			<Plus size={24} />
			Créer un nouveau planning
		</button>
	</div>

	<!-- PWA Installation Card (always visible, handles own display logic) -->
	<PwaInstallCard />

	<!-- Auth Section (only if not authenticated on PocketBase) -->
	{#if !userStore.isLoggedIn}
		<AuthSection />
	{/if}

	<!-- Saved Plannings List (if any) -->
	{#if userStore.savedPlannings.length > 0}
		<!-- Liste des plannings sauvegardés -->
		<div class="mt-8">
			<h2 class="mb-4 text-xl font-semibold">Vos plannings</h2>
			<div class="space-y-3">
				{#each userStore.savedPlannings as planning (planning.masterId)}
					<button
						class="card bg-base-100 w-full shadow-md transition hover:cursor-pointer hover:shadow-lg"
						onclick={() => navigateToPlanning(planning.participantToken)}
					>
						<div class="card-body">
							<div class="flex items-center justify-between">
								<div class="flex-1 text-left">
									<h3 class="card-title">{planning.title}</h3>
									<p class="text-base-content/60 text-sm">
										Dernier accès : {new Date(planning.lastAccessed).toLocaleDateString('fr-FR')}
									</p>
								</div>
								<div class="flex items-center gap-2">
									{#if userStore.hasAdminAccess(planning.masterId)}
										<span class="badge badge-primary">Admin</span>
									{:else}
										<span class="badge badge-secondary">Participant</span>
									{/if}
								</div>
							</div>
						</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
