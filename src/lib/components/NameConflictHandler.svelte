<script lang="ts">
	import type { Participant } from '$lib/types/planning.types';
	import { pb } from '$lib/pocketbase/pb';
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
		onNetworkError?: () => void;
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
		onNetworkError,
		hideExistingParticipants = false
	}: Props = $props();

	// État interne
	let isSubmitting = $state(false);
	let networkError = $state(false);
	let retryingParticipant = $state<Participant | null>(null);

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

	async function attemptIdentifyAs(participant: Participant, retryCount = 0) {
		const RETRY_DELAYS = [300, 600, 1000];
		const MAX_RETRIES = RETRY_DELAYS.length;

		isSubmitting = true;
		networkError = false;
		retryingParticipant = participant;

		try {
			// Vérifier si le participant a un compte protégé via PocketBase
			const data = await pb.send(`/api/has-account/${participant.id}`, { requestKey: null });

			if (data.hasAccount) {
				// Le participant a un compte -> notifier le parent pour afficher le login
				isSubmitting = false;
				retryingParticipant = null;
				onRequireLogin?.(participant);
			} else {
				// Pas de compte -> identification directe
				await onIdentifyAs(participant);
			}
		} catch (err) {
			if (retryCount < MAX_RETRIES) {
				// Retry automatique avec délai progressif
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[retryCount]));
				return attemptIdentifyAs(participant, retryCount + 1);
			} else {
				// Échec après tous les retries -> afficher erreur
				networkError = true;
				isSubmitting = false;
				onNetworkError?.();
			}
		}
	}

	function reset() {
		networkError = false;
		retryingParticipant = null;
	}

	// Exposer la méthode de reset pour le parent
	export { reset };
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
						class="btn btn-accent btn-xs {matchedParticipant?.id === p.id ? 'btn-primary ' : ''}"
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

<!-- Erreur réseau -->
{#if networkError && retryingParticipant}
	<div class="alert alert-error alert-soft alert-vertical mt-4" transition:slide>
		<div class="text-sm">
			<CircleAlert size={20} class="me-2 inline shrink-0" />
			Impossible de vérifier l'identité. Vérifiez votre connexion.
		</div>
		<button
			type="button"
			class="btn btn-error btn-sm"
			onclick={() => attemptIdentifyAs(retryingParticipant!)}
		>
			Réessayer
		</button>
	</div>
{/if}
