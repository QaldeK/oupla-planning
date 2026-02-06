<script lang="ts">
	import type { ResponseType } from '$lib/types/planning.types';
	import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_CONFIG } from '$lib/constants';

	interface Props {
		availableTypes?: ResponseType[];
		selectedResponse: ResponseType | undefined;
		isSubmitting: boolean;
		onSelect: (response: ResponseType) => void;
	}

	let { availableTypes, selectedResponse, isSubmitting, onSelect }: Props = $props();

	function getButtonActiveClass(responseType: ResponseType): string {
		return RESPONSE_TYPE_CONFIG[responseType].btnClass;
	}

	function getButtonInactiveClass(responseType: ResponseType): string {
		const btnClass = RESPONSE_TYPE_CONFIG[responseType].btnClass;
		return `text-${btnClass}-content btn-soft ${btnClass}`;
	}
</script>

<div class="join">
	{#each AVAILABLE_RESPONSE_TYPES as responseType (responseType)}
		{@const isAvailable = availableTypes?.includes(responseType) ?? true}
		{#if isAvailable}
			<button
				class="btn join-item {selectedResponse === responseType
					? getButtonActiveClass(responseType)
					: getButtonInactiveClass(responseType)} {isSubmitting && 'loading'}"
				onclick={() => onSelect(responseType)}
				disabled={isSubmitting}
			>
				{RESPONSE_TYPE_CONFIG[responseType].label}
			</button>
		{/if}
	{/each}
</div>
