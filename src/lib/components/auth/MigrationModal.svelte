<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import { Check, X, LoaderCircle } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		localId: string; // globalProfile.id actuel
		remoteId: string; // pb.authStore.record.id
		onClose?: () => void;
		onSuccess?: () => void;
	}

	let { open, localId, remoteId, onClose, onSuccess }: Props = $props();

	// Plannings à migrer (ceux où currentUser.id === localId)
	let planningsToMigrate = $derived(
		userStore.savedPlannings.filter((p) => p.currentUser?.id === localId)
	);

	// État de sélection (initialisé via $effect pour réagir aux changements)
	let selectedIds = $state<Set<string>>(new Set());
	let isProcessing = $state(false);
	let errors = $state<Map<string, string>>(new Map());

	// Initialiser la sélection quand planningsToMigrate change
	$effect(() => {
		selectedIds = new Set(planningsToMigrate.map((p) => p.masterId));
	});

	function toggleSelection(masterId: string) {
		if (selectedIds.has(masterId)) {
			selectedIds.delete(masterId);
		} else {
			selectedIds.add(masterId);
		}
		// Force reactivity
		selectedIds = new Set(selectedIds);
	}

	function toggleAll() {
		if (selectedIds.size === planningsToMigrate.length) {
			selectedIds.clear();
		} else {
			selectedIds = new Set(planningsToMigrate.map((p) => p.masterId));
		}
	}

	async function handleConfirm() {
		isProcessing = true;
		errors.clear();

		const migrations = Array.from(selectedIds).map((masterId) => ({
			masterId,
			oldId: localId,
			newId: remoteId
		}));

		try {
			const result = await userStore.migrateParticipantIds(migrations);

			// Gérer les résultats
			let successCount = 0;
			let errorCount = 0;

			for (const [masterId, status] of Object.entries(result.results)) {
				if (status.success) {
					successCount++;
					// Mettre à jour le currentUser local en cas de succès
					const planning = userStore.savedPlannings.find((p) => p.masterId === masterId);
					if (planning && planning.currentUser) {
						planning.currentUser.id = remoteId;
					}
				} else {
					errorCount++;
					errors.set(masterId, status.error || 'Erreur inconnue');
					// Marquer l'erreur dans savedPlanning pour retry ultérieur
					userStore.updateMigrationStatus(masterId, status.error || 'Erreur inconnue');
				}
			}

			// Sauvegarder les changements locaux
			await userStore.savePlanningsLocal();

			if (errorCount === 0) {
				toast.success(`${successCount} planning(s) migré(s) avec succès !`);
				// Mettre à jour globalProfile.id
				await userStore.updateGlobalProfile({ id: remoteId });
				if (onSuccess) onSuccess();
			} else if (successCount === 0) {
				toast.error(`La migration a échoué pour tous les plannings.`);
			} else {
				toast.error(`${successCount} réussi(s), ${errorCount} échec(s). Vérifiez les erreurs.`);
			}

			// Fermer si tout est bon
			if (errorCount === 0) {
				open = false;
			}
		} catch (err) {
			console.error('Migration error:', err);
			toast.error('Erreur lors de la migration : ' + (err as Error).message);
		} finally {
			isProcessing = false;
		}
	}

	function handleCancel() {
		open = false;
		if (onClose) onClose();
	}
</script>

{#if open}
	<div class="modal modal-open">
		<div class="modal-box max-w-2xl">
			<h3 class="text-lg font-bold">Migrer vos plannings vers votre compte ?</h3>

			<p class="py-2 text-sm opacity-70">
				Nous avons détecté que vous vous connectez avec un compte existant. Vos participations
				locales peuvent être migrées vers ce compte pour être accessibles depuis tous vos appareils.
			</p>

			{#if planningsToMigrate.length > 0}
				<div class="form-control">
					<label class="label cursor-pointer">
						<span class="label-text font-semibold">
							Tout sélectionner ({planningsToMigrate.length})
						</span>
						<input
							type="checkbox"
							class="checkbox checkbox-primary"
							checked={selectedIds.size === planningsToMigrate.length}
							onchange={toggleAll}
						/>
					</label>
				</div>

				<div class="divider"></div>

				<div class="max-h-96 space-y-2 overflow-y-auto">
					{#each planningsToMigrate as planning (planning.masterId)}
						{@const isSelected = selectedIds.has(planning.masterId)}
						{@const hasError = errors.has(planning.masterId)}

						<div class="card card-compact bg-base-200 {hasError ? 'ring-error ring-1' : ''}">
							<div class="card-body p-3">
								<div class="flex items-center gap-3">
									<input
										type="checkbox"
										class="checkbox checkbox-sm"
										checked={isSelected}
										onchange={() => toggleSelection(planning.masterId)}
										disabled={isProcessing}
									/>
									<div class="min-w-0 flex-1">
										<div class="truncate font-medium">{planning.title}</div>
										<div class="truncate text-xs opacity-60">
											Participant : {planning.currentUser?.name || 'Anonyme'}
										</div>
										{#if hasError}
											<div class="text-error mt-1 text-xs">{errors.get(planning.masterId)}</div>
										{/if}
									</div>
									{#if hasError}
										<X class="text-error shrink-0" size={20} />
									{:else if isSelected && !isProcessing}
										<Check class="text-success shrink-0" size={20} />
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>

				<div class="modal-action">
					<button class="btn btn-ghost" onclick={handleCancel} disabled={isProcessing}>
						Non, conserver les comptes séparés
					</button>
					<button
						class="btn btn-primary"
						onclick={handleConfirm}
						disabled={isProcessing || selectedIds.size === 0}
					>
						{#if isProcessing}
							<LoaderCircle class="animate-spin" size={18} />
							Migration...
						{:else}
							Migrer {selectedIds.size === planningsToMigrate.length
								? 'tous'
								: selectedIds.toString()} planning(s)
						{/if}
					</button>
				</div>
			{:else}
				<p class="py-4">Aucun planning à migrer.</p>
				<div class="modal-action">
					<button class="btn btn-primary" onclick={handleCancel}>Continuer</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
