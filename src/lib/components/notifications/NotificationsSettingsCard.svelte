<script lang="ts">
import { BellOff, Laptop, Mail, Pencil, Smartphone, Tablet } from "@lucide/svelte";
import { toast } from "svelte-sonner";
import NotificationModal from "$lib/components/notifications/NotificationModal.svelte";
import ConfirmModal from "$lib/components/ui/ConfirmModal.svelte";
import * as m from "$lib/paraglide/messages.js";
import { pb } from "$lib/pocketbase/pb";
import { type NewCommentScope, removeCurrentDevice, removeRemoteDevice } from "$lib/services/push";
import type { RecurrenceType } from "$lib/types/planning.types";
import type {
	PlanningParticipantsResponse,
	PushSubscriptionsResponse
} from "$lib/types/pocketbase-types";

interface PlanningEntry {
	participantId: string;
	planningId: string;
	title: string;
	push: boolean;
	email: boolean;
	reminderDays: string[];
	missingDays: string[];
	newCommentScope: NewCommentScope;
	recurrenceType: RecurrenceType;
	isAdmin: boolean;
}

interface Props {
	subscriptions: PushSubscriptionsResponse[];
	currentEndpoint: string | null;
	entries: PlanningEntry[];
}

let { subscriptions, currentEndpoint, entries }: Props = $props();

// Retrait d'appareil (confirmation)
let removeTarget = $state<PushSubscriptionsResponse | null>(null);
let isRemoving = $state(false);

// Édition des prefs par planning (modal réutilisé tel quel)
let notifModalOpen = $state(false);
let selectedPlanning = $state<PlanningEntry | null>(null);

function deviceLabel(userAgent: string): string {
	const browser =
		(/Edg\//.test(userAgent) && "Edge") ||
		(/OPR\//.test(userAgent) && "Opera") ||
		(/Firefox\//.test(userAgent) && "Firefox") ||
		(/Chrome\//.test(userAgent) && "Chrome") ||
		(/Safari\//.test(userAgent) && "Safari") ||
		null;
	const os =
		(/Windows/.test(userAgent) && "Windows") ||
		(/Android/.test(userAgent) && "Android") ||
		(/iPhone|iPad/.test(userAgent) && "iOS") ||
		(/Mac OS X/.test(userAgent) && "macOS") ||
		(/Linux/.test(userAgent) && "Linux") ||
		null;

	if (!browser && !os) return userAgent.slice(0, 40) || "—";
	return [browser ?? "", os ?? ""].filter(Boolean).join(" · ");
}

function deviceIcon(userAgent: string) {
	if (/iPhone|iPad/.test(userAgent)) return Tablet;
	if (/Android.*Mobile|Android/.test(userAgent)) return Smartphone;
	return Laptop;
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		dateStyle: "short",
		timeStyle: "short"
	});
}

async function confirmRemove() {
	const target = removeTarget;
	if (!target) return;

	isRemoving = true;
	try {
		if (target.endpoint === currentEndpoint) {
			await removeCurrentDevice();
		} else {
			await removeRemoteDevice(target.id);
		}
		toast.success(m.settings_notifications_device_removed_toast());
		removeTarget = null;
	} catch (error) {
		console.error("Erreur lors du retrait de l'appareil", error);
		toast.error(m.settings_notifications_device_remove_error_toast());
	} finally {
		isRemoving = false;
	}
}

function openEdit(entry: PlanningEntry) {
	selectedPlanning = entry;
	notifModalOpen = true;
}
</script>

<!-- Section Mes appareils -->
<div class="mb-6">
  <h3 class="mb-3 flex items-center gap-2 font-medium">
    <Smartphone size={16} />
    {m.settings_notifications_devices_title()}
  </h3>

  {#if subscriptions.length === 0}
    <p class="text-sm opacity-70">
      {m.settings_notifications_devices_empty()}
    </p>
  {:else}
    <ul class="space-y-2">
      {#each subscriptions as sub (sub.id)}
        {@const DeviceIcon = deviceIcon(sub.user_agent)}
        <li
          class="border-base-content/10 flex items-center justify-between gap-2 rounded-lg border p-3"
        >
          <div class="flex min-w-0 items-center gap-3">
            <DeviceIcon size={18} class="text-base-content/70 shrink-0" />
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span class="truncate">{deviceLabel(sub.user_agent)}</span>
                {#if sub.endpoint === currentEndpoint}
                  <span class="badge badge-primary badge-outline badge-sm">
                    {m.settings_notifications_this_device()}
                  </span>
                {/if}
              </p>
              {#if sub.refreshed_at}
                <p class="text-xs opacity-60">
                  {m.settings_notifications_last_sync({ date: formatDate(sub.refreshed_at) })}
                </p>
              {/if}
            </div>
          </div>
          <button
            class="btn btn-error btn-ghost btn-sm shrink-0"
            onclick={() => (removeTarget = sub)}
          >
            {m.settings_notifications_remove_button()}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- Section Mes plannings -->
<div>
  <h3 class="mb-3 flex items-center gap-2 font-medium">
    <Mail size={16} />
    {m.settings_notifications_plannings_title()}
  </h3>

  {#if entries.length === 0}
    <p class="text-sm opacity-70">
      {m.settings_notifications_plannings_empty()}
    </p>
  {:else}
    <ul class="space-y-2">
      {#each entries as entry (entry.participantId)}
        <li
          class="border-base-content/10 flex items-center justify-between gap-2 rounded-lg border p-3"
        >
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span class="truncate">{entry.title}</span>
              {#if entry.push}
                <span class="badge badge-secondary badge-sm">
                  {m.settings_notifications_channel_push()}
                </span>
              {/if}
              {#if entry.email}
                <span class="badge badge-ghost badge-sm">
                  {m.settings_notifications_channel_email()}
                </span>
              {/if}
            </p>
            {#if entry.reminderDays.length > 0 || entry.missingDays.length > 0}
              <p class="mt-1 flex flex-wrap gap-x-3 text-xs opacity-60">
                {#if entry.reminderDays.length > 0}
                  <span>
                    {m.settings_notifications_reminders_summary({
                      days: [...entry.reminderDays].sort((a, b) => Number(a) - Number(b)).join(", ")
                    })}
                  </span>
                {/if}
                {#if entry.missingDays.length > 0}
                  <span>
                    {m.settings_notifications_missing_summary({
                      days: [...entry.missingDays].sort((a, b) => Number(a) - Number(b)).join(", ")
                    })}
                  </span>
                {/if}
              </p>
            {/if}
          </div>
          <button class="btn btn-ghost btn-sm shrink-0" onclick={() => openEdit(entry)}>
            <Pencil size={14} />
            {m.settings_edit_button()}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- Confirmation de retrait d'appareil -->
<ConfirmModal
  open={removeTarget !== null}
  onClose={() => (removeTarget = null)}
  onConfirm={confirmRemove}
  title={m.settings_notifications_remove_confirm_title()}
  message={
    removeTarget?.endpoint === currentEndpoint
      ? m.settings_notifications_remove_current_message()
      : m.settings_notifications_remove_remote_message()
  }
  confirmLabel={m.settings_notifications_remove_button()}
  variant="warning"
  isSubmitting={isRemoving}
/>

<!-- Édition des préférences par planning -->
{#if selectedPlanning}
  <NotificationModal
    bind:open={notifModalOpen}
    onClose={() => (notifModalOpen = false)}
    planningId={selectedPlanning.planningId}
    recurrenceType={selectedPlanning.recurrenceType}
    isAdmin={selectedPlanning.isAdmin}
  />
{/if}
