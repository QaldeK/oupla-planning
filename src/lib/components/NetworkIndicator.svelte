<script lang="ts">
import { RefreshCw } from "@lucide/svelte";
import * as m from "$lib/paraglide/messages.js";
import { networkStore } from "$lib/stores/networkStore.svelte";

const isServerUnavailable = $derived(
	networkStore.online && networkStore.hasActiveSubscription && !networkStore.realtimeConnected
);

function reload() {
	window.location.reload();
}
</script>

{#if !networkStore.online}
	<div
		class="text-error-content fixed right-0 bottom-0 z-50 bg-red-100 px-2 py-1 text-xs font-medium"
	>
		🔴 {m.net_offline()}
	</div>
{:else if isServerUnavailable}
	<div
		class="text-error-content fixed right-0 bottom-0 z-50 flex items-center gap-2 bg-red-100 px-2 py-1 text-xs font-medium"
	>
		<span>🔴 {m.net_server_unavailable()}</span>
		<button class="btn btn-ghost btn-xs gap-1" onclick={reload} title={m.net_reload_page_title()}>
			<RefreshCw size={12} />
			{m.net_reload()}
		</button>
	</div>
{/if}
