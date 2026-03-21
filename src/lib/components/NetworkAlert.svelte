<script lang="ts">
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import { AlertTriangle } from 'lucide-svelte';

	interface Props {
		/**
		 * Message personnalisé (optionnel)
		 * @default "Le serveur est indisponible - Modifications impossibles"
		 */
		message?: string;
	}

	let { message = 'Le serveur est indisponible - Modifications impossibles' }: Props = $props();

	const isDisabled = $derived(!networkStore.isNetworkOk);
</script>

{#if isDisabled}
	<div class="alert alert-warning mb-4 text-sm">
		<AlertTriangle class="h-6 w-6 shrink-0 stroke-current" />
		<span>{message}</span>
	</div>
{/if}

<style>
	/* S'assurer que l'alerte est visible au-dessus du contenu */
	.alert {
		z-index: 10;
	}
</style>
