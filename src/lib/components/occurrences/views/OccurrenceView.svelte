<script lang="ts">
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import { updateOccurrence } from '$lib/services/planningActions';
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import {
		formatDateShort,
		formatDateWithDay,
		formatTimeRange,
		isPast,
		isToday
	} from '$lib/utils/date';
	import {
		Calendar,
		CheckCircle,
		Clock,
		MapPin,
		MessageSquare,
		Pencil,
		XCircle
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import type { ViewProps } from '../index';
	import OccurrenceEditModal from '../OccurrenceEditModal.svelte';
	import { createOccurrenceState } from '../shared/occurrenceState.svelte';
	import ResponseBadge from '../shared/ResponseBadge.svelte';
	import ResponsesSummary from '../shared/ResponsesSummary.svelte';
	import TaskCompactSummary from '../shared/TaskCompactSummary.svelte';

	let { occurrence, master, currentUserId, isAdmin, readOnly = false }: ViewProps = $props();

	let showEditModal = $state(false);
	const token = $derived(isAdmin ? master.adminToken : master.participantToken)!;
	const viewMode = $derived(userStore.preferredOccurrenceView);

	// Logique de confirmation/annulation basées sur le master pour toConfirm
	const toConfirm = $derived(master.toConfirm ?? false);
	const showQuickConfirm = $derived(
		isAdmin && toConfirm && !occurrence.isConfirmed && !occurrence.isCanceled
	);
	const showQuickRestore = $derived(isAdmin && occurrence.isCanceled);

	// --- État du modal de confirmation générique ---
	let confirmModalState = $state({
		open: false,
		title: '',
		message: '',
		description: '',
		confirmLabel: '',
		variant: 'info' as 'danger' | 'warning' | 'info' | 'success',
		onConfirm: () => {}
	});

	async function toggleConfirm() {
		if (!token) return;

		// Si besoin d'un avertissement et que l'événement n'est pas encore confirmé
		if (needsConfirmationWarning && !occurrence.isConfirmed) {
			const warnings = [];
			if (missingPresences > 0) warnings.push(`${missingPresences} participant(s) manquant(s)`);
			if (incompleteTasks.length > 0)
				warnings.push(`${incompleteTasks.length} tâche(s) non remplie(s)`);

			confirmModalState = {
				open: true,
				title: 'Confirmer malgré tout ?',
				message: 'Le quorum ou les besoins en tâches ne sont pas atteints.',
				description: `Détails : ${warnings.join(' et ')}. Les participants recevront la notification de confirmation.`,
				confirmLabel: 'Confirmer quand même',
				variant: 'warning',
				onConfirm: executeConfirm
			};
			return;
		}

		await executeConfirm();
	}

	async function executeConfirm() {
		confirmModalState.open = false;
		try {
			if (!token) return;
			const updated = await updateOccurrence(
				occurrence.id,
				{ isConfirmed: !occurrence.isConfirmed, isCanceled: false },
				token,
				occurrence
			);
			planningStore.updateOccurrence(updated);
			toast.success(updated.isConfirmed ? 'Événement confirmé' : 'Confirmation annulée');
		} catch (error) {
			toast.error('Erreur lors de la confirmation');
		}
	}

	async function restoreEvent() {
		if (!token) return;
		try {
			const updated = await updateOccurrence(
				occurrence.id,
				{ isCanceled: false, isConfirmed: !toConfirm },
				token,
				occurrence
			);
			planningStore.updateOccurrence(updated);
			toast.success('Événement rétabli');
		} catch (error) {
			toast.error('Erreur lors du rétablissement');
		}
	}

	// État partagé de l'occurrence
	const occState = createOccurrenceState(() => ({
		occurrence,
		master,
		currentUserId
	}));

	// Classes et états dérivés partagés
	const dateClass = $derived(
		isToday(occurrence.date)
			? 'badge-primary'
			: isPast(occurrence.date)
				? 'badge-ghost'
				: 'badge-neutral'
	);

	const canRespond = $derived(
		occState.masterConfig.allowResponses &&
			!occurrence.isCanceled &&
			currentUserId &&
			!isPast(occurrence.date) &&
			!readOnly
	);

	function openCommentDrawer() {
		drawerStore.showComments({
			occurrenceId: occurrence.id,
			currentUserId,
			isAdmin
		});
	}

	const hasResponsesAndTasks = $derived(
		occState.inherited.tasks.length === 0 || !occState.masterConfig.allowResponses
	);

	// --- Logique de validation pour la confirmation ---
	const missingPresences = $derived(
		occState.masterConfig.allowResponses &&
			occState.inherited.minPresentRequired &&
			occState.stats.present < occState.inherited.minPresentRequired
			? occState.inherited.minPresentRequired - occState.stats.present
			: 0
	);

	const incompleteTasks = $derived.by(() => {
		return occState.inherited.tasks.filter((task) => {
			const volunteers = occurrence.responses.filter((r) => r.tasks?.includes(task.id)).length;
			return volunteers < task.requiredVolunteers;
		});
	});

	const needsConfirmationWarning = $derived(missingPresences > 0 || incompleteTasks.length > 0);
</script>

{#if viewMode === 'card'}
	{@render cardLayout()}
{:else}
	{@render rowLayout()}
{/if}

{#snippet actionCompact()}
	<div class="my-1 flex items-center justify-end gap-2">
		<!-- Comment button -->
		<button
			class="btn btn-ghost btn-sm gap-1"
			onclick={openCommentDrawer}
			aria-label="Voir les commentaires"
		>
			<MessageSquare size={16} />
			<span class="text-sm">{occurrence.comments.length}</span>
		</button>

		<!-- Admin quick actions -->
		{#if isAdmin}
			<div class="flex gap-1">
				{#if showQuickConfirm}
					<button
						class="btn btn-ghost btn-sm text-success"
						onclick={toggleConfirm}
						title="Confirmer la tenue"
					>
						<CheckCircle size={18} />
						Confirmer
					</button>
				{/if}
				{#if showQuickRestore}
					<button
						class="btn btn-ghost btn-sm text-warning"
						onclick={restoreEvent}
						title="Rétablir l'événement"
					>
						<Calendar size={18} />
						Rétablir
					</button>
				{/if}
			</div>
		{/if}

		<!-- Admin edit button -->
		{#if isAdmin}
			<button
				class="btn btn-ghost btn-sm btn-circle"
				aria-label="Modifier"
				onclick={() => (showEditModal = true)}
			>
				<Pencil size={16} />
			</button>
		{/if}
	</div>
{/snippet}

{#snippet rowLayout()}
	<div
		class="{occurrence.isCanceled
			? 'opacity-60'
			: ''} bg-base-100 border-b-4 border-neutral-300 p-2 pb-4"
	>
		<!-- Line 1: Header -->
		<div class="flex items-center justify-between gap-2 pb-2">
			<div class="flex items-center gap-3 text-sm">
				<!-- Date & Time -->
				<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0">
					<div class="flex items-center gap-1 text-lg font-semibold">
						<Calendar size={16} />
						<span class:badge={isToday(occurrence.date)} class={dateClass}>
							{formatDateShort(occurrence.date)}
						</span>
					</div>

					<div class="flex items-center gap-1 opacity-70">
						<Clock size={14} />
						{formatTimeRange(occurrence.startTime, occurrence.endTime)}
					</div>

					<!-- Place -->
					{#if occState.inherited.place}
						<div class="flex items-center gap-1 opacity-70">
							<MapPin size={14} />
							<span class="max-w-[150px] truncate">{occState.inherited.place}</span>
						</div>
					{/if}
				</div>

				<div class="flex flex-wrap items-center justify-end gap-x-2 gap-y-0">
					<!-- Status badges -->
					{#if occurrence.isCanceled}
						<span class="badge badge-error badge-sm">Annulé</span>
					{:else if occurrence.isConfirmed}
						<span class="badge badge-success badge-sm">Confirmé</span>
					{/if}

					<!-- Min present badge -->
					{#if occState.inherited.minPresentRequired}
						<div class="">
							<ResponseBadge
								present={occState.stats.present}
								required={occState.inherited.minPresentRequired}
							/>
						</div>
					{/if}
				</div>
			</div>
			<div class="max-sm:hidden">
				{@render actionCompact()}
			</div>
		</div>

		<!-- Line 2: Actions -->
		{#if !occurrence.isCanceled}
			{#if canRespond || occState.inherited.tasks.length > 0 || occurrence.comments.length > 0}
				<div class="mt-2 flex flex-col gap-3">
					<!-- Response buttons -->
					{#if canRespond}
						<ResponsesSummary
							responses={occurrence.responses}
							getParticipantName={occState.getParticipantName}
							availableTypes={occState.masterConfig.availableResponseTypes}
							onResponseSelect={occState.setResponse}
							isCompact={true}
							{currentUserId}
						/>
					{/if}

					<!-- Task summary -->
					{#if occState.inherited.tasks.length > 0}
						<TaskCompactSummary
							tasks={occState.inherited.tasks}
							responses={occurrence.responses}
							{currentUserId}
							isSubmitting={occState.isSubmitting}
							{readOnly}
							isPastDate={isPast(occurrence.date)}
							getParticipantName={occState.getParticipantName}
							onToggle={occState.toggleTask}
							isCompact={true}
						/>
					{/if}
				</div>
			{/if}
		{/if}
		<div class="pt-4 sm:hidden">
			{@render actionCompact()}
		</div>
	</div>
{/snippet}

{#snippet cardLayout()}
	<div class="card card-sm bg-base-100 shadow-md {occurrence.isCanceled ? 'opacity-60' : ''} mb-8">
		<div class="card-body">
			<!-- En-tête -->
			<div class="flex items-center justify-between">
				<div class="flex-1">
					<div class="mb-2 flex flex-wrap items-center gap-4">
						<!-- date time -->
						<div class="flex min-w-60 flex-wrap items-center gap-2">
							<span class="text-lg font-medium"
								><Calendar size={18} class="inline " />
								{formatDateWithDay(occurrence.date)}</span
							>
							<div class="text-md flex items-center gap-1 font-medium">
								<Clock size={16} />
								{formatTimeRange(occurrence.startTime, occurrence.endTime)}
							</div>
						</div>

						{#if occState.inherited.place}
							<div class="flex items-center gap-1">
								<MapPin size={16} />
								{occState.inherited.place}
							</div>
						{/if}
						{#if master.toConfirm && occurrence.isConfirmed}
							<span class="badge badge-success badge-sm gap-1">
								<CheckCircle size={12} />
								Confirmé
							</span>
						{/if}
						{#if occurrence.isCanceled}
							<span class="badge badge-error badge-sm gap-1">
								<XCircle size={12} />
								Annulé
							</span>
						{/if}
						{#if occState.inherited.minPresentRequired}
							{@const ratio = Math.min(
								100,
								(occState.stats.present / occState.inherited.minPresentRequired) * 100
							)}
							<div class="mx-auto flex items-center gap-2">
								<div class="bg-base-300 h-2 w-24 overflow-hidden rounded-full">
									<div
										class="h-full transition-all duration-500 {ratio >= 100
											? 'bg-success'
											: 'bg-warning'}"
										style="width: {ratio}%"
									></div>
								</div>
								<span class="text-xs font-medium tabular-nums">
									{occState.stats.present}/{occState.inherited.minPresentRequired} présences
								</span>
							</div>
						{/if}
					</div>
				</div>
				{#if isAdmin}
					<div class="flex flex-wrap justify-end gap-2">
						{#if showQuickConfirm}
							<button
								class="btn btn-sm text-success"
								onclick={toggleConfirm}
								title="Confirmer la tenue"
							>
								<CheckCircle size={20} />
								Confirmer
							</button>
						{/if}
						{#if showQuickRestore}
							<button
								class="btn btn-ghost btn-sm text-warning"
								onclick={restoreEvent}
								title="Rétablir l'événement"
							>
								<Calendar size={20} />
								Rétablir
							</button>
						{/if}

						<button
							class="btn btn-ghost btn-sm btn-circle"
							onclick={() => (showEditModal = true)}
							aria-label="Modifier"
						>
							<Pencil size={18} />
						</button>
					</div>
				{/if}
			</div>

			{#if !occurrence.isCanceled}
				{#if occState.masterConfig.allowResponses && currentUserId}
					<div class="mt-3 flex flex-wrap items-center justify-between gap-8">
						<div class="flex flex-1">
							<ResponsesSummary
								responses={occurrence.responses}
								getParticipantName={occState.getParticipantName}
								availableTypes={occState.masterConfig.availableResponseTypes}
								onResponseSelect={occState.setResponse}
								{currentUserId}
							/>
						</div>
					</div>
				{/if}

				<div class="divider {hasResponsesAndTasks && 'hidden'}"></div>

				<!-- Task summary -->
				{#if occState.inherited.tasks.length > 0}
					<TaskCompactSummary
						tasks={occState.inherited.tasks}
						responses={occurrence.responses}
						{currentUserId}
						isSubmitting={occState.isSubmitting}
						{readOnly}
						isPastDate={isPast(occurrence.date)}
						getParticipantName={occState.getParticipantName}
						onToggle={occState.toggleTask}
					/>
				{/if}
			{/if}

			<!-- Commentaires -->
			<button class="btn btn-ghost mt-3 self-end" onclick={openCommentDrawer}>
				<MessageSquare class="mr-1 inline h-4 w-4" />
				Afficher les commentaires ({occurrence.comments.length})
			</button>
		</div>
	</div>
{/snippet}

{#if isAdmin}
	<OccurrenceEditModal
		bind:open={showEditModal}
		onClose={() => (showEditModal = false)}
		{occurrence}
		{master}
		{token}
	/>

	<ConfirmModal
		bind:open={confirmModalState.open}
		onClose={() => (confirmModalState.open = false)}
		onConfirm={confirmModalState.onConfirm}
		title={confirmModalState.title}
		message={confirmModalState.message}
		description={confirmModalState.description}
		confirmLabel={confirmModalState.confirmLabel}
		variant={confirmModalState.variant}
	/>
{/if}
