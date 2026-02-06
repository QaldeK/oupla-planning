<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';

	import { goto } from '$app/navigation';
	import { Calendar, Plus } from 'lucide-svelte';

	function navigateToPlanning(participantToken: string) {
		goto(`/p/${participantToken}`);
	}
</script>

<svelte:head>
	<title>Mes Plannings</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	{#if userStore.savedPlannings.length > 0}
		<div class="mb-8">
			<h1 class="mb-2 text-3xl font-bold">Mes Plannings</h1>
			<p class="text-base-content/70">
				Gérez vos plannings de présence récurrents et partagez-les avec vos participants
			</p>
		</div>

		<!-- Actions rapides -->
		<div class="mb-8 grid gap-4 md:grid-cols-2">
			<a
				href="/new"
				class="card bg-primary text-primary-content shadow-md transition hover:shadow-lg"
			>
				<div class="card-body">
					<div class="flex items-center gap-3">
						<Plus size={32} />
						<div>
							<h2 class="card-title">Créer un planning</h2>
							<p class="text-sm opacity-90">Nouveau planning de présence récurrent</p>
						</div>
					</div>
				</div>
			</a>

			<div class="card bg-base-200 shadow-md">
				<div class="card-body">
					<div class="flex items-center gap-3">
						<Calendar size={32} />
						<div>
							<h2 class="card-title">Plannings sauvegardés</h2>
							<p class="text-base-content/70 text-sm">
								{userStore.savedPlannings.length} planning{userStore.savedPlannings.length > 1
									? 's'
									: ''}
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Liste des plannings sauvegardés -->
		<div>
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
	{:else}
		<div class="flex min-h-[60vh] flex-col items-center justify-center space-y-8 text-center">
			<div class="space-y-4">
				<Calendar size={80} class="text-primary/20 mx-auto" />
				<h1 class="text-4xl font-black">Organisez vos événements</h1>
				<p class="text-base-content/70 max-w-md text-lg">
					La solution simple et sans compte pour gérer les présences et les tâches de vos activités
					récurrentes.
				</p>
			</div>

			<div class="flex flex-col gap-4 sm:flex-row">
				<a href="/new" class="btn btn-primary btn-lg gap-3">
					<Plus size={24} />
					Créer un nouveau planning
				</a>
			</div>
		</div>
	{/if}
</div>
