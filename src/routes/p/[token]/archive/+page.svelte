<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { page } from '$app/state';
	import { Calendar, ArrowLeft, History, Info } from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';
	import OccurrenceView from '$lib/components/occurrences/views/OccurrenceView.svelte';

	const token = page.params.token;

	let master = $derived(planningStore.master);
	let occurrences = $derived(planningStore.occurrences);
	let isLoading = $derived(planningStore.isLoading);
	let currentUserId = $state<string | undefined>(undefined);

	onMount(async () => {
		await planningStore.init(token || '', { dateFilter: 'past' });
		if (master) {
			const identity = userStore.getIdentityForPlanning(master.id);
			currentUserId = identity?.id;
		}
	});

	onDestroy(() => {
		planningStore.cleanup();
	});

	// Nom du participant pour l'affichage (depuis le store local)
	const currentParticipantName = $derived.by(() => {
		if (!master || !currentUserId) return '';
		const p = master.participants.find((p) => p.id === currentUserId);
		return p?.name || '';
	});
</script>

<svelte:head>
	<title>Archives - {master?.title || 'Chargement...'}</title>
</svelte:head>

<div class="bg-base-200 min-h-screen px-4 py-8 sm:px-6 lg:px-8">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<div class="mb-8">
			<a href="/p/{token}" class="btn btn-ghost btn-sm mb-4 gap-2">
				<ArrowLeft size={18} />
				Retour au planning
			</a>

			<div class="flex flex-col justify-between gap-4 md:flex-row md:items-end">
				<div>
					<div class="mb-2 flex items-center gap-3">
						<div class="bg-primary/10 text-primary rounded-xl p-3">
							<History size={32} />
						</div>
						<h1 class="text-3xl font-black tracking-tight">{master?.title || 'Chargement...'}</h1>
					</div>
					<p class="text-base-content/60 font-medium">
						Archives et historique des événements passés
					</p>
				</div>

				{#if currentParticipantName}
					<div class="badge badge-lg badge-outline gap-2 py-4">
						<span class="text-base-content/50">Consulté en tant que :</span>
						<span class="font-bold">{currentParticipantName}</span>
					</div>
				{/if}
			</div>
		</div>

		{#if isLoading}
			<div class="flex flex-col items-center justify-center gap-4 py-20">
				<span class="loading loading-spinner loading-lg text-primary"></span>
				<p class="text-base-content/50 animate-pulse">Chargement de l'historique...</p>
			</div>
		{:else if occurrences.length === 0}
			<div class="card bg-base-100 border-base-200 border shadow-xl">
				<div class="card-body items-center py-16 text-center">
					<div class="bg-base-200 mb-4 rounded-full p-6">
						<Calendar size={48} class="text-base-content/20" />
					</div>
					<h2 class="card-title text-2xl">Aucune archive</h2>
					<p class="text-base-content/60 max-w-sm">
						Il n'y a pas encore d'événements passés pour ce planning.
					</p>
					<div class="card-actions mt-6">
						<a href="/p/{token}" class="btn btn-primary">Voir le planning actuel</a>
					</div>
				</div>
			</div>
		{:else}
			<div class="alert alert-info mb-8 shadow-sm">
				<Info size={20} />
				<span class="text-sm"
					>Les événements passés sont consultables en lecture seule. Vous ne pouvez plus modifier
					vos réponses ou commentaires.</span
				>
			</div>

			<div class="space-y-6">
				{#each occurrences as occurrence (occurrence.id)}
					{#if master}
						<OccurrenceView
							{occurrence}
							{master}
							participants={master.participants}
							{currentUserId}
							isAdmin={false}
							readOnly={true}
						/>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>
