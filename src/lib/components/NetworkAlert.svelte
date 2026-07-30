<script lang="ts">
import { AlertTriangle, RefreshCw } from "@lucide/svelte";
import { slide } from "svelte/transition";
import * as m from "$lib/paraglide/messages.js";
import { networkStore } from "$lib/stores/networkStore.svelte";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import { formatDateTime } from "$lib/utils/date";

interface Props {
	/**
	 * Message personnalisé (optionnel)
	 * @default "Le serveur est indisponible - Modifications impossibles"
	 */
	message?: string;
}

let { message = m.net_server_unavailable() }: Props = $props();

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
	const lastFetchAt = planningStore.lastFetchAtFor(masterId);
	return lastFetchAt ? new Date(lastFetchAt) : null;
});

const freshnessLabel = $derived(
	freshnessDate ? `${m.net_last_sync()} ${formatDateTime(freshnessDate)}` : ""
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
					{freshnessLabel} — {m.net_data_may_be_stale()}
				</div>
			{/if}
		</div>
		{#if showReload}
			<button class="btn btn-ghost btn-sm gap-1" onclick={reload} title={m.net_reload_page_title()}>
				<RefreshCw size={14} />
				{m.net_reload()}
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
