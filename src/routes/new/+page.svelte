<script lang="ts">
	import PlanningForm, { type PlanningFormData } from '$lib/components/PlanningForm.svelte';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import {
		createPlanningWithOccurrences,
		generateAdminToken,
		generateParticipantToken
	} from '$lib/services/planningActions';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { toast } from 'svelte-sonner';
	import { Calendar, UserPlus } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { syncService } from '$lib/services/syncService';
	import type { Participant } from '$lib/types/planning.types';
	import { pb } from '$lib/pocketbase/pb';

	let isSubmitting = $state(false);
	let showAccountModal = $state(false);

	async function handleCreatePlanning(data: PlanningFormData) {
		try {
			// IMPORTANT: Générer les tokens localement avant l'appel API
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			// Préparer les participants : ajouter le créateur s'il est connecté
			let participants: Participant[] = [];
			if (userStore.pbUser) {
				participants = [
					{
						id: userStore.pbUser.id,
						name: userStore.pbUser.name,
						isAdmin: true, // Le créateur est admin
						createdAt: new Date().toISOString()
					}
				];
			}

			// Créer le planning master et toutes les occurrences en une seule opération batch
			await createPlanningWithOccurrences({ ...data, participants }, adminToken, participantToken);

			// Peupler adminOf + masterId sur le user auth
			if (userStore.isLoggedIn) {
				pb.send('/api/claim-admin', {
					method: 'POST',
					body: { token: adminToken }
				})
					.then(() => pb.collection('users').authRefresh())
					.catch(() => {});
			}

			// Déclencher la synchronisation (lit les tokens depuis db.masters)
			await syncService.sync();

			toast.success('Planning créé avec succès !');

			// Rediriger vers la vue participant
			goto(`/p/${participantToken}`);
		} catch (error) {
			console.error('Error creating planning:', error);
			toast.error('Erreur lors de la création du planning');
		}
	}
</script>

<svelte:head>
	<title>Nouveau Planning</title>
</svelte:head>

<div class="mx-auto max-w-4xl sm:px-4 sm:py-8">
	<div class="mb-6 flex items-center gap-4 sm:mb-12">
		<div class="bg-primary/10 inline-flex rounded-full p-4">
			<Calendar size={28} class="text-primary" />
		</div>
		<h1 class=" text-lg font-bold sm:text-2xl">Création d'un planning</h1>
		<!-- <p class="text-base-content/60 mx-auto max-w-xl text-lg">
			Configurez la récurrentes, définissez des tâches,
		</p> -->
	</div>

	{#if !userStore.isLoggedIn}
		<div class="alert alert-info alert-soft mb-6">
			<UserPlus size={18} class="text-info shrink-0" />
			<span class="text-sm">
				Créez un compte pour retrouver vos plannings partout et ne jamais les perdre.
			</span>
			<button class="btn btn-info btn-sm" onclick={() => (showAccountModal = true)}>
				Créer un compte
			</button>
		</div>
	{/if}

	<div class="bg-base-200/30 rounded-3xl p-1">
		<PlanningForm onSubmit={handleCreatePlanning} bind:isSubmitting />
	</div>
</div>

<AccountModal
	bind:open={showAccountModal}
	onClose={() => (showAccountModal = false)}
	onSuccess={() => {
		showAccountModal = false;
	}}
	defaultMode="register"
/>
