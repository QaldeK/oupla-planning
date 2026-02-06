<script lang="ts">
	import PlanningForm, { type PlanningFormData } from '$lib/components/PlanningForm.svelte';
	import {
		createPlanning,
		createOccurrence,
		generateAdminToken,
		generateParticipantToken
	} from '$lib/services/planningActions';
	import { generateRecurrenceDates } from '$lib/utils/recurrence';
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

			// Créer le planning master avec les tokens générés et les participants
			const master = await createPlanning({ ...data, participants }, adminToken, participantToken);

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

			// Générer les dates de récurrence (utiliser les dates sélectionnées si présentes)
			const dates = data.recurrence.recurrenceDates || generateRecurrenceDates(data.recurrence);

			// Créer les occurrences de manière asynchrone
			const occurrencePromises = dates.map((date) =>
				createOccurrence(
					{
						masterId: master.id,
						date,
						startTime: data.defaultStartTime,
						endTime: data.defaultEndTime
					},
					adminToken,
					participantToken
				).catch((err) => {
					console.error(`Erreur création occurrence pour ${date}:`, err);
				})
			);

			// Attendre toutes les créations
			await Promise.all(occurrencePromises);

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
	<div class="mb-12 text-center">
		<div class="bg-primary/10 mb-6 inline-flex rounded-full p-4">
			<Calendar size={48} class="text-primary" />
		</div>
		<h1 class="mb-3 text-4xl font-black">Créer un nouveau planning</h1>
		<p class="text-base-content/60 mx-auto max-w-xl text-lg">
			Configurez vos disponibilités récurrentes et facilitez l'organisation de vos événements
		</p>
	</div>

	<div class="bg-base-200/30 rounded-3xl p-1">
		<PlanningForm onSubmit={handleCreatePlanning} bind:isSubmitting />
	</div>
</div>
