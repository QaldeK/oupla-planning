<script lang="ts">
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
	MessageSquareWarning,
	Pencil,
	XCircle
} from "@lucide/svelte";
import ConfirmModal from "$lib/components/ui/ConfirmModal.svelte";
import DescriptionCard from "$lib/components/ui/DescriptionCard.svelte";
import { db } from "$lib/pb-sync/db";
import { useLiveQuery } from "$lib/pb-sync/use-live-query.svelte";
import { commentStateService } from "$lib/services/commentStateService";
import { drawerStore } from "$lib/stores/drawerStore.svelte";
import { mediaQuery } from "$lib/stores/mediaQuery.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import { formatDateShort, formatDateWithDay, formatTimeRange, isPast } from "$lib/utils/date";
import type { ViewProps } from "../index";
import OccurrenceEditModal from "../OccurrenceEditModal.svelte";
import { createConfirmLogic } from "../shared/occurrenceConfirmLogic.svelte";
import { createOccurrenceState } from "../shared/occurrenceState.svelte";
import ResponseBadge from "../shared/ResponseBadge.svelte";
import ResponsesSummary from "../shared/ResponsesSummary.svelte";
import TaskCompactSummary from "../shared/TaskCompactSummary.svelte";
import * as m from "$lib/paraglide/messages.js";

let {
	occurrence,
	master,
	currentUserId,
	isAdmin,
	readOnly = false,
	onNeedReidentify
}: ViewProps = $props();

let showEditModal = $state(false);
const token = $derived(isAdmin ? master.adminToken : master.participantToken)!;
const viewMode = $derived(userStore.appPreferences.occurrenceView);

// Logique de confirmation/annulation basées sur le master pour toConfirm
const toConfirm = $derived(master.toConfirm ?? false);
const showQuickConfirm = $derived(
	isAdmin && toConfirm && !occurrence.isConfirmed && !occurrence.isCanceled
);
const showQuickRestore = $derived(isAdmin && occurrence.isCanceled);

// État partagé de l'occurrence
const occState = createOccurrenceState(() => ({
	occurrence,
	master,
	currentUserId,
	onNeedReidentify
}));

// Logique de confirmation modale (confirm/restore)
const confirmLogic = createConfirmLogic(() => ({
	occurrence,
	token,
	toConfirm,
	occState
}));

// Edit logic: can only modify if user is authenticated and date is not past
const isPastDate = $derived(isPast(occurrence.date));
const isAuthenticated = $derived(!!currentUserId);
const canRespond = $derived(!isPastDate && !occurrence.isCanceled && !readOnly && isAuthenticated);

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

const commentStateQuery = useLiveQuery(
	() => db.commentState.get(occurrence.id),
	() => [occurrence.id]
);
const hasUnread = $derived(
	commentStateService.hasUnreadComments(occurrence, commentStateQuery.current)
);
</script>

