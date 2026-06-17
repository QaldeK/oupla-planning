<script lang="ts">
	import type { Participant } from '$lib/types/planning.types';
	import { CircleAlert, InfoIcon } from 'lucide-svelte';
	import { slide } from 'svelte/transition';

	interface Props {
		name: string;
		initialName?: string; // Nom prérempli (pour savoir si l'utilisateur a modifié)
		existingParticipants: Participant[];
		currentUserId?: string;
		allowClaimIdentity: boolean; // true = guest (peut revendiquer), false = auth (ID comparé)
		onIdentifyAs: (participant: Participant) => Promise<void>;
		onRequireLogin?: (participant: Participant) => void; // Appelé quand le participant a un compte (avec le participant)
		hideExistingParticipants?: boolean; // Cacher la liste des participants existants
	}

	let {
		name,
		initialName,
		existingParticipants,
		currentUserId,
		allowClaimIdentity,
		onIdentifyAs,
		onRequireLogin,
		hideExistingParticipants = false
	}: Props = $props();

	// État interne
	let isSubmitting = $state(false);

	// === Détection de conflit ===

	let matchedParticipant = $derived(
		name.trim()
			? existingParticipants.find(
					(p) => p.name.toLowerCase() === name.trim().toLowerCase() && p.id !== currentUserId
				)
			: null
	);

	let hasConflict = $derived(!!matchedParticipant);

	// Le nom a-t-il été modifié par rapport à la valeur initiale ?
	let nameHasChanged = $derived(
		!initialName || name.trim().toLowerCase() !== initialName.trim().toLowerCase()
	);

	// === Actions ===

	async function attemptIdentifyAs(participant: Participant) {
		// Vérification locale : participant déjà lié à un compte (userId posé).
		// Remplace l'appel réseau /api/has-account désormais obsolète : celui-ci
		// ne détectait pas les participants claimés dont l'id ≠ userId (un guest
		// revendiqué garde son UUID original tout en recevant un userId).
		if (participant.userId) {
			onRequireLogin?.(participant);
			return;
		}

		// Pas de compte -> identification directe.
		// Les erreurs réseau sont gérées par le parent (IdentifyModal.handleIdentifyAs).
		isSubmitting = true;
		try {
			await onIdentifyAs(participant);
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if hasConflict && matchedParticipant && !allowClaimIdentity}
	<!-- Auth uniquement : alerte sans possibilité de revendication -->
	<div
		class="alert alert-warning alert-soft text-base-content animate-in fade-in slide-in-from-top-2 mt-4 duration-300"
		transition:slide
	>
		<CircleAlert size={20} class="shrink-0" />
		<div class="text-sm">
			Ce nom est déjà utilisé par un autre participant. Veuillez choisir un nom différent.
		</div>
	</div>
{/if}

{#if existingParticipants.length > 0 && !hideExistingParticipants}
	<div class="card card-xs bg-accent/20 mt-4">
		<div class="card-body">
			<span class="text-accent-content/70 flex items-center gap-1 text-sm italic">
				<InfoIcon class="inline size-4 shrink-0 opacity-80" />
				Vous avez déjà participé à ce planning ? Indiquez qui vous êtes :
			</span>
			<div class="flex max-h-40 flex-wrap gap-2 overflow-y-auto p-1">
				{#each existingParticipants as p (p.id)}
					<button
						type="button"
						class="btn btn-accent btn-sm {matchedParticipant?.id === p.id ? 'btn-primary ' : ''}"
						onclick={() => attemptIdentifyAs(p)}
						disabled={isSubmitting}
					>
						{p.name}
					</button>
				{/each}
			</div>
			<!-- Message contextuel si le nom a changé et qu'il y a un match -->
			{#if hasConflict && matchedParticipant && nameHasChanged}
				<p class="text-accent-content/80 mt-2 text-center text-xs italic">
					Ce nom est déjà utilisé sur ce planning. Cliquez sur <strong>continuer</strong>
					si c'est vous, ou modifiez votre nom.
				</p>
			{/if}
		</div>
	</div>
{/if}
