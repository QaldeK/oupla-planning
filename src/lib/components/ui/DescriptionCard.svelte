<script lang="ts">
	import { Drawer, DrawerContent, DrawerOverlay } from '@abhivarde/svelte-drawer';
	import { ChevronDown, ChevronUp, X } from 'lucide-svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';

	interface Props {
		/** Texte à afficher. Vide → le composant ne rend rien. */
		text: string;
		/** Nombre de lignes visibles en mode replié. */
		collapsedLines?: number;
		class?: string;
	}

	let { text, collapsedLines = 1, class: className = '' }: Props = $props();

	let isExpanded = $state(false);
	let isDrawerOpen = $state(false);
	let isClippable = $state(false);
	let contentEl = $state<HTMLElement>();

	// Style line-clamp appliqué uniquement en mode replié. Style inline car
	// collapsedLines est dynamique (les utilitaires line-clamp-N ne conviennent pas).
	const clampStyle = $derived(
		isExpanded
			? ''
			: `display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:${collapsedLines};`
	);

	function measure() {
		const el = contentEl;
		// Mesurer uniquement en mode replié : en mode déplié scrollHeight ≈ clientHeight,
		// ce qui masquerait à tort l'indicateur « Réduire ».
		if (!el || isExpanded) return;
		isClippable = el.scrollHeight - el.clientHeight > 1;
	}

	// Détecte la capacité de repli via ResizeObserver (texte, largeur, police…).
	function clampMeasurable(node: HTMLElement) {
		contentEl = node;
		measure();
		const ro = new ResizeObserver(() => measure());
		ro.observe(node);
		return {
			destroy() {
				ro.disconnect();
				contentEl = undefined;
			}
		};
	}

	// Réinitialiser l'état déplié quand le contenu change (occurrence suivante,
	// édition, sync realtime).
	$effect(() => {
		void text;
		void collapsedLines;
		isExpanded = false;
	});

	// Au repli, re-mesurer une fois le clamp ré-appliqué.
	$effect(() => {
		if (!isExpanded) queueMicrotask(measure);
	});

	function toggle() {
		if (mediaQuery.isMobile) {
			isDrawerOpen = true;
		} else {
			isExpanded = !isExpanded;
		}
	}
</script>

{#if text}
	{#snippet body()}
		<span class="flex items-start gap-2">
			<span
				class="text-base-content/80 min-w-0 flex-1 text-sm whitespace-pre-line"
				style={clampStyle}
				use:clampMeasurable
			>
				{text}
			</span>
			{#if isClippable}
				<span
					class="text-primary mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-xs font-medium"
				>
					{#if mediaQuery.isMobile}
						Lire la suite
						<ChevronDown size={14} />
					{:else if isExpanded}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
				</span>
			{/if}
		</span>
	{/snippet}

	{#if isClippable}
		<button
			type="button"
			class="border-neutral/20 bg-base-300/60 hover:bg-base-300/80 w-full cursor-pointer border-0 border-s-4 px-3 py-2 text-left transition-colors {className}"
			aria-expanded={isExpanded}
			aria-label={mediaQuery.isMobile
				? 'Ouvrir la description complète'
				: isExpanded
					? 'Réduire la description'
					: 'Afficher toute la description'}
			onclick={toggle}
		>
			{@render body()}
		</button>
	{:else}
		<div class="border-neutral/20 bg-base-300/60 border-s-4 px-3 py-2 {className}">
			{@render body()}
		</div>
	{/if}
{/if}

{#if isDrawerOpen}
	<Drawer bind:open={isDrawerOpen} portal={true} direction="bottom" closeOnEscape={true}>
		<DrawerOverlay class="fixed bg-black/40" />
		<DrawerContent
			class="bg-base-100 fixed top-50 right-0 bottom-0 z-50 flex w-dvw flex-col shadow-2xl sm:w-120 sm:max-w-[85vw]"
		>
			<div class="border-base-300 flex items-center justify-between border-b px-4 py-3">
				<h3 class="text-base font-semibold">Description</h3>
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-sm"
					onclick={() => (isDrawerOpen = false)}
					aria-label="Fermer"
				>
					<X size={20} />
				</button>
			</div>
			<div class="flex-1 overflow-y-auto p-4">
				<p class="text-base-content/80 text-sm whitespace-pre-line">{text}</p>
			</div>
		</DrawerContent>
	</Drawer>
{/if}
