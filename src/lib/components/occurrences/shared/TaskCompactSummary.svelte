<script lang="ts">
	import type { Task, ParticipantResponse, TaskType } from '$lib/types/planning.types';
	import {
		Plus,
		Clock,
		CalendarArrowUp,
		CalendarArrowDown,
		ClipboardCheck,
		X
	} from 'lucide-svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { slide } from 'svelte/transition';

	interface Props {
		tasks: Task[];
		responses: ParticipantResponse[];
		currentUserId?: string;
		isSubmitting: boolean;
		readOnly: boolean;
		isPastDate: boolean;
		isCompact?: boolean;
		getParticipantName: (response: ParticipantResponse) => string;
		onToggle: (taskId: string) => void;
	}

	let {
		tasks,
		responses,
		currentUserId,
		isSubmitting,
		readOnly,
		isPastDate,
		isCompact = false,
		getParticipantName,
		onToggle
	}: Props = $props();

	const isCompactDisplay = $derived(mediaQuery.isMobile || isCompact);

	const TASK_TYPE_CONFIG: Record<TaskType, { bgClass: string; label: string; icon: any }> = {
		beforeEvent: { bgClass: 'bg-accent/30', label: 'Avant', icon: CalendarArrowUp },
		onEvent: { bgClass: 'bg-accent/60', label: 'Pendant', icon: Clock },
		afterEvent: { bgClass: 'bg-accent', label: 'Après', icon: CalendarArrowDown }
	};

	function getInscribed(taskId: string) {
		return responses.filter((r) => r.tasks?.includes(taskId));
	}

	function isUserInscribed(taskId: string) {
		if (!currentUserId) return false;
		return (
			responses.find((r) => r.participantId === currentUserId)?.tasks?.includes(taskId) ?? false
		);
	}
</script>

{#if !isCompact}
	<div class="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
		<div class="flex items-center gap-2 opacity-70">
			<ClipboardCheck size={16} class="shrink-0" />
			<div class="text-base font-semibold">Liste des tâches</div>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<div class="badge bg-accent/30"><CalendarArrowUp class="size-4" /> En amont</div>
			<div class="badge bg-accent/60"><Clock class="size-4" /> Pendant</div>
			<div class="badge bg-accent"><CalendarArrowDown class="size-4" /> Après</div>
		</div>
	</div>
{/if}

{#snippet btnSubscribe(isInTask: boolean, taskId: string)}
	<button
		class="btn btn-circle btn-xs {isInTask ? 'btn-error' : 'btn-primary'}"
		onclick={() => onToggle(taskId)}
		disabled={isSubmitting || readOnly || isPastDate}
	>
		{#if isInTask}
			<X size={14} strokeWidth={3} />
		{:else}
			<Plus class="size-4 transition-all group-hover:size-5 group-hover:stroke-2" strokeWidth={3} />
		{/if}
	</button>
{/snippet}

{#snippet taskRegular(
	task: Task,
	config: any,
	Icon: any,
	inscribed: ParticipantResponse[],
	volunteers: number,
	isComplete: boolean,
	isInTask: boolean
)}
	<button
		class="bg-base-200/50 group border-accent ring-accent flex grow flex-col items-stretch overflow-hidden rounded-lg border shadow-sm transition-all hover:cursor-pointer hover:ring-2 lg:max-w-1/3"
		onclick={() => onToggle(task.id)}
		disabled={isSubmitting || readOnly || isPastDate}
	>
		<div
			class="border-neutral/10 flex w-full items-center gap-4 border-b-2 px-3 py-1.5 text-sm font-medium opacity-80 {config.bgClass} justify-start"
		>
			<div class="flex items-center gap-2">
				<Icon size={18} class="shrink-0" />
				<div class="flex flex-wrap items-center gap-2">
					<span class="truncate text-start text-wrap">{task.name}</span>
					<div class="text-xs">({config.label})</div>
				</div>
			</div>
			<div class="ms-auto flex items-center gap-4">
				<div
					class="badge badge-sm font-black {isComplete
						? 'badge-success'
						: 'badge-warning'} ms-auto px-1"
				>
					{volunteers}/{task.requiredVolunteers}
				</div>
				{#if !readOnly && !isPastDate}
					<div class="ms-auto">{@render btnSubscribe(isInTask, task.id)}</div>
				{/if}
			</div>
		</div>
		<div class="flex flex-1 flex-wrap items-center gap-1.5 p-3">
			{#if volunteers > 0}
				{#each inscribed as response (response.participantId)}
					<div class="badge md:badge-lg bg-accent border-none font-medium" transition:slide>
						{getParticipantName(response)}
					</div>
				{/each}
			{:else}
				<div class="px-2 text-xs italic opacity-40">...</div>
			{/if}
		</div>
	</button>
{/snippet}

{#snippet taskCompact(
	task: Task,
	config: any,
	Icon: any,
	inscribed: ParticipantResponse[],
	volunteers: number,
	isComplete: boolean,
	isInTask: boolean
)}
	<button
		class="bg-base-200/50 group border-accent ring-accent flex flex-wrap items-stretch overflow-hidden rounded-lg border shadow-sm transition-all hover:cursor-pointer hover:ring-2 max-sm:w-full md:min-w-xs"
		onclick={() => onToggle(task.id)}
		disabled={isSubmitting || readOnly || isPastDate}
	>
		<div
			class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium opacity-80 {config.bgClass}"
		>
			<Icon size={18} class="shrink-0" />
			<div class="flex flex-col items-start justify-start">
				<span class="truncate text-start text-wrap">{task.name}</span>
				<div class="text-xs opacity-70">{config.label}</div>
			</div>
		</div>
		{#if volunteers > 0}
			{@const displayInscribed = inscribed.slice(0, 6)}
			{#each displayInscribed as response (response.participantId)}
				<div class="badge md:badge-lg bg-accent m-1.5 border-none font-medium" transition:slide>
					{getParticipantName(response)}
				</div>
			{/each}
			{#if volunteers > 6}
				{@const hiddenParticipants = inscribed.slice(6)}
				{@const hiddenNames = hiddenParticipants.map((r) => getParticipantName(r)).join(', ')}
				<div class="tooltip" data-tip={hiddenNames}>
					<div class="badge badge-sm m-1.5 bg-purple-400 opacity-60">
						+{volunteers - 6}
					</div>
				</div>
			{/if}
		{:else}
			<div class="m-2 text-xs italic opacity-40">...</div>
		{/if}
		<div class="ms-auto flex items-center gap-2 p-1.5">
			<div class="badge badge-sm font-black {isComplete ? 'badge-success' : 'badge-warning'} px-1">
				{volunteers}/{task.requiredVolunteers}
			</div>
			{#if !readOnly && !isPastDate}
				{@render btnSubscribe(isInTask, task.id)}
			{/if}
		</div>
	</button>
{/snippet}

{#if tasks && tasks.length > 0}
	<div class="flex w-full flex-wrap gap-3">
		{#each tasks as task (task.id)}
			{@const config = TASK_TYPE_CONFIG[task.type]}
			{@const Icon = config.icon}
			{@const inscribed = getInscribed(task.id)}
			{@const volunteers = inscribed.length}
			{@const isComplete = volunteers >= task.requiredVolunteers}
			{@const isInTask = isUserInscribed(task.id)}
			{#if isCompactDisplay}
				{@render taskCompact(task, config, Icon, inscribed, volunteers, isComplete, isInTask)}
			{:else}
				{@render taskRegular(task, config, Icon, inscribed, volunteers, isComplete, isInTask)}
			{/if}
		{/each}
	</div>
{/if}
