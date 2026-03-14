<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import { pb } from '$lib/pocketbase/pb';
	import {
		defaultPlanningPrefs,
		type PlanningParticipantPrefs,
		subscribeToPush,
		unsubscribeFromPush
	} from '$lib/services/push';
	import { getParticipantPrefs, updateParticipantPrefs } from '$lib/services/planningParticipants';
	import { Bell, Mail, Smartphone, Save, LoaderCircle } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		onClose: () => void;
		planningId: string;
	}

	let { open = $bindable(false), onClose, planningId }: Props = $props();

	let prefs = $state<PlanningParticipantPrefs>({
		...defaultPlanningPrefs
	} as PlanningParticipantPrefs);
	let isSaving = $state(false);
	let pushSupported = $state(false);
	let initialPushState = $state(false); // Track l'état initial pour éviter les désinscriptions inutiles

	$effect(() => {
		if (open && pb.authStore.isValid && pb.authStore.record) {
			pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;

			// Charger les préférences par planning
			getParticipantPrefs(planningId, pb.authStore.record.id)
				.then((existing) => {
					if (existing) {
						prefs = { ...defaultPlanningPrefs, ...existing } as PlanningParticipantPrefs;
					} else {
						prefs = { ...defaultPlanningPrefs } as PlanningParticipantPrefs;
					}
					// Stocker l'état initial des push
					initialPushState = prefs.push;
				})
				.catch(() => {
					prefs = { ...defaultPlanningPrefs } as PlanningParticipantPrefs;
					initialPushState = prefs.push;
				});
		}
	});

	async function handleSave() {
		if (!pb.authStore.isValid || !pb.authStore.record) return;

		isSaving = true;
		try {
			// Gestion de la souscription Push
			if (prefs.push && pushSupported) {
				const success = await subscribeToPush(pb.authStore.record.id);
				if (!success) {
					toast.error("Impossible d'activer les notifications push. Vérifiez les permissions.");
					prefs.push = false;
				}
			} else if (!prefs.push && pushSupported && initialPushState) {
				// Désinscrire uniquement si c'était activé au chargement
				await unsubscribeFromPush(pb.authStore.record.id);
			}

			// Mise à jour des préférences par planning dans PocketBase
			await updateParticipantPrefs(planningId, pb.authStore.record.id, prefs);

			toast.success('Préférences sauvegardées');
			onClose();
		} catch (error) {
			console.error('Erreur de sauvegarde', error);
			toast.error('Erreur lors de la sauvegarde');
		} finally {
			isSaving = false;
		}
	}
</script>

<Modal {open} {onClose} title="Préférences de notifications" size="md">
	{#if !pb.authStore.isValid}
		<div class="alert alert-warning alert-soft">
			Vous devez posséder un compte utilisateur pour configurer les notifications.
		</div>
	{:else}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSave();
			}}
			class="space-y-6"
		>
			<!-- Canaux de communication -->
			<div class="space-y-3">
				<h3 class="flex items-center gap-2 text-sm font-bold tracking-widest uppercase opacity-50">
					<Bell size={16} /> Canaux
				</h3>

				<label
					class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
				>
					<input
						type="checkbox"
						bind:checked={prefs.email}
						class="checkbox checkbox-primary checkbox-sm"
					/>
					<div class="flex items-center gap-2">
						<Mail size={18} class="text-base-content/70" />
						<span class="label-text text-sm font-medium">Notifications par email</span>
					</div>
				</label>

				{#if pushSupported}
					<label
						class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
					>
						<input
							type="checkbox"
							bind:checked={prefs.push}
							class="checkbox checkbox-secondary checkbox-sm"
						/>
						<div class="flex items-center gap-2">
							<Smartphone size={18} class="text-base-content/70" />
							<span class="label-text text-sm font-medium">Notifications push sur cet appareil</span
							>
						</div>
					</label>
				{/if}
			</div>

			<!-- Types d'alertes -->
			<div
				class="space-y-4"
				class:opacity-50={!prefs.email && !prefs.push}
				class:pointer-events-none={!prefs.email && !prefs.push}
			>
				<h3 class="text-sm font-bold tracking-widest uppercase opacity-50">
					Ce dont on vous notifie
				</h3>

				<!-- Rappels d'engagements -->
				<div class="bg-base-200 border-base-300 space-y-2 rounded-lg border p-3">
					<label class="label cursor-pointer justify-start gap-3 p-0">
						<input
							type="checkbox"
							checked={prefs.reminderDays > 0}
							onchange={(e) => {
								const target = e.target as HTMLInputElement;
								prefs.reminderDays = target.checked ? 1 : 0;
							}}
							class="checkbox checkbox-sm"
						/>
						<span class="label-text text-sm font-medium"
							>Rappels pour vos participations confirmées</span
						>
					</label>

					{#if prefs.reminderDays > 0}
						<div class="pt-2 pl-8">
							<select
								bind:value={prefs.reminderDays}
								class="select select-bordered select-sm w-full max-w-xs"
							>
								<option value={1}>1 jour avant</option>
								<option value={3}>3 jours avant</option>
								<option value={7}>1 semaine avant</option>
							</select>
						</div>
					{/if}
				</div>

				<!-- Participants manquants -->
				<div class="bg-base-200 border-base-300 space-y-2 rounded-lg border p-3">
					<label class="label cursor-pointer justify-start gap-3 p-0">
						<input
							type="checkbox"
							checked={prefs.missingParticipantsDays > 0}
							onchange={(e) => {
								const target = e.target as HTMLInputElement;
								prefs.missingParticipantsDays = target.checked ? 7 : 0;
							}}
							class="checkbox checkbox-sm"
						/>
						<span class="label-text text-sm font-medium">Alerte s'il manque des participants</span>
					</label>

					{#if prefs.missingParticipantsDays > 0}
						<div class="pt-2 pl-8">
							<select
								bind:value={prefs.missingParticipantsDays}
								class="select select-bordered select-sm w-full max-w-xs"
							>
								<option value={1}>1 jour avant</option>
								<option value={3}>3 jours avant</option>
								<option value={7}>1 semaine avant</option>
								<option value={15}>15 jours avant</option>
								<option value={30}>1 mois avant</option>
							</select>
						</div>
					{/if}
				</div>

				<div class="space-y-1">
					<label class="label cursor-pointer justify-start gap-3 py-1">
						<input type="checkbox" bind:checked={prefs.onTimeChange} class="checkbox checkbox-sm" />
						<span class="label-text text-sm font-medium">Modifications d'horaires et détails</span>
					</label>

					<label class="label cursor-pointer justify-start gap-3 py-1">
						<input
							type="checkbox"
							bind:checked={prefs.onCancellation}
							class="checkbox checkbox-sm"
						/>
						<span class="label-text text-sm font-medium">Annulations d'événements</span>
					</label>
				</div>
			</div>

			<div class="modal-action pt-4">
				<button type="submit" class="btn btn-primary gap-2" disabled={isSaving}>
					{#if isSaving}
						<LoaderCircle class="animate-spin" size={18} />
						Sauvegarde...
					{:else}
						<Save size={18} />
						Enregistrer
					{/if}
				</button>
			</div>
		</form>
	{/if}
</Modal>
