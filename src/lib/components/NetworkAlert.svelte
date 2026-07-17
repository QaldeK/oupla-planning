<script lang="ts">
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { formatDate } from '$lib/utils/date';
	import { AlertTriangle, RefreshCw } from '@lucide/svelte';
	import { slide } from 'svelte/transition';

	interface Props {
		/**
		 * Message personnalisé (optionnel)
		 * @default "Le serveur est indisponible - Modifications impossibles"
		 */
		message?: string;
	}

	let { message = 'Le serveur est indisponible - Modifications impossibles' }: Props = $props();

	const isDisabled = $derived(!networkStore.isNetworkOk);

	// Serveur indispo (vs hors-ligne pur) : un reload peut aider à retrouver la connexion.
	const showReload = $derived(
		networkStore.online && networkStore.hasActiveSubscription && !networkStore.realtimeConnected
	);

	// Fraîcheur des données affichées : global auth (lastAuthSyncAt) ou per-master guest (lastFetchAt).
	const freshnessDate = $derived.by(() => {
		if (userStore.isLoggedIn) return userStore.lastAuthSyncAt;
		const masterId = planningStore.activeMasterId;
		if (!masterId) return null;
		const saved = userStore.savedPlannings.find((p) => p.masterId === masterId);
		return saved?.lastFetchAt ? new Date(saved.lastFetchAt) : null;
	});

	const freshnessLabel = $derived(
		freshnessDate ? `Dernière sync : ${formatDate(freshnessDate, "d MMM 'à' HH:mm")}` : ''
	);

	function reload() {
		window.location.reload();
	}
</script>

{#if isDisabled}
	<div class="alert alert-warning m-4 text-sm" transition:slide>
		<AlertTriangle class="h-6 w-6 shrink-0 stroke-current" />
		<div class="flex-1">
			<span>{message}</span>
			{#if freshnessLabel}
				<div class="text-xs opacity-80">
					{freshnessLabel} — les données affichées sont peut-être obsolètes.
				</div>
			{/if}
		</div>
		{#if showReload}
			<button class="btn btn-ghost btn-sm gap-1" onclick={reload} title="Recharger la page">
				<RefreshCw size={14} />
				Recharger
			</button>
		{/if}
	</div>
{/if}

<style>
	/* S'assurer que l'alerte est visible au-dessus du contenu */
	.alert {
		z-index: 10;
	}
</style>
