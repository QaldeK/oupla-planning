<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import type { ViewType } from './index';
	import { LayoutGrid, List, Minimize2 } from '@lucide/svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';

	const activeView = $derived(userStore.appPreferences.occurrenceView);

	// Options disponibles par device
	const mobileViews: ViewType[] = ['compact', 'minimal'];
	const desktopViews: ViewType[] = ['card', 'compact', 'minimal'];
	const availableViews = $derived(mediaQuery.isMobile ? mobileViews : desktopViews);

	function setView(view: ViewType) {
		userStore.setOccurrenceView(view);
	}

	function getLabel(view: ViewType): string {
		if (view === 'card') return 'Cartes';
		if (view === 'compact') return 'Compact';
		return 'Minimal';
	}

	function getIcon(view: ViewType) {
		if (view === 'card') return LayoutGrid;
		if (view === 'compact') return List;
		return Minimize2;
	}
</script>

<div role="tablist" class="tabs tabs-boxed tabs-lg bg-base-200 font-semibold">
	{#each availableViews as view (view)}
		{@const Icon = getIcon(view)}
		<button
			role="tab"
			class="tab gap-2 {activeView === view ? 'tab-active' : ''}"
			onclick={() => setView(view)}
			aria-selected={activeView === view}
		>
			<Icon size={18} />
			<span class="hidden sm:inline">{getLabel(view)}</span>
		</button>
	{/each}
</div>
