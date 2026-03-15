<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import PlanningForm, { type PlanningFormData } from '$lib/components/PlanningForm.svelte';
	import { updatePlanningWithOccurrences } from '$lib/services/planningActions';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { onDestroy, onMount } from 'svelte';

	import { ArrowLeft, Calendar } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let token = $state('');
	let master = $derived(planningStore.master);
	let occurrences = $derived(planningStore.occurrences);
	let isLoading = $derived(planningStore.isLoading);
	let isSubmitting = $state(false);

	// eslint-disable-next-line @typescript-eslint/no-unused-vars

	onMount(async () => {
		token = $page.params.token as string;
		const result = await planningStore.init(token);

		if (result && !result.isAdmin) {
			const adminTokenInStorage = userStore.getAdminToken(result.master.id);
			if (adminTokenInStorage) {
				await goto(`/p/${adminTokenInStorage}`);
			} else {
				await goto(`/p/${token}`);
			}
		}
	});

	onDestroy(() => {
		planningStore.cleanup();
	});

	async function handleUpdatePlanning(data: PlanningFormData) {
		if (!master) return;

		try {
			isSubmitting = true;
			const updatedMaster = await updatePlanningWithOccurrences(
				master.id,
				data,
				token,
				master.participantToken as string
			);
			planningStore.setMaster(updatedMaster);
			toast.success('Planning mis à jour avec succès');

			// Rediriger vers la vue participant après sauvegarde réussie
			await goto(`/p/${master.participantToken}`);
		} catch (error) {
			console.error('Update error:', error);
			toast.error('Erreur lors de la mise à jour');
		} finally {
			isSubmitting = false;
		}
	}

	// Identifier les dates qui ont des données (réponses ou commentaires)
	const datesWithData = $derived(
		occurrences
			.filter((o) => o.responses?.length > 0 || o.comments?.length > 0)
			.map((o) => o.date.split(' ')[0].split('T')[0])
	);

	// Identifier les dates qui ont des tâches spécifiques (non héritées)
	const datesWithSpecificTasks = $derived(
		occurrences
			.filter((o) => o.tasks && o.tasks.length > 0)
			.map((o) => o.date.split(' ')[0].split('T')[0])
	);
</script>

<svelte:head>
	<title>{master?.title || 'Planning'} - Admin</title>
</svelte:head>

{#if isLoading}
	<div class="flex min-h-[50vh] items-center justify-center">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if master}
	<div class="mx-auto max-w-6xl py-2 md:px-4 md:py-8">
		<div class="mb-4 flex justify-start">
			<a href="/p/{master.participantToken}" class="btn btn-ghost sm:btn-sm gap-2">
				<ArrowLeft size={18} />
				Retour au planning
			</a>
		</div>
		<!-- Contenu principal (Formulaire uniquement) -->
		<div class="mx-auto max-w-4xl">
			<div class="mb-8">
				<h3 class="mb-2 text-center text-2xl sm:font-semibold">
					Configuration {'de ' + master?.title || 'du Planning'}
				</h3>
				<p class="text-base-content/50 text-center text-sm">
					Modifiez les paramètres du planning. Les changements seront propagés aux occurrences.
				</p>
			</div>
			<PlanningForm
				{master}
				onSubmit={handleUpdatePlanning}
				bind:isSubmitting
				{datesWithData}
				{datesWithSpecificTasks}
			/>
		</div>
	</div>
{:else}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div
				class="bg-error/10 text-error mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full p-4"
			>
				<Calendar size={40} />
			</div>
			<h2 class="mb-3 text-3xl font-semibold">Introuvable</h2>
			<p class="text-base-content/60 mb-8">
				Le lien admin est invalide ou le planning a été supprimé.
			</p>
			<a href="/" class="btn btn-primary btn-wide">Retour à l'accueil</a>
		</div>
	</div>
{/if}
