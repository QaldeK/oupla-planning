<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import PlanningForm, { type PlanningFormData } from '$lib/components/PlanningForm.svelte';
	import { AdminSkeleton } from '$lib/components/ui/skeletons';
	import { updatePlanningWithOccurrences } from '$lib/services/planningActions';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import { fade } from 'svelte/transition';

	import QuitReturnModal from '$lib/components/QuitReturnModal.svelte';
	import { ArrowLeft, Calendar, CalendarCog, RefreshCw, Trash2, WifiOff } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let token = $derived($page.params.token as string);
	let master = $derived(planningStore.master);
	let occurrences = $derived(planningStore.occurrences);
	let isLoading = $derived(planningStore.isLoading);
	let isSubmitting = $state(false);

	// === Détection retour après quit ===
	let showQuitReturnModal = $state(false);

	const quitParticipantId = $derived.by(() => {
		if (!master) return null;
		if (userStore.isLoggedIn && userStore.pbUser) {
			return (
				master.participants.find((p) => p.userId === userStore.pbUser!.id && p.hasQuit)?.id ?? null
			);
		}
		const sp = userStore.savedPlannings.find((p) => p.masterId === master.id);
		if (sp?.hasQuit && sp?.currentUser) {
			return master.participants.find((p) => p.id === sp.currentUser!.id && p.hasQuit)?.id ?? null;
		}
		return null;
	});
	const hasQuitThisPlanning = $derived(quitParticipantId !== null);

	// Logique de redirection admin → participant
	$effect(() => {
		if (!master) return;

		// PRIORITÉ : retour après quit
		if (hasQuitThisPlanning) {
			if (!showQuitReturnModal) showQuitReturnModal = true;
			return;
		}

		// Si l'utilisateur n'a pas les droits admin sur ce planning, rediriger
		if (!planningStore.hasAdminAccess(master.id)) {
			goto(`/p/${master.participantToken}`);
		}
	});

	async function handleUpdatePlanning(data: PlanningFormData) {
		if (!master) return;

		try {
			isSubmitting = true;
			const updatedMaster = await updatePlanningWithOccurrences(
				master.id,
				data,
				token,
				master.participantToken as string,
				master.updated // Optimistic locking
			);
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
	<AdminSkeleton />
{:else if master}
	<div class="mx-auto max-w-6xl py-2 md:px-4 md:py-8" in:fade={{ duration: 300 }}>
		<div class="mb-4 flex justify-start">
			<a href="/p/{master.participantToken}" class="btn btn-ghost sm:btn-sm gap-2">
				<ArrowLeft size={18} />
				Retour au planning
			</a>
		</div>
		<!-- Contenu principal (Formulaire uniquement) -->
		<div class="mb-6 flex flex-1 items-center gap-5">
			<div class="bg-primary/10 self-start rounded-2xl p-2 sm:p-4">
				<CalendarCog class="text-primary size-7 sm:size-6" />
			</div>
			<div class="flex-1 space-y-1">
				<h3 class="font-semibold sm:text-xl">
					Configuration {'de ' + master?.title || 'du Planning'}
				</h3>
				<p class="text-base-content/50 text-sm">
					Modifiez les paramètres du planning. Les changements seront propagés aux occurrences.
				</p>
			</div>
		</div>
		{#key master.updated}
			<PlanningForm
				{master}
				onSubmit={handleUpdatePlanning}
				bind:isSubmitting
				{datesWithData}
				{datesWithSpecificTasks}
			/>
		{/key}
	</div>
{:else if !networkStore.online}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div class="alert alert-error alert-soft">
				<WifiOff size={24} />
				<div>
					<h3 class="font-bold">Connexion impossible</h3>
					<div class="text-xs">
						<p>Vous êtes hors ligne. Vérifiez votre connexion internet.</p>
					</div>
				</div>
			</div>
			<button class="btn btn-outline mt-4 gap-2" onclick={() => window.location.reload()}>
				<RefreshCw size={16} />
				Réessayer
			</button>
		</div>
	</div>
{:else if planningStore.error?.type === 'network'}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div class="alert alert-error alert-soft">
				<WifiOff size={24} />
				<div>
					<h3 class="font-bold">Connexion impossible</h3>
					<div class="text-xs">
						<p>Le serveur est inaccessible. Réessayez dans quelques instants.</p>
					</div>
				</div>
			</div>
			<button class="btn btn-outline mt-4 gap-2" onclick={() => window.location.reload()}>
				<RefreshCw size={16} />
				Réessayer
			</button>
		</div>
	</div>
{:else if planningStore.error?.type === 'deleted'}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div
				class="bg-warning/10 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full p-4"
			>
				<Trash2 size={40} class="text-warning" />
			</div>
			<h2 class="mb-3 text-3xl font-semibold">Planning supprimé</h2>
			<p class="text-base-content/60 mb-8">Ce planning a été supprimé par son administrateur.</p>
			<a href="/" class="btn btn-primary btn-wide">Retour à l'accueil</a>
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

{#if master && quitParticipantId}
	<QuitReturnModal
		bind:open={showQuitReturnModal}
		onClose={() => (showQuitReturnModal = false)}
		{master}
		{token}
		quitParticipantId={quitParticipantId!}
		onRejoined={() => (showQuitReturnModal = false)}
	/>
{/if}
