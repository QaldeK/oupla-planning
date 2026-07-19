<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import { pb } from '$lib/pocketbase/pb';
	import {
		getDefaultPlanningPrefs,
		subscribeToPush,
		unsubscribeFromPush,
		type PlanningParticipantPrefs
	} from '$lib/services/push';
	import { getParticipantPrefs, updateParticipantPrefs } from '$lib/services/planningParticipants';
	import type { RecurrenceType } from '$lib/types/planning.types';
	import { Bell, Mail, Smartphone, Save, LoaderCircle, ShieldAlert } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { untrack } from 'svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		planningId: string;
		recurrenceType: RecurrenceType;
		isAdmin: boolean;
	}

	let { open = $bindable(false), onClose, planningId, recurrenceType, isAdmin }: Props = $props();

	// Placeholder initial : les vraies prefs sont chargées dans le $effect ci-dessous
	// à l'ouverture du modal (selon le recurrenceType courant et l'état en DB).
	let prefs = $state<PlanningParticipantPrefs>({
		push: false,
		email: true,
		onOccurrenceChange: true,
		onConfirmationNeeded: false,
		reminderDays: [],
		missingDays: []
	});
	let isSaving = $state(false);
	let pushSupported = $state(false);
	let initialPushState = $state(false); // Track l'état initial pour éviter les désinscriptions inutiles

	const reminderOptions: Array<{ value: '1' | '3' | '7'; label: string }> = [
		{ value: '1', label: '1 jour avant' },
		{ value: '3', label: '3 jours avant' },
		{ value: '7', label: '1 semaine avant' }
	];

	const missingOptions: Array<{ value: '1' | '3' | '7' | '15'; label: string }> = [
		{ value: '1', label: '1 jour avant' },
		{ value: '3', label: '3 jours avant' },
		{ value: '7', label: '1 semaine avant' },
		{ value: '15', label: '15 jours avant' }
	];

	$effect(() => {
		if (!open) return;

		untrack(() => {
			if (!pb.authStore.isValid || !pb.authStore.record) return;

			pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;

			// Charger les préférences par planning, fusionnées avec les defaults liés
			// au `recurrenceType` du master (rappels / missings J-X) pour les champs
			// éventuellement absents du record existant.
			getParticipantPrefs(planningId, pb.authStore.record.id)
				.then((existing) => {
					prefs = {
						...getDefaultPlanningPrefs(recurrenceType),
						...(existing as Partial<PlanningParticipantPrefs>)
					};
					initialPushState = prefs.push;
				})
				.catch(() => {
					prefs = getDefaultPlanningPrefs(recurrenceType);
					initialPushState = prefs.push;
				});
		});
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

			await updateParticipantPrefs(planningId, pb.authStore.record.id, prefs, recurrenceType);

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
			<fieldset class="fieldset">
				<legend class="fieldset-legend flex items-center gap-2">
					<Bell size={16} /> Canaux
				</legend>

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
			</fieldset>

			<!-- Événements notifiables -->
			<fieldset
				class={['fieldset', !prefs.email && !prefs.push && 'pointer-events-none opacity-50']}
			>
				<legend class="fieldset-legend">Ce dont on vous notifie</legend>

				<!-- Modifs d'occurrence (toggle unique : heure / lieu / détails / annulation) -->
				<label
					class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
				>
					<input
						type="checkbox"
						bind:checked={prefs.onOccurrenceChange}
						class="checkbox checkbox-sm"
					/>
					<span class="label-text text-sm font-medium">
						Modifications d'horaires, lieu, détails et annulations
					</span>
				</label>

				<!-- Rappels (multi-select via checkboxes bind:group) -->
				<div class="bg-base-200 border-base-300 space-y-2 rounded-lg border p-3">
					<p class="label-text text-sm font-medium">Rappels avant vos participations</p>
					<p class="text-xs opacity-60">Cochez les moments auxquels recevoir un rappel.</p>
					<div class="flex flex-wrap gap-x-4 gap-y-2 pt-1 pl-1">
						{#each reminderOptions as opt (opt.value)}
							<label class="label cursor-pointer justify-start gap-2 p-0">
								<input
									type="checkbox"
									bind:group={prefs.reminderDays}
									value={opt.value}
									class="checkbox checkbox-sm checkbox-primary"
								/>
								<span class="label-text text-sm">{opt.label}</span>
							</label>
						{/each}
					</div>
				</div>

				<!-- Missings (tous les participants non-absents sont destinataires) -->
				<div class="bg-base-200 border-base-300 space-y-2 rounded-lg border p-3">
					<p class="label-text text-sm font-medium">Alertes participants manquants</p>
					<p class="text-xs opacity-60">Pour anticiper les sessions sous-effectif.</p>
					<div class="flex flex-wrap gap-x-4 gap-y-2 pt-1 pl-1">
						{#each missingOptions as opt (opt.value)}
							<label class="label cursor-pointer justify-start gap-2 p-0">
								<input
									type="checkbox"
									bind:group={prefs.missingDays}
									value={opt.value}
									class="checkbox checkbox-sm checkbox-warning"
								/>
								<span class="label-text text-sm">{opt.label}</span>
							</label>
						{/each}
					</div>
				</div>
			</fieldset>

			<!-- Section admin -->
			{#if isAdmin}
				<fieldset
					class={['fieldset', !prefs.email && !prefs.push && 'pointer-events-none opacity-50']}
				>
					<legend class="fieldset-legend flex items-center gap-2">
						<ShieldAlert size={16} /> Administration
					</legend>

					<label
						class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
					>
						<input
							type="checkbox"
							bind:checked={prefs.onConfirmationNeeded}
							class="checkbox checkbox-warning checkbox-sm"
						/>
						<div class="space-y-0.5">
							<p class="label-text text-sm font-medium">
								Événements non confirmés à l'approche de la date
							</p>
							<p class="text-xs opacity-60">
								Recevez une alerte pour confirmer ou non les événements confirmables qui arrivent.
							</p>
						</div>
					</label>
				</fieldset>
			{/if}

			<div class="modal-action pt-2">
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
