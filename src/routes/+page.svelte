<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { commentStateStore } from '$lib/stores/commentStateStore.svelte';
	import PwaInstallCard from '$lib/components/PwaInstallCard.svelte';
	import AuthSection from '$lib/components/homepage/AuthSection.svelte';

	import { goto } from '$app/navigation';
	import { MessageSquareWarning, Plus, Trash2 } from 'lucide-svelte';

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

	<!-- Saved Plannings List - UNIQUEMENT si connecté -->
	{#if userStore.isLoggedIn && planningStore.activeMasters.length > 0}
		<div class="mt-8">
			<h2 class="mb-4 text-xl font-semibold">Vos plannings</h2>
			<div class="space-y-3">
				{#each planningStore.activeMasters as master (master.id)}
					<button
						class="card bg-base-100 w-full shadow-md transition hover:cursor-pointer hover:shadow-lg"
						onclick={() => navigateToPlanning(master.participantToken!)}
					>
						<div class="card-body">
							<div class="flex items-center justify-between">
								<div class="flex-1 text-left">
									<h3 class="card-title">{master.title}</h3>
									<p class="text-base-content/60 text-sm">
										Dernière modif : {new Date(master.updated).toLocaleDateString('fr-FR')}
									</p>
								</div>
								<div class="flex items-center gap-2">
									{#if commentStateStore.getUnreadCount(master.id) > 0}
										<div class="bg-info/20 rounded-full">
											<MessageSquareWarning size={20} class="p-1 opacity-70" />
										</div>
									{/if}
									{#if master.adminToken}
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
	{#if userStore.isLoggedIn && planningStore.deletedMasters.length > 0}
		<div class="mt-8 opacity-70">
			<h2 class="mb-4 font-semibold">Plannings supprimés</h2>
			<div class="space-y-1">
				{#each planningStore.deletedMasters as master (master.id)}
					<div class="card card-sm bg-base-200 w-full border border-dashed">
						<div class="card-body">
							<div class="flex items-center justify-between">
								<div class="flex-1 text-left">
									<h3 class="card-title line-through opacity-60">{master.title}</h3>
								</div>
								<span class="badge badge-error badge-sm">Supprimé</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
			<button
				class="btn btn-ghost btn-sm mt-2 w-full text-xs"
				onclick={() => planningStore.cleanDeletedPlannings()}
			>
				<Trash2 size={14} />
				Nettoyer les plannings supprimés
			</button>
		</div>
	{/if}
</div>
