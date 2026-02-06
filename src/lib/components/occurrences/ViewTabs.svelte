<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import type { ViewType } from './index';
	import { LayoutGrid, List } from 'lucide-svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';

	const activeView = $derived(userStore.preferredOccurrenceView);

	function setView(view: ViewType) {
		userStore.setOccurrenceView(view);
	}
</script>

{#if !mediaQuery.isMobile}
	<div role="tablist" class="tabs tabs-boxed tabs-lg bg-base-200 font-semibold">
		<button
			role="tab"
			class="tab gap-2 {activeView === 'card' ? 'tab-active' : ''}"
			onclick={() => setView('card')}
			aria-selected={activeView === 'card'}
		>
			<LayoutGrid size={16} />
			<span class="hidden sm:inline">Cartes</span>
		</button>
		<button
			role="tab"
			class="tab gap-2 {activeView === 'compact' ? 'tab-active' : ''}"
			onclick={() => setView('compact')}
			aria-selected={activeView === 'compact'}
		>
			<List size={16} />
			<span class="hidden sm:inline">Compact</span>
		</button>
	</div>
{/if}
