<script lang="ts">
	import type { Participant } from '$lib/types/planning.types';
	import { CircleAlert, CircleCheck, InfoIcon, ShieldCheck } from 'lucide-svelte';
	import { slide } from 'svelte/transition';

	interface Props {
		name: string;
		existingParticipants: Participant[];
		currentUserId?: string;
		allowClaimIdentity: boolean; // true = guest (peut revendiquer), false = auth (ID comparé)
		onIdentifyAs: (participant: Participant) => Promise<void>;
		onNetworkError?: () => void;
	}

	let {
		name,
		existingParticipants,
		currentUserId,
		allowClaimIdentity,
		onIdentifyAs,
		onNetworkError
	}: Props = $props();

	// État interne
	let isSubmitting = $state(false);
	let requireLoginFor = $state<Participant | null>(null);
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

	// === Actions ===

	async function attemptIdentifyAs(participant: Participant, retryCount = 0) {
		const RETRY_DELAYS = [300, 600, 1000];
		const MAX_RETRIES = RETRY_DELAYS.length;

		isSubmitting = true;
		networkError = false;
		retryingParticipant = participant;

		try {
			// Vérifier si le participant a un compte protégé
			const res = await fetch(`/api/has-account/${participant.id}`);
			if (!res.ok) throw new Error('Network error');

			const data = await res.json();

			if (data.hasAccount) {
				// Le participant a un compte -> exiger la connexion
				requireLoginFor = participant;
				isSubmitting = false;
				retryingParticipant = null;
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
		requireLoginFor = null;
		networkError = false;
		retryingParticipant = null;
	}

	// Exposer la méthode de reset pour le parent
	export { reset };
</script>

{#if hasConflict && matchedParticipant}
	<div
		class="alert alert-warning alert-soft alert-vertical text-base-content animate-in fade-in slide-in-from-top-2 mt-4 duration-300"
		transition:slide
	>
		<div class="text-warning-content text-sm">
			<CircleAlert size={20} class="me-2 inline shrink-0" />
			Ce nom est déjà utilisé par un·e participant·e sur ce planning.
		</div>

		{#if allowClaimIdentity}
			<!-- Guest : peut revendiquer l'identité -->
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="btn sm:btn-sm btn-warning"
					onclick={() => attemptIdentifyAs(matchedParticipant!)}
					disabled={isSubmitting}
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						C'est moi !
					{/if}
				</button>
			</div>
		{:else}
			<!-- Auth : ID différent, pas de revendication possible -->
			<p class="mt-2 text-xs opacity-80">
				Ce nom est déjà utilisé par un autre participant. Veuillez choisir un nom différent.
			</p>
		{/if}

		<p class="px-2 text-center text-[10px] leading-tight opacity-50">
			{#if allowClaimIdentity}
				Choisissez "C'est moi !" si vous avez déjà participé à ce planning sur un autre appareil ou
				si vous avez effacé vos données. <strong>Sinon, choississez un autre nom</strong>
			{:else}
				En tant qu'utilisateur connecté, votre identité est unique. Si vous pensez qu'il s'agit
				d'une erreur, contactez l'administrateur du planning.
			{/if}
		</p>
	</div>
{:else if !hasConflict && matchedParticipant}
	<!-- Cas où le nom match l'ID actuel (déjà reconnu) -->
	<div class="alert alert-success alert-soft alert-vertical" transition:slide>
		<div class="text-sm font-medium">
			<CircleCheck size={20} class="inline shrink-0" />
			Votre profil et vos plannings sont enregistrés sur cet appareil
		</div>
	</div>
{/if}

{#if existingParticipants.length > 0}
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
						class="btn btn-accent btn-xs"
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

<!-- Connexion requise (compte protégé) -->
{#if requireLoginFor}
	<div class="alert alert-warning alert-soft mt-4 text-sm">
		<ShieldCheck size={20} class="text-warning shrink-0" />
		<div class="leading-tight">
			L'identité de <strong>{requireLoginFor.name}</strong> est protégée par un compte.
		</div>
	</div>
{/if}
