<script lang="ts">
	import { X, ArrowLeft, Save } from 'lucide-svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte.js';

	interface Props {
		open: boolean;
		onClose: () => void;
		title?: string;
		children: import('svelte').Snippet;
		actions?: import('svelte').Snippet;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		zIndex?: number;
		/**
		 * Si false, masque le bouton de fermeture (X / ArrowLeft) et
		 * désactive la fermeture par Escape et par clic sur le backdrop.
		 * Utilisé pour les modals qui exigent un choix explicite de l'utilisateur.
		 */
		closable?: boolean;
	}

	let {
		open = $bindable(false),
		onClose,
		title,
		children,
		actions,
		size = 'md',
		zIndex,
		closable = true
	}: Props = $props();

	const sizeClasses = {
		sm: 'max-w-sm',
		md: 'max-w-2xl',
		lg: 'max-w-4xl',
		xl: 'max-w-6xl'
	};

	const isMobileFullscreen = $derived(
		mediaQuery.isMobile && (size === 'xl' || size === 'lg' || size === 'md')
	);

	function handleBackdropClick(e: MouseEvent) {
		if (!closable) return;
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!closable) return;
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

{#if open}
	<div
		class="modal modal-open mb-0"
		style:z-index={zIndex}
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="modal-box relative p-0 {isMobileFullscreen &&
				' flex h-dvh w-full max-w-none flex-col rounded-none'}
				{!isMobileFullscreen && sizeClasses[size]} pt-8}"
		>
			<!-- Header fixe en haut -->
			<div
				class="bg-base-100 border-base-300 sticky top-0 z-10 flex items-center justify-between border-b px-4 py-2"
			>
				{#if isMobileFullscreen && closable}
					<button
						class="btn btn-circle btn-ghost sm:btn-sm mr-2"
						onclick={onClose}
						aria-label="Retour"
					>
						<ArrowLeft size={20} />
					</button>
					{#if title}
						<h3 class="flex-1 text-base font-semibold">{title}</h3>
					{/if}
					<!-- <button class="btn btn-circle btn-primary btn-sm" onclick={}><Save class="p-1" /></button> -->
				{:else if closable}
					<h3 class="flex-1 text-lg font-semibold">{title}</h3>
					<button class="btn btn-circle btn-ghost btn-sm" onclick={onClose} aria-label="Fermer">
						<X size={20} />
					</button>
				{:else}
					<h3 class="flex-1 text-lg font-semibold">{title}</h3>
					<!-- Pas de bouton de fermeture (modal non-fermable) -->
				{/if}
			</div>

			<!-- Contenu scrollable avec padding pour les actions -->
			<div
				class="p-4 {isMobileFullscreen ? 'mt-2 flex-1 overflow-y-auto' : ''} {actions
					? 'pb-10'
					: ''}"
			>
				{@render children()}
			</div>

			<!-- Actions fixes en bas -->
			{#if actions}
				<div
					class="bg-base-100/90 sticky bottom-0 mt-auto flex w-full justify-between gap-4 border-t border-slate-400 px-4 py-2 shadow-xl backdrop-blur {isMobileFullscreen
						? 'rounded-none'
						: 'rounded-b-xl'}"
				>
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
{/if}
