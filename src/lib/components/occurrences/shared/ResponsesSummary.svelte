<script lang="ts">
	import type { ResponseType, ParticipantResponse } from '$lib/types/planning.types';
	import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_CONFIG } from '$lib/constants';
	import { Plus, UserMinus, UserPlus } from 'lucide-svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { slide } from 'svelte/transition';

	interface Props {
		responses: ParticipantResponse[];
		getParticipantName: (response: ParticipantResponse) => string;
		availableTypes?: ResponseType[];
		onResponseSelect: (type: ResponseType) => void;
		isCompact?: boolean;
		currentUserId?: string;
		disabled?: boolean;
		isPastDate?: boolean;
	}

	let {
		responses,
		getParticipantName,
		availableTypes,
		onResponseSelect,
		isCompact = false,
		currentUserId,
		disabled = false,
		isPastDate = false
	}: Props = $props();

	const types = $derived(availableTypes || AVAILABLE_RESPONSE_TYPES);
	const isCompactDisplay = $derived(mediaQuery.isMobile || isCompact);
	const currentUserResponseType = $derived(
		currentUserId ? responses.find((r) => r.participantId === currentUserId)?.response : null
	);

	const responsesByType = $derived.by(() => {
		const grouped: Record<ResponseType, ParticipantResponse[]> = {
			present: [],
			if_needed: [],
			maybe: [],
			absent: []
		};
		for (const response of responses) {
			const responseType = response.response;
			if (responseType in grouped) grouped[responseType].push(response);
		}
		return grouped;
	});

	const sizeResponse = $derived(
		types.length === 2 ? 'max-w-1/2' : types.length === 3 ? 'max-w-1/3' : 'max-w-1/4'
	);
</script>

{#snippet responseRegular(
	type: ResponseType,
	config: any,
	typeResponses: ParticipantResponse[],
	Icon: any
)}
	<button
		class="bg-base-200/50 group flex {sizeResponse} grow flex-col overflow-hidden rounded-lg {!disabled &&
			'hover:cursor-pointer hover:ring-2'} {config.ringClass} {config.borderClass}"
		onclick={() => !isPastDate && onResponseSelect(type)}
	>
		<div
			class="border-neutral/10 flex w-full items-center gap-1.5 border-b-2 px-4 py-1.5 text-sm font-medium opacity-80 {config.bgClass} justify-start"
		>
			<Icon size={16} />
			<span>{config.label}</span>
			{#if currentUserResponseType !== type}
				<div class="ms-auto flex items-center">
					<div
						class="badge opacity-70 {!disabled &&
							'group-hover:scale-110'} {config.badgeClass} {config.borderClass}"
					>
						<UserPlus class="size-5 stroke-2" />
					</div>
				</div>
			{/if}
		</div>
		<div class="flex min-h-6 flex-1 flex-wrap items-start gap-2 p-4 px-3">
			{#each typeResponses as response (response.participantId)}
				<div
					class="badge badge-lg {config.bgClass} {response.participantId === currentUserId
						? `border-2 ${config.borderClass} font-bold`
						: 'font-medium'}"
					transition:slide
				>
					{getParticipantName(response)}
				</div>
			{/each}
			{#if typeResponses.length === 0}
				<div class="px-3 text-xs italic opacity-40">...</div>
			{/if}
		</div>
	</button>
{/snippet}

{#snippet responseCompact(
	type: ResponseType,
	config: any,
	typeResponses: ParticipantResponse[],
	Icon: any
)}
	<button
		class="bg-base-200/50 group flex flex-wrap overflow-hidden rounded-lg {!disabled &&
			'hover:cursor-pointer hover:ring-2'} max-sm:w-full {config.ringClass} {config.borderClass}"
		onclick={() => !isPastDate && onResponseSelect(type)}
	>
		<div
			class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium opacity-80 {config.bgClass}"
		>
			<Icon size={16} />
			<span class={typeResponses.some((r) => r.participantId === currentUserId) ? 'font-bold' : ''}
				>{config.label}</span
			>
		</div>
		<div class="min-w-20">
			{#each typeResponses as response (response.participantId)}
				<div
					class="badge m-1.5 {config.bgClass} {response.participantId === currentUserId
						? `border-2 ${config.borderClass} font-bold`
						: 'font-medium'}"
				>
					{getParticipantName(response)}
				</div>
			{/each}
		</div>
		{#if currentUserResponseType !== type}
			<div class="ms-auto flex items-center p-1.5">
				<div
					class="badge opacity-70 {!disabled &&
						'group-hover:scale-110'} {config.badgeClass} {config.borderClass}"
				>
					<UserPlus class="size-5 stroke-2   " />
				</div>
			</div>
		{/if}
	</button>
{/snippet}

{#if types.length > 0}
	<fieldset
		{disabled}
		class="flex w-full flex-wrap gap-3 {disabled && 'opacity-80 grayscale-50'} {isPastDate &&
			'bg-base-200/30'}"
	>
		{#each types as type (type)}
			{@const config = RESPONSE_TYPE_CONFIG[type]}
			{@const typeResponses = responsesByType[type]}
			{@const Icon = config.icon}
			{#if isCompactDisplay}
				{@render responseCompact(type, config, typeResponses, Icon)}
			{:else}
				{@render responseRegular(type, config, typeResponses, Icon)}
			{/if}
		{/each}
	</fieldset>
{:else if !isCompactDisplay}
	<p class="text-base-content/70 text-sm">Aucune réponse pour le moment</p>
{/if}
