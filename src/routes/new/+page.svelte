<script lang="ts">
	import PlanningForm, { type PlanningFormData } from '$lib/components/PlanningForm.svelte';
	import {
		createPlanningWithOccurrences,
		generateAdminToken,
		generateParticipantToken
	} from '$lib/services/planningActions';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { toast } from 'svelte-sonner';
	import { Calendar } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import type { Participant } from '$lib/types/planning.types';

	let isSubmitting = $state(false);

	async function handleCreatePlanning(data: PlanningFormData) {
		try {
			// IMPORTANT: Générer les tokens localement avant l'appel API
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			// Préparer les participants : ajouter le créateur s'il a un profil global
			let participants: Participant[] = [];
			if (userStore.globalProfile) {
				participants = [
					{
						id: userStore.globalProfile.id,
						name: userStore.globalProfile.defaultName,
						email: userStore.globalProfile.defaultEmail,
						isAdmin: true, // Le créateur est admin
						notifyOnMissingParticipants: false,
						createdAt: new Date().toISOString()
					}
				];
			}

			// Créer le planning master et toutes les occurrences en une seule opération batch
			const master = await createPlanningWithOccurrences(
				{ ...data, participants },
				adminToken,
				participantToken
			);

			// Sauvegarder dans le localStorage
			await userStore.savePlanning({
				masterId: master.id,
				title: master.title,
				adminToken: adminToken,
				participantToken: participantToken,
				lastAccessed: new Date().toISOString(),
				persist: true
			});

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

<div class="mx-auto max-w-4xl px-4 py-8">
	<div class="mb-12 flex items-center gap-4">
		<div class="bg-primary/10 inline-flex rounded-full p-4">
			<Calendar size={28} class="text-primary" />
		</div>
		<h1 class=" text-lg font-bold sm:text-2xl">Création d'un planning</h1>
		<!-- <p class="text-base-content/60 mx-auto max-w-xl text-lg">
			Configurez la récurrentes, définissez des tâches,
		</p> -->
	</div>

	<div class="bg-base-200/30 rounded-3xl p-1">
		<PlanningForm onSubmit={handleCreatePlanning} bind:isSubmitting />
	</div>
</div>
