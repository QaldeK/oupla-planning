<script lang="ts">
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import { updateOccurrence } from '$lib/services/planningActions';
	import { commentStateService } from '$lib/services/commentStateService';
	import { db } from '$lib/pb-sync/db';
	import { useLiveQuery } from '$lib/pb-sync/use-live-query.svelte';
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { formatDateShort, formatDateWithDay, formatTimeRange, isPast } from '$lib/utils/date';
	import {
		Calendar,
		CalendarCheck,
		CalendarCheckIcon,
		CalendarSyncIcon,
		CheckCircle,
		CircleQuestionMark,
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
	const viewMode = $derived(userStore.appPreferences.occurrenceView);

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
			toast.success(updated.isConfirmed ? 'Événement confirmé' : 'Confirmation annulée');
		} catch (_error) {
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
			toast.success('Événement rétabli');
		} catch (_error) {
			toast.error('Erreur lors du rétablissement');
		}
	}

	// État partagé de l'occurrence
	const occState = createOccurrenceState(() => ({
		occurrence,
		master,
		currentUserId
	}));

	// Edit logic: can only modify if user is authenticated and date is not past
	const isPastDate = $derived(isPast(occurrence.date));
	const isAuthenticated = $derived(!!currentUserId);
	const canRespond = $derived(
		!isPastDate && !occurrence.isCanceled && !readOnly && isAuthenticated
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

	const commentStateQuery = useLiveQuery(
		() => db.commentState.get(occurrence.id),
		() => [occurrence.id]
	);
	const hasUnread = $derived(
		commentStateService.hasUnreadComments(occurrence, commentStateQuery.current)
	);
</script>

{#if viewMode === 'card'}
	{@render cardLayout()}
{:else if viewMode === 'minimal'}
	{@render rowLayoutMinimal()}
{:else}
	{@render rowLayout()}
{/if}

{#snippet actionCompact()}
	<div class="flex items-center justify-end gap-2">
		<!-- Admin quick actions -->
		{#if isAdmin}
			<div class="flex gap-1">
				{#if showQuickConfirm}
					<button
						class="btn btn-ghost sm:btn-sm"
						onclick={toggleConfirm}
						disabled={occState.isNetworkUnavailable}
						title="Confirmer la tenue"
					>
						<CalendarCheckIcon size={18} />
						Confirmer
					</button>
				{/if}
				{#if showQuickRestore}
					<button
						class="btn btn-ghost sm:btn-sm"
						onclick={restoreEvent}
						title="Rétablir l'événement"
						disabled={occState.isNetworkUnavailable}
					>
						<CalendarSyncIcon size={18} />
						<span>Rétablir</span>
					</button>
				{/if}
			</div>
		{/if}

		<!-- Admin edit button -->
		{#if isAdmin}
			<button
				class="btn btn-ghost sm:btn-sm btn-circle"
				aria-label="Modifier"
				onclick={() => (showEditModal = true)}
				disabled={occState.isNetworkUnavailable}
			>
				<Pencil size={16} />
			</button>
		{/if}

		<!-- Comment button -->
		<button
			class="btn btn-ghost sm:btn-sm gap-1"
			onclick={openCommentDrawer}
			aria-label="Voir les commentaires"
		>
			<span class="relative">
				<MessageSquare size={16} />
				{#if hasUnread}
					<span class="bg-primary absolute -top-1 -right-1 size-2 rounded-full"></span>
				{/if}
			</span>
			<span class="text-sm">{occurrence.comments.length}</span>
		</button>
	</div>
{/snippet}

{#snippet statusBadge(size: 'xs' | 'sm' | 'md')}
	{@const cls = size === 'xs' ? 'badge-sm gap-0.5 text-xs' : size === 'sm' ? 'badge-sm gap-1' : ''}
	{@const iconSize = size === 'xs' ? 10 : size === 'sm' ? 12 : 16}
	{#if master.toConfirm && occurrence.isConfirmed}
		<span class="badge {cls} bg-success/40 font-medium">
			<CheckCircle size={iconSize} />
			Confirmé
		</span>
	{:else if occurrence.isCanceled}
		<span class="badge {cls} badge-error">
			<XCircle size={iconSize} />
			Annulé
		</span>
	{:else if master.toConfirm && !occurrence.isConfirmed}
		<span class="badge {cls} bg-warning/40 font-medium">
			<CircleQuestionMark size={iconSize} />
			à confirmer
		</span>
	{/if}
{/snippet}

{#snippet rowLayout()}
	<div class=" bg-base-100 border-b-4 border-neutral-300 py-2">
		<!-- Line 1: Header -->
		<div class="mb-2 flex items-center justify-between gap-2 px-2">
			<div class="flex flex-1 items-center justify-between gap-2 text-sm sm:gap-6">
				<!-- Date & Time -->
				<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0">
					<div class="flex items-center gap-1 text-lg font-semibold">
						<Calendar size={16} />
						<span>
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
							<MapPin size={16} />
							{occState.inherited.place}
						</div>
					{/if}
				</div>

				<div class="me-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
					{@render statusBadge('sm')}

					<!-- Min present badge -->
					{#if occState.inherited.minPresentRequired}
						<ResponseBadge
							present={occState.stats.present}
							required={occState.inherited.minPresentRequired}
						/>
					{/if}
				</div>
			</div>
			<div class="max-sm:hidden">
				{@render actionCompact()}
			</div>
		</div>

		<!-- Line 2: Actions -->
		<div class="mt-2 flex flex-col gap-3 p-2">
			{#if occState.masterConfig.allowResponses}
				<!-- Response buttons -->
				<ResponsesSummary
					responses={occurrence.responses}
					getParticipantName={occState.getParticipantName}
					availableTypes={occState.masterConfig.availableResponseTypes}
					onResponseSelect={occState.setResponse}
					displayMode={viewMode}
					disabled={occState.isNetworkUnavailable || !canRespond}
					{currentUserId}
					{isPastDate}
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
					displayMode={viewMode}
					disabled={occState.isNetworkUnavailable || !canRespond}
				/>
			{/if}
		</div>
		<div class="sm:hidden">
			{@render actionCompact()}
		</div>
	</div>
{/snippet}

{#snippet cardLayout()}
	<div class="card card-sm bg-base-100 mb-8 shadow-md">
		<div class="card-body">
			<!-- En-tête -->
			<div class="mb-2 flex items-center justify-between">
				<div class=" flex flex-wrap items-center gap-4">
					<!-- date time -->
					<div class="flex min-w-60 flex-wrap items-center gap-x-4 gap-y-2">
						<div class="flex items-center gap-2 text-lg font-medium">
							<Calendar size={18} class="inline" />
							{formatDateWithDay(occurrence.date)}
						</div>
						<div class="flex items-center gap-1 text-base font-medium">
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
					{@render statusBadge('md')}
				</div>
				<div class="flex flex-wrap items-center justify-end gap-2">
					{#if occState.inherited.minPresentRequired}
						{@const ratio = Math.min(
							100,
							(occState.stats.present / occState.inherited.minPresentRequired) * 100
						)}
						<div
							class=" badge me-2 flex items-center gap-2 border {ratio >= 100
								? 'border-success'
								: 'border-warning'}"
						>
							<div class="bg-base-300 h-2 w-24 overflow-hidden rounded-full">
								<div
									class="h-full transition-all duration-500 {ratio >= 100
										? 'bg-success'
										: 'bg-warning'}"
									style="width: {ratio}%"
								></div>
							</div>
							<span class="text-sm font-medium tabular-nums">
								{occState.stats.present}/{occState.inherited.minPresentRequired} présences
							</span>
						</div>
					{/if}
					{#if isAdmin}
						{#if showQuickConfirm}
							<button class="btn sm:btn-sm" onclick={toggleConfirm} title="Confirmer la tenue">
								<CalendarCheck size={20} />
								Confirmer
							</button>
						{/if}
						{#if showQuickRestore}
							<button
								class="btn btn-ghost sm:btn-sm"
								onclick={restoreEvent}
								title="Rétablir l'événement"
							>
								<CalendarSyncIcon size={20} />
								Rétablir
							</button>
						{/if}

						<button
							class="btn btn-ghost sm:btn-sm btn-circle"
							onclick={() => (showEditModal = true)}
							aria-label="Modifier"
						>
							<Pencil size={18} />
						</button>
					{/if}
				</div>
			</div>

			{#if occState.masterConfig.allowResponses}
				<div class="mt-3 flex flex-wrap items-center justify-between gap-8">
					<div class="flex flex-1">
						<ResponsesSummary
							responses={occurrence.responses}
							getParticipantName={occState.getParticipantName}
							availableTypes={occState.masterConfig.availableResponseTypes}
							onResponseSelect={occState.setResponse}
							displayMode={viewMode}
							{currentUserId}
							disabled={occState.isNetworkUnavailable || !canRespond}
							{isPastDate}
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
					displayMode={viewMode}
					disabled={occState.isNetworkUnavailable || !canRespond}
				/>
			{/if}

			<!-- Commentaires -->
			<button class="btn btn-ghost mt-3 self-end" onclick={openCommentDrawer}>
				<span class="relative mr-1 inline">
					<MessageSquare class="h-4 w-4" />
					{#if hasUnread}
						<span class="bg-primary absolute -top-1 -right-1 size-2 rounded-full"></span>
					{/if}
				</span>
				Afficher les commentaires ({occurrence.comments.length})
			</button>
		</div>
	</div>
{/snippet}

{#snippet rowLayoutMinimal()}
	<div class="bg-base-100 border-neutral/30 border-b-2 py-1.5">
		<div class="mb-1 flex flex-wrap items-center gap-2 px-2">
			<!-- Date -->
			<div class="flex items-center gap-1 font-semibold">
				<Calendar size={14} />
				<span>{formatDateShort(occurrence.date)}</span>
			</div>

			<!-- Time -->
			{#if occurrence.startTime !== master.defaultStartTime || occurrence.endTime !== master.defaultEndTime}
				<div class="flex items-center gap-1 text-sm opacity-70">
					<Clock size={12} />
					{formatTimeRange(occurrence.startTime, occurrence.endTime)}
				</div>
			{/if}

			<!-- Place -->
			{#if occurrence.place}
				<div class="flex items-center gap-1 text-xs opacity-70">
					<MapPin size={12} />
					{occurrence.place}
				</div>
			{/if}

			{@render statusBadge('xs')}

			<!-- Spacer -->
			<div class="flex-1"></div>
			<!-- Min present badge -->
			{#if occState.inherited.minPresentRequired}
				<ResponseBadge
					present={occState.stats.present}
					required={occState.inherited.minPresentRequired}
				/>
			{/if}

			<div class="ms-auto flex items-center gap-3">
				<div class="max-sm:hidden">
					{@render actionCompact()}
				</div>
			</div>
		</div>

		<!-- Actions section -->
		{#if occState.masterConfig.allowResponses}
			<div class="mb-1 px-2 py-1">
				<ResponsesSummary
					responses={occurrence.responses}
					getParticipantName={occState.getParticipantName}
					availableTypes={occState.masterConfig.availableResponseTypes}
					onResponseSelect={occState.setResponse}
					displayMode={viewMode}
					disabled={occState.isNetworkUnavailable || !canRespond}
					{currentUserId}
					{isPastDate}
				/>
			</div>
		{/if}

		{#if occState.inherited.tasks.length > 0}
			<div class="px-2 py-1">
				<TaskCompactSummary
					tasks={occState.inherited.tasks}
					responses={occurrence.responses}
					{currentUserId}
					isSubmitting={occState.isSubmitting}
					{readOnly}
					isPastDate={isPast(occurrence.date)}
					getParticipantName={occState.getParticipantName}
					onToggle={occState.toggleTask}
					displayMode={viewMode}
					disabled={occState.isNetworkUnavailable || !canRespond}
				/>
			</div>
		{/if}
		<div class="sm:hidden">
			{@render actionCompact()}
		</div>
	</div>
{/snippet}

{#if isAdmin && showEditModal}
	<OccurrenceEditModal
		bind:open={showEditModal}
		onClose={() => (showEditModal = false)}
		{occurrence}
		{master}
		{token}
	/>
{/if}

{#if isAdmin}
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
