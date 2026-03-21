<script lang="ts">
	import type { Participant, PlanningIdentity } from '$lib/types/planning.types';
	import { userStore } from '$lib/stores/userStore.svelte';
	import Modal from './ui/Modal.svelte';
	import NameConflictHandler from './NameConflictHandler.svelte';
	import { User, ArrowRight } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		onClose: () => void;
		masterId: string;
		existingParticipants: Participant[];
		currentIdentity: PlanningIdentity;
		onPlanningIdentify: (identity: PlanningIdentity, isNewParticipant: boolean) => Promise<void>;
	}

	let {
		open = $bindable(false),
		onClose,
		masterId,
		existingParticipants,
		currentIdentity,
		onPlanningIdentify
	}: Props = $props();

	// État du formulaire
	let name = $state('');
	let email = $state('');
	let isSubmitting = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);

	// Initialiser les champs à l'ouverture
	$effect(() => {
		if (open) {
			name = currentIdentity.name;
			email = currentIdentity.email || '';
			// Focus auto
			setTimeout(() => inputRef?.focus(), 50);
		}
	});

	// Identité finale à enregistrer (toujours avec l'ID du globalProfile)
	let finalIdentity = $derived<PlanningIdentity>({
		id: userStore.globalProfile?.id || currentIdentity.id,
		name: name.trim(),
		email: email.trim() || undefined
	});

	// Détection locale de conflit (même logique que NameConflictHandler)
	let matchedParticipant = $derived(
		name.trim()
			? existingParticipants.find(
					(p) =>
						p.name.toLowerCase() === name.trim().toLowerCase() &&
						p.id !== (userStore.globalProfile?.id || currentIdentity.id)
				)
			: null
	);

	let hasConflict = $derived(!!matchedParticipant);

	// Gestion de l'identification via NameConflictHandler
	async function handleIdentifyAs(participant: Participant) {
		isSubmitting = true;
		try {
			// Utiliser l'ID du participant existant
			const identity: PlanningIdentity = {
				id: participant.id,
				name: participant.name,
				email: participant.email
			};

			// Ne PAS modifier le globalProfile
			await onPlanningIdentify(identity, false);
			onClose();
		} catch (error) {
			console.error('Error identifying as existing participant:', error);
			toast.error("Erreur lors de l'identification");
		} finally {
			isSubmitting = false;
		}
	}

	async function handleSubmit() {
		if (!name.trim() || isSubmitting) return;

		// Si conflit détecté, ne pas soumettre
		if (hasConflict) return;

		isSubmitting = true;
		try {
			// Vérifier si c'est une mise à jour (nom inchangé) ou nouveau nom
			const isUpdate = currentIdentity.name === name.trim();

			await onPlanningIdentify(finalIdentity, !isUpdate);

			if (isUpdate) {
				toast.success('Nom mis à jour pour ce planning');
			} else {
				toast.success(`Vous participerez sous le nom "${name.trim()}"`);
			}

			onClose();
		} catch (error) {
			console.error('Error updating planning name:', error);
			toast.error('Erreur lors de la mise à jour');
		} finally {
			isSubmitting = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && name.trim() && !hasConflict) {
			handleSubmit();
		}
	}
</script>

<Modal {open} {onClose} title="Nom pour ce planning" size="md">
	<div class="space-y-6">
		<p class="text-sm opacity-80">
			Ce nom sera utilisé uniquement pour ce planning. Il ne modifie pas votre profil global.
		</p>

		<form onsubmit={(e) => e.preventDefault()} class="space-y-5">
			<fieldset>
				<label class="input w-full" class:input-error={hasConflict}>
					<span class="label">
						<User size={18} class="opacity-40" />
						Nom *
					</span>
					<input
						bind:this={inputRef}
						type="text"
						bind:value={name}
						class="grow"
						placeholder="Votre nom ou pseudo pour ce planning"
						required
						disabled={isSubmitting}
						onkeydown={handleKeyDown}
					/>
				</label>
			</fieldset>

			<!-- Gestion des conflits via le composant partagé -->
			<NameConflictHandler
				{name}
				{existingParticipants}
				currentUserId={userStore.globalProfile?.id}
				allowClaimIdentity={!userStore.isLoggedIn}
				onIdentifyAs={handleIdentifyAs}
			/>

			<div class="modal-action mt-8">
				<button
					type="button"
					class="btn btn-primary btn-block gap-2"
					onclick={handleSubmit}
					disabled={isSubmitting || !name.trim() || hasConflict}
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
						Traitement...
					{:else}
						Enregistrer
						<ArrowRight size={18} />
					{/if}
				</button>
			</div>
		</form>
	</div>
</Modal>