{#if viewMode === "card"}
  <div class="my-4">
    {@render cardLayout()}
  </div>
{:else if viewMode === "minimal"}
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
            onclick={confirmLogic.toggleConfirm}
            disabled={occState.isNetworkUnavailable}
            title={m.occurrence_confirm_holding()}
          >
            <CalendarCheckIcon size={18} />
            {m.occurrence_confirm()}
          </button>
        {/if}
        {#if showQuickRestore}
          <button
            class="btn btn-ghost sm:btn-sm"
            onclick={confirmLogic.openRestoreModal}
            title={m.occurrence_restore_event()}
            disabled={occState.isNetworkUnavailable}
          >
            <CalendarSyncIcon size={18} />
            <span>{m.occurrence_restore()}</span>
          </button>
        {/if}
      </div>
    {/if}

    <!-- Admin edit button -->
    {#if isAdmin}
      <button
        class="btn btn-ghost sm:btn-sm btn-circle"
        aria-label={m.common_edit()}
        onclick={() => (showEditModal = true)}
        disabled={occState.isNetworkUnavailable}
      >
        <Pencil size={16} />
      </button>
    {/if}

    <!-- Comment button -->
    <button
      class="btn sm:btn-sm relative gap-1 {hasUnread
        ? 'btn-accent'
        : ' btn-ghost'}"
      onclick={openCommentDrawer}
      aria-label={m.occurrence_see_comments()}
    >
      <span class="">
        {#if hasUnread}
          <MessageSquareWarning size={16} />
          <span
            class="bg-primary absolute -top-1 -right-1 size-2 animate-pulse rounded-full"
          ></span>
        {:else}
          <MessageSquare size={16} />
        {/if}
      </span>
      <span class="text-sm">{occurrence.comments.length}</span>
    </button>
  </div>
{/snippet}

{#snippet statusBadge(size: "xs" | "sm" | "md")}
  {@const cls =
    size === "xs"
      ? "badge-sm gap-0.5 text-xs"
      : size === "sm"
        ? "badge-sm gap-1"
        : ""}
  {@const iconSize = size === "xs" ? 12 : size === "sm" ? 12 : 16}
  {#if master.toConfirm && occurrence.isConfirmed}
    <span class="badge {cls} badge-success font-semibold">
      <CheckCircle size={iconSize} />
      {m.occurrence_status_confirmed()}
    </span>
  {:else if occurrence.isCanceled}
    <span class="badge {cls} badge-error font-semibold">
      <XCircle size={iconSize} />
      {m.occurrence_status_canceled()}
    </span>
  {:else if master.toConfirm && !occurrence.isConfirmed}
    <span class="badge {cls} badge-warning truncate font-semibold">
      <CircleQuestionMark size={iconSize} />
      {m.occurrence_status_to_confirm()}
    </span>
  {/if}
{/snippet}

{#snippet rowLayout()}
  <div class=" bg-base-100 border-neutral/15 border p-2">
    <!-- Line 1: Header -->
    <div class="mb-2 flex items-center justify-between gap-2 px-2">
      <div
        class="flex flex-1 items-center justify-between gap-2 text-sm sm:gap-6"
      >
        <!-- Date & Time -->
        <div
          class="flex flex-wrap items-baseline gap-x-2 gap-y-0 {occurrence.isCanceled &&
            'bg-error/20 rounded px-1'}"
        >
          <div class="flex items-center gap-1 text-lg font-semibold">
            <Calendar size={16} />
            <span>
              {formatDateShort(occurrence.date)}
            </span>
          </div>

          <div class="flex items-center gap-1 font-semibold opacity-80">
            <Clock size={16} />
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

        <div
          class="me-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-1"
        >
          {@render statusBadge("sm")}

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

    {#if occurrence.description}
      <div class="my-2 px-2 pt-1">
        <DescriptionCard text={occurrence.description} collapsedLines={1} />
      </div>
    {/if}

    <!-- Line 2: Actions -->
    <div class="flex flex-col gap-3 px-2 py-1">
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
          quitParticipantIds={occState.quitParticipantIds}
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
          quitParticipantIds={occState.quitParticipantIds}
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
          {@render statusBadge("md")}
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          {#if occState.inherited.minPresentRequired}
            {@const ratio = Math.min(
              100,
              (occState.stats.present / occState.inherited.minPresentRequired) *
                100,
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
                {m.occurrence_presences_count({present: occState.stats.present, required: occState.inherited.minPresentRequired})}
              </span>
            </div>
          {/if}
          {#if isAdmin}
            {#if showQuickConfirm}
              <button
                class="btn sm:btn-sm"
                onclick={confirmLogic.toggleConfirm}
                title={m.occurrence_confirm_holding()}
              >
                <CalendarCheck size={20} />
                {m.occurrence_confirm()}
              </button>
            {/if}
            {#if showQuickRestore}
              <button
                class="btn btn-ghost sm:btn-sm"
                onclick={confirmLogic.openRestoreModal}
                title={m.occurrence_restore_event()}
              >
                <CalendarSyncIcon size={20} />
                {m.occurrence_restore()}
              </button>
            {/if}

            <button
              class="btn btn-ghost sm:btn-sm btn-circle"
              onclick={() => (showEditModal = true)}
              aria-label={m.common_edit()}
            >
              <Pencil size={18} />
            </button>
          {/if}
        </div>
      </div>

      {#if occurrence.description}
        <DescriptionCard text={occurrence.description} collapsedLines={4} />
      {/if}

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
              quitParticipantIds={occState.quitParticipantIds}
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
          quitParticipantIds={occState.quitParticipantIds}
        />
      {/if}

      <!-- Commentaires -->
      <button class="btn btn-ghost mt-3 self-end" onclick={openCommentDrawer}>
        <span class="relative mr-1 inline">
          <MessageSquare class="h-4 w-4" />
          {#if hasUnread}
            <span
              class="bg-primary absolute -top-1 -right-1 size-2 rounded-full"
            ></span>
          {/if}
        </span>
        {m.occurrence_show_comments({count: occurrence.comments.length})}
      </button>
    </div>
  </div>
{/snippet}

{#snippet rowLayoutMinimal()}
  <div class="bg-base-100 border-neutral/15 border p-1">
    <div class="flex flex-wrap items-center gap-x-2 px-2">
      <!-- Date -->
      <div
        class="flex items-center gap-1 font-semibold {occurrence.isCanceled &&
          'bg-error/20 rounded px-1'}"
      >
        <Calendar size={14} />
        <span>{formatDateShort(occurrence.date)}</span>
      </div>

      <!-- Time -->
      <div class="flex items-center gap-1 text-sm font-medium opacity-80">
        <Clock size={14} />
        {formatTimeRange(occurrence.startTime, occurrence.endTime)}
      </div>

      <!-- Place -->
      {#if occurrence.place}
        <div class="flex items-center gap-1 text-sm font-medium opacity-80">
          <MapPin size={14} />
          {occurrence.place}
        </div>
      {/if}

      <div
        class="ms-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1"
      >
        {@render statusBadge("sm")}

        <!-- Min present badge -->
        {#if occState.inherited.minPresentRequired}
          <ResponseBadge
            present={occState.stats.present}
            required={occState.inherited.minPresentRequired}
          />
        {/if}
        {#if !mediaQuery.isMobile}
          <div class="ms-auto flex items-center gap-3">
            {@render actionCompact()}
          </div>
        {/if}
      </div>
    </div>

    {#if occurrence.description}
      <div class="px-2 pt-1">
        <DescriptionCard text={occurrence.description} collapsedLines={1} />
      </div>
    {/if}

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
          quitParticipantIds={occState.quitParticipantIds}
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
          quitParticipantIds={occState.quitParticipantIds}
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
    bind:open={confirmLogic.confirmModalState.open}
    onClose={() => (confirmLogic.confirmModalState.open = false)}
    onConfirm={confirmLogic.confirmModalState.onConfirm}
    title={confirmLogic.confirmModalState.title}
    message={confirmLogic.confirmModalState.message}
    description={confirmLogic.confirmModalState.description}
    confirmLabel={confirmLogic.confirmModalState.confirmLabel}
    variant={confirmLogic.confirmModalState.variant}
  />
{/if}

{#if confirmLogic.responseChangeModal}
  <ConfirmModal
    open={occState.pendingResponseChange !== null}
    onClose={occState.cancelResponseChange}
    onConfirm={occState.confirmResponseChange}
    title={m.occurrence_response_required_title()}
    message={confirmLogic.responseChangeModal.message}
    description={m.occurrence_change_response_warning()}
    confirmLabel={m.occurrence_change_response_confirm()}
    variant="warning"
  />
{/if}
