<script lang="ts">
	import type { Participant } from '$lib/types/planning.types';
	import { CircleAlert, InfoIcon } from 'lucide-svelte';
	import { slide } from 'svelte/transition';

	interface Props {
		name: string;
		existingParticipants: Participant[];
		currentIdentityId?: string; // ID du participant courant (exclu de la détection de conflit)
		onIdentifyAs: (participant: Participant) => Promise<void>;
		onRequireLogin?: (participant: Participant) => void; // Appelé quand le participant a un compte
		hideExistingParticipants?: boolean; // Cacher la liste des participants existants
	}

	let {
		name,
		existingParticipants,
		currentIdentityId,
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
					(p) => p.name.toLowerCase() === name.trim().toLowerCase() && p.id !== currentIdentityId
				)
			: null
	);

	let hasConflict = $derived(!!matchedParticipant);

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

{#if hasConflict && matchedParticipant}
	<!-- Conflit : alerte + bouton "C'est moi" pour revendiquer l'identité existante.
	     Le bouton submit du formulaire parent est désactivé tant que le conflit
	     n'est pas résolu (soit revendication, soit changement de nom). -->
	<div
		class="alert alert-warning alert-soft text-base-content animate-in fade-in slide-in-from-top-2 mt-4 duration-300"
		transition:slide
	>
		<CircleAlert size={20} class="shrink-0" />
		<div class="flex-1 text-sm">
			<p class="font-medium">« {matchedParticipant.name} » est déjà utilisé sur ce planning.</p>
			<p class="mt-1 opacity-80">
				Si c'est vous, cliquez sur « C'est moi ». Sinon, choisissez un autre nom.
			</p>
		</div>
		<button
			type="button"
			class="btn btn-primary btn-sm gap-1"
			onclick={() => attemptIdentifyAs(matchedParticipant)}
			disabled={isSubmitting}
		>
			C'est moi
		</button>
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
		</div>
	</div>
{/if}
