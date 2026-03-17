<script lang="ts">
	import { networkStore } from '$lib/stores/networkStore.svelte';
</script>

{#if !networkStore.online}
	<div
		class="text-error-content fixed right-0 bottom-0 z-50 bg-red-100 px-2 py-1 text-xs font-medium"
	>
		🔴 Hors ligne - Vérifiez votre connexion
	</div>
{:else if !networkStore.realtimeConnected}
	<div
		class="text-error-content fixed right-0 bottom-0 z-50 bg-red-100 px-2 py-1 text-xs font-medium"
	>
		🔴 Serveur indisponible - Réessayez dans un instant
	</div>
{/if}
