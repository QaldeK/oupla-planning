<script lang="ts">
	import type { Task, ParticipantResponse, TaskType, ViewType } from '$lib/types/planning.types';
	import {
		Clock,
		CalendarArrowUp,
		CalendarArrowDown,
		ClipboardCheck,
		UserMinus,
		UserPlus,
		Eye
	} from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import TaskVolunteersModal from './TaskVolunteersModal.svelte';

	interface Props {
		tasks: Task[];
		responses: ParticipantResponse[];
		currentUserId?: string;
		isSubmitting: boolean;
		readOnly: boolean;
		isPastDate: boolean;
		displayMode: ViewType;
		getParticipantName: (response: ParticipantResponse) => string;
		onToggle: (taskId: string) => void;
		disabled?: boolean;
	}

	let {
		tasks,
		responses,
		currentUserId,
		isSubmitting,
		readOnly,
		isPastDate,
		displayMode,
		getParticipantName,
		onToggle,
		disabled = false
	}: Props = $props();

	const isCompactDisplay = $derived(displayMode === 'compact');
	const isMinimalDisplay = $derived(displayMode === 'minimal');

	// Modal state
	let modalTaskId = $state<string | null>(null);
	const modalTask = $derived(tasks.find((t) => t.id === modalTaskId));
	const modalOpen = $derived(modalTaskId !== null);

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

{#if displayMode === 'card'}
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
		class="badge opacity-70 {!disabled && 'group-hover:scale-110'} {isInTask
			? 'badge-error border-error'
			: 'badge-accent'}"
		onclick={() => onToggle(taskId)}
	>
		{#if isInTask}
			<UserMinus class="size-5 stroke-2" />
		{:else}
			<UserPlus class="size-5 stroke-2" />
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
		class="bg-base-200/50 group border-accent ring-accent flex grow flex-col items-stretch overflow-hidden rounded-lg border shadow-sm transition-all {!disabled &&
			'hover:cursor-pointer hover:ring-2'} lg:max-w-1/3"
		onclick={() => onToggle(task.id)}
		disabled={isSubmitting}
		title="s'inscrire/se désinscrire à la tâche {task.name}"
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
					aria-label="nombre requis"
					title="Nombre de personnes requises pour la tâche {task.name}"
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
					<div
						class="badge md:badge-lg bg-accent/60 {response.participantId === currentUserId
							? 'border-accent border-2 font-bold'
							: 'font-medium'}"
						transition:slide
					>
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
		class="bg-base-200/50 group border-accent ring-accent flex flex-wrap items-center overflow-hidden rounded-lg border shadow-sm transition-all {!disabled &&
			'hover:cursor-pointer hover:ring-2'} max-sm:w-full md:min-w-xs"
		onclick={() => onToggle(task.id)}
		disabled={isSubmitting || readOnly || isPastDate}
		title="s'inscrire/se désinscrire à la tâche {task.name}"
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
				<div
					class="badge bg-accent/60 m-1.5 {response.participantId === currentUserId
						? 'border-accent border-2 font-bold'
						: 'font-medium'}"
					transition:slide
				>
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
			<div
				class="badge badge-sm font-semibold {isComplete ? 'badge-success' : 'badge-warning'} px-1"
				title="Nombre de personnes requises pour la tâche {task.name}"
			>
				{volunteers}/{task.requiredVolunteers}
			</div>
			{#if !readOnly && !isPastDate}
				{@render btnSubscribe(isInTask, task.id)}
			{/if}
		</div>
	</button>
{/snippet}

{#snippet taskMinimal(
	task: Task,
	config: any,
	Icon: any,
	inscribed: ParticipantResponse[],
	volunteers: number,
	isComplete: boolean,
	isInTask: boolean
)}
	<div
		class={[
			'rounded-box bg-accent/20 flex  items-center gap-2 border p-2 max-sm:w-full ',
			isInTask ? 'border-accent border-3' : 'border-accent/50'
		]}
	>
		<div class="flex flex-col items-start justify-start px-1">
			<span class="truncate text-start text-sm text-wrap">{task.name}</span>
			<div class="text-xs opacity-70">{config.label}</div>
		</div>
		<div class="w-min-1/3 mx-2 ms-auto flex items-center justify-between gap-3">
			<!-- Badge inscrit/requis -->
			<div
				class="badge badge-sm font-semibold {isComplete ? 'badge-success' : 'badge-warning'} px-1"
				title="Nombre de personnes requises pour la tâche {task.name}"
			>
				{volunteers}/{task.requiredVolunteers}
			</div>

			<!-- Bouton Eyes pour voir les inscrits -->
			<button
				class="btn btn-ghost btn-sm btn-circle"
				onclick={() => (modalTaskId = task.id)}
				title="Voir les inscrits"
			>
				<Eye size={16} />
			</button>

			<!-- Bouton inscription rapide -->
			{#if !readOnly && !isPastDate}
				<button
					class="btn btn-sm btn-square {isInTask ? 'btn-error' : 'btn-accent'}"
					onclick={() => onToggle(task.id)}
					title={isInTask ? 'Se désinscrire' : "S'inscrire"}
				>
					{#if isInTask}
						<UserMinus size={16} />
					{:else}
						<UserPlus size={16} />
					{/if}
				</button>
			{/if}
		</div>
	</div>
{/snippet}

{#if tasks && tasks.length > 0}
	{#if isMinimalDisplay}
		<fieldset
			{disabled}
			class="my-1 flex w-full flex-wrap gap-2 {disabled && 'opacity-70 grayscale-50'}"
		>
			<legend class="mb-1 text-xs opacity-60">Liste des tâches: </legend>

			{#each tasks as task (task.id)}
				{@const config = TASK_TYPE_CONFIG[task.type]}
				{@const Icon = config.icon}
				{@const inscribed = getInscribed(task.id)}
				{@const volunteers = inscribed.length}
				{@const isComplete = volunteers >= task.requiredVolunteers}
				{@const isInTask = isUserInscribed(task.id)}
				{@render taskMinimal(task, config, Icon, inscribed, volunteers, isComplete, isInTask)}
			{/each}
		</fieldset>
	{:else}
		<fieldset
			{disabled}
			class="flex w-full flex-wrap gap-3 {disabled && 'opacity-70 grayscale-50'}"
		>
			{#if isCompactDisplay}
				<legend class="mb-1 text-xs opacity-60">Liste des tâches: </legend>
			{/if}
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
		</fieldset>
	{/if}
{/if}

{#if modalTask}
	<TaskVolunteersModal
		open={modalOpen}
		onClose={() => (modalTaskId = null)}
		task={modalTask}
		inscribed={getInscribed(modalTask.id)}
		{currentUserId}
		isInTask={isUserInscribed(modalTask.id)}
		{isSubmitting}
		{readOnly}
		{isPastDate}
		{getParticipantName}
		onToggle={() => onToggle(modalTask.id)}
	/>
{/if}
