<script lang="ts">
import type { LucideIcon } from "@lucide/svelte";
import { UserPlus } from "@lucide/svelte";
import { slide } from "svelte/transition";
import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_CONFIG } from "$lib/constants";
import type {
	ParticipantResponse,
	ResponseType,
	ResponseTypeConfig,
	ViewType
} from "$lib/types/planning.types";

interface Props {
	responses: ParticipantResponse[];
	getParticipantName: (response: ParticipantResponse) => string;
	availableTypes?: ResponseType[];
	onResponseSelect: (type: ResponseType) => void;
	displayMode: ViewType;
	currentUserId?: string;
	disabled?: boolean;
	isPastDate?: boolean;
	quitParticipantIds?: Set<string>;
}

let {
	responses,
	getParticipantName,
	availableTypes,
	onResponseSelect,
	displayMode,
	currentUserId,
	disabled = false,
	isPastDate = false,
	quitParticipantIds = new Set()
}: Props = $props();

const types = $derived(availableTypes || AVAILABLE_RESPONSE_TYPES);
const isCompactDisplay = $derived(displayMode === "compact");
const isMinimalDisplay = $derived(displayMode === "minimal");
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
	types.length === 2 ? "max-w-1/2" : types.length === 3 ? "max-w-1/3" : "max-w-1/4"
);
</script>

{#snippet responseRegular(
	type: ResponseType,
	config: ResponseTypeConfig,
	typeResponses: ParticipantResponse[],
	Icon: LucideIcon
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
			<span>{config.label()}</span>
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
				{@const isQuit = quitParticipantIds.has(response.participantId)}
				<div
					class="badge badge-lg {config.bgClass} {response.participantId === currentUserId
						? `border-2 ${config.borderClass} font-bold`
						: 'font-medium'} {isQuit ? 'line-through opacity-40' : ''}"
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
	config: ResponseTypeConfig,
	typeResponses: ParticipantResponse[],
	Icon: LucideIcon
)}
	<button
		class="bg-base-200/50 group flex flex-wrap overflow-hidden rounded-lg {!disabled &&
			'hover:cursor-pointer hover:ring-2'} max-sm:w-full {config.ringClass} {config.borderClass}"
		onclick={() => !isPastDate && onResponseSelect(type)}
	>
		<div class="flex min-w-20 flex-1 flex-wrap items-center gap-1">
			<div
				class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium opacity-90 {config.bgClass}"
			>
				<Icon size={16} />
				<span
					class={typeResponses.some((r) => r.participantId === currentUserId) ? 'font-bold' : ''}
>{config.label()}</span
				>
			</div>
			{#if typeResponses.length > 0}
				{#each typeResponses as response (response.participantId)}
					{@const isQuit = quitParticipantIds.has(response.participantId)}
					<div
						class="badge m-1 {config.bgClass} {response.participantId === currentUserId
							? `border-2 ${config.borderClass} font-bold`
							: 'font-medium'} {isQuit ? 'line-through opacity-40' : ''}"
					>
						{getParticipantName(response)}
					</div>
				{/each}
			{:else}
				<p class="my-auto px-4 text-xs opacity-70">...</p>
			{/if}
			{#if currentUserResponseType !== type}
				<!-- <div class="flex-1"></div> -->
				<div class="ms-auto flex items-center px-2 py-1">
					<div
						class="badge opacity-70 {!disabled &&
							'group-hover:scale-110'} {config.badgeClass} {config.borderClass}"
					>
						<UserPlus class="size-5 stroke-2" />
					</div>
				</div>
			{/if}
		</div>
	</button>
{/snippet}

{#snippet responseMinimal()}
	<div class="flex flex-wrap gap-x-6 gap-y-2">
		<div class="flex w-full max-w-md flex-col sm:flex-1">
			<!-- Grid de boutons pour répondre -->
			<legend class="mb-1 text-xs opacity-60">Votre réponse: </legend>
			<div
				class="grid w-full overflow-hidden rounded-lg {types.length === 2
					? 'grid-cols-2'
					: types.length === 3
						? 'grid-cols-3'
						: 'grid-cols-4'}"
			>
				{#each types as type (type)}
					{@const config = RESPONSE_TYPE_CONFIG[type]}
					{@const typeResponses = responsesByType[type]}
					{@const Icon = config.icon}
					{@const isCurrentUserResponse = typeResponses.some(
						(r) => r.participantId === currentUserId
					)}
					<button
						class={[
							'response-cell text-base-content flex items-center justify-center gap-1.5 px-1 py-1.5 text-sm  transition-all ',

							!disabled && !isPastDate && `hover:cursor-pointer hover:brightness-120`,

							isCurrentUserResponse
								? ` rounded-lg ring-3 ring-inset ${config.ringClass} ${config.bgClass} font-bold`
								: `font-medium ${config.bgClass10}`
						]}
						onclick={() => !isPastDate && onResponseSelect(type)}
						disabled={disabled || isPastDate}
						title={config.label()}
					>
						<span class="response-icon"><Icon size={14} /></span>
						<span class="truncate">{config.label()}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Badges des participants (triés par type: present, if_needed, maybe, absent) -->
		<div class="flex flex-col sm:flex-1">
			<legend class="mb-1 text-xs opacity-60 {responses.length === 0 && 'hidden'}"
				>Toutes les réponses:
			</legend>
			<div class="flex flex-wrap gap-1">
				{#each AVAILABLE_RESPONSE_TYPES as type (type)}
					{@const config = RESPONSE_TYPE_CONFIG[type]}
					{@const Icon = config.icon}
					{#each responsesByType[type] as response (response.participantId)}
						{@const isQuit = quitParticipantIds.has(response.participantId)}
						<div
							class={[
								'badge gap-1',
								config.bgClass,
								response.participantId === currentUserId &&
									`border-3 ${config.borderClass} font-semibold`,
								isQuit && 'line-through opacity-40'
							]}
							in:slide
						>
							<Icon size={16} />
							{getParticipantName(response)}
						</div>
					{/each}
				{/each}
				{#if responses.length === 0}
					<div class="text-xs italic opacity-40">Aucune réponse pour le moment</div>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#if types.length > 0}
	{#if isMinimalDisplay}
		<fieldset
			{disabled}
			class="w-full {disabled && 'opacity-80 grayscale-50'} {isPastDate && 'bg-base-200/30'}"
		>
			{@render responseMinimal()}
		</fieldset>
	{:else}
		<fieldset
			{disabled}
			class="flex w-full flex-wrap gap-x-3 gap-y-2 sm:gap-3 {disabled &&
				'opacity-80 grayscale-50'} {isPastDate && 'bg-base-200/30'}"
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
	{/if}
{:else if !isCompactDisplay && !isMinimalDisplay}
	<p class="text-base-content/70 text-sm">Aucune réponse pour le moment</p>
{/if}

<style>
	.response-cell {
		container-type: inline-size;
	}

	@container (max-width: 80px) {
		.response-icon {
			display: none;
		}
	}
</style>
