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
	}

	let { open = $bindable(false), onClose, title, children, actions, size = 'md' }: Props = $props();

	const sizeClasses = {
		sm: 'max-w-sm',
		md: 'max-w-2xl',
		lg: 'max-w-4xl',
		xl: 'max-w-6xl'
	};

	const isMobileFullscreen = $derived(mediaQuery.isMobile && (size === 'xl' || size === 'lg'));

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

{#if open}
	<div
		class="modal modal-open"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="modal-box {isMobileFullscreen
				? 'flex h-dvh w-full max-w-none flex-col rounded-none px-4 py-2'
				: sizeClasses[size]} relative"
		>
			<!-- Header fixe en haut -->
			{#if title}
				<div
					class="flex items-center justify-between {isMobileFullscreen
						? 'bg-base-100 border-base-300 sticky top-0 z-10 border-b pb-2'
						: 'mb-4'}"
				>
					{#if isMobileFullscreen}
						<button
							class="btn btn-circle btn-ghost btn-sm mr-2"
							onclick={onClose}
							aria-label="Retour"
						>
							<ArrowLeft size={20} />
						</button>
						<h3 class="flex-1 text-base font-bold md:text-lg">{title}</h3>
						<!-- <button class="btn btn-circle btn-primary btn-sm" onclick={}><Save class="p-1" /></button> -->
					{:else}
						<h3 class="text-lg font-bold">{title}</h3>
						<button class="btn btn-circle btn-ghost btn-sm" onclick={onClose} aria-label="Fermer">
							<X size={20} />
						</button>
					{/if}
				</div>
			{:else}
				<button
					class="btn btn-circle btn-ghost btn-sm absolute top-2 right-2 z-10"
					onclick={onClose}
					aria-label="Fermer"
				>
					{#if isMobileFullscreen}
						<ArrowLeft size={20} />
					{:else}
						<X size={20} />
					{/if}
				</button>
			{/if}

			<!-- Contenu scrollable -->
			<div class="modal-content {isMobileFullscreen ? 'flex-1 overflow-y-auto' : ''}">
				{@render children()}
			</div>

			<!-- Actions fixes en bas -->
			{#if actions}
				<div class="modal-action">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
{/if}
