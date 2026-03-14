<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import { pb } from '$lib/pocketbase/pb';
	import { defaultNotifSub, updateNotifPrefs, subscribeToPush, unsubscribeFromPush, type NotificationsSubscription } from '$lib/services/push';
	import { Bell, Mail, Smartphone, Save, LoaderCircle } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	let prefs = $state<NotificationsSubscription>({ ...defaultNotifSub });
	let isSaving = $state(false);
	let pushSupported = $state(false);

	$effect(() => {
		if (open) {
			pushSupported = ('serviceWorker' in navigator) && ('PushManager' in window);
			
			if (pb.authStore.isValid && pb.authStore.model) {
				const userPrefs = pb.authStore.model.notificationsSubscription;
				if (userPrefs) {
					prefs = { ...defaultNotifSub, ...userPrefs };
				}
			}
		}
	});

	async function handleSave() {
		if (!pb.authStore.isValid || !pb.authStore.model) return;

		isSaving = true;
		try {
			// Gestion de la souscription Push
			if (prefs.push && pushSupported) {
				const success = await subscribeToPush(pb.authStore.model.id);
				if (!success) {
					toast.error("Impossible d'activer les notifications push. Vérifiez les permissions.");
					prefs.push = false;
				}
			} else if (!prefs.push && pushSupported) {
				await unsubscribeFromPush(pb.authStore.model.id);
			}

			// Mise à jour des préférences dans PocketBase
			await updateNotifPrefs(pb.authStore.model.id, prefs);
			
			// Mettre à jour le store local (pb.authStore.model se met à jour automatiquement via la réponse de l'API dans push.ts si mis à jour, sinon on le refetch ici)
			const updatedUser = await pb.collection('users').getOne(pb.authStore.model.id);
			pb.authStore.save(pb.authStore.token, updatedUser);

			toast.success('Préférences sauvegardées');
			onClose();
		} catch (error) {
			console.error("Erreur de sauvegarde", error);
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
		<form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="space-y-6">
			
			<!-- Canaux de communication -->
			<div class="space-y-3">
				<h3 class="text-sm font-bold tracking-widest uppercase opacity-50 flex items-center gap-2">
					<Bell size={16} /> Canaux
				</h3>
				
				<label class="label cursor-pointer justify-start gap-3 p-3 bg-base-200 rounded-lg border border-base-300">
					<input
						type="checkbox"
						bind:checked={prefs.email}
						class="checkbox checkbox-primary checkbox-sm"
					/>
					<div class="flex items-center gap-2">
						<Mail size={18} class="text-base-content/70" />
						<span class="label-text font-medium text-sm">Notifications par email</span>
					</div>
				</label>
				
				{#if pushSupported}
					<label class="label cursor-pointer justify-start gap-3 p-3 bg-base-200 rounded-lg border border-base-300">
						<input
							type="checkbox"
							bind:checked={prefs.push}
							class="checkbox checkbox-secondary checkbox-sm"
						/>
						<div class="flex items-center gap-2">
							<Smartphone size={18} class="text-base-content/70" />
							<span class="label-text font-medium text-sm">Notifications push sur cet appareil</span>
						</div>
					</label>
				{/if}
			</div>

			<!-- Types d'alertes -->
			<div class="space-y-4" class:opacity-50={!prefs.email && !prefs.push} class:pointer-events-none={!prefs.email && !prefs.push}>
				<h3 class="text-sm font-bold tracking-widest uppercase opacity-50">Ce dont on vous notifie</h3>
				
				<!-- Rappels d'engagements -->
				<div class="p-3 bg-base-200 rounded-lg border border-base-300 space-y-2">
					<label class="label cursor-pointer justify-start gap-3 p-0">
						<input
							type="checkbox"
							checked={prefs.reminderDays > 0}
							onchange={(e) => prefs.reminderDays = typeof e.target?.checked === 'boolean' && e.target.checked ? 1 : 0}
							class="checkbox checkbox-sm"
						/>
						<span class="label-text font-medium text-sm">Rappels pour vos participations confirmées</span>
					</label>
					
					{#if prefs.reminderDays > 0}
						<div class="pl-8 pt-2">
							<select bind:value={prefs.reminderDays} class="select select-bordered select-sm w-full max-w-xs">
								<option value={1}>1 jour avant</option>
								<option value={3}>3 jours avant</option>
								<option value={7}>1 semaine avant</option>
							</select>
						</div>
					{/if}
				</div>

				<!-- Participants manquants -->
				<div class="p-3 bg-base-200 rounded-lg border border-base-300 space-y-2">
					<label class="label cursor-pointer justify-start gap-3 p-0">
						<input
							type="checkbox"
							checked={prefs.missingParticipantsDays > 0}
							onchange={(e) => prefs.missingParticipantsDays = typeof e.target?.checked === 'boolean' && e.target.checked ? 7 : 0}
							class="checkbox checkbox-sm"
						/>
						<span class="label-text font-medium text-sm">Alerte s'il manque des participants</span>
					</label>
					
					{#if prefs.missingParticipantsDays > 0}
						<div class="pl-8 pt-2">
							<select bind:value={prefs.missingParticipantsDays} class="select select-bordered select-sm w-full max-w-xs">
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
						<input
							type="checkbox"
							bind:checked={prefs.onTimeChange}
							class="checkbox checkbox-sm"
						/>
						<span class="label-text font-medium text-sm">Modifications d'horaires et détails</span>
					</label>

					<label class="label cursor-pointer justify-start gap-3 py-1">
						<input
							type="checkbox"
							bind:checked={prefs.onCancellation}
							class="checkbox checkbox-sm"
						/>
						<span class="label-text font-medium text-sm">Annulations d'événements</span>
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
