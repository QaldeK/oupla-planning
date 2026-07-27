<script lang="ts">
import {
	Bell,
	LoaderCircle,
	Mail,
	MessageSquare,
	Save,
	ShieldAlert,
	Smartphone
} from "@lucide/svelte";
import { untrack } from "svelte";
import { toast } from "svelte-sonner";
import Modal from "$lib/components/ui/Modal.svelte";
import { pb } from "$lib/pocketbase/pb";
import { getParticipantPrefs, updateParticipantPrefs } from "$lib/services/planningParticipants";
import {
	getDefaultPlanningPrefs,
	type NewCommentScope,
	type PlanningParticipantPrefs,
	subscribeToPush,
	unsubscribeFromPush
} from "$lib/services/push";
import type { RecurrenceType } from "$lib/types/planning.types";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	open: boolean;
	onClose: () => void;
	planningId: string;
	recurrenceType: RecurrenceType;
	isAdmin: boolean;
}

let { open = $bindable(false), onClose, planningId, recurrenceType, isAdmin }: Props = $props();

// Placeholder initial : les vraies prefs sont chargées dans le $effect ci-dessous
// à l'ouverture du modal (selon le recurrenceType courant et l'état en DB).
let prefs = $state<PlanningParticipantPrefs>({
	push: false,
	email: true,
	onOccurrenceChange: true,
	onConfirmationNeeded: false,
	reminderDays: [],
	missingDays: [],
	newCommentScope: "off"
});
let isSaving = $state(false);
let pushSupported = $state(false);
let initialPushState = $state(false); // Track l'état initial pour éviter les désinscriptions inutiles

const reminderOptions: Array<{ value: "1" | "3" | "7"; label: string }> = [
	{ value: "1", label: m.notif_reminder_1_day() },
	{ value: "3", label: m.notif_reminder_3_days() },
	{ value: "7", label: m.notif_reminder_1_week() }
];

const missingOptions: Array<{ value: "1" | "3" | "7" | "15"; label: string }> = [
	{ value: "1", label: m.notif_missing_1_day() },
	{ value: "3", label: m.notif_missing_3_days() },
	{ value: "7", label: m.notif_missing_1_week() },
	{ value: "15", label: m.notif_missing_15_days() }
];

const newCommentScopeOptions: Array<{ value: NewCommentScope; label: string; hint: string }> = [
	{ value: "off", label: m.notif_scope_none(), hint: m.notif_scope_none_hint() },
	{
		value: "concerned",
		label: m.notif_scope_concerned(),
		hint: m.notif_scope_concerned_hint()
	},
	{ value: "all", label: m.notif_scope_all(), hint: m.notif_scope_all_hint() }
];

// Les participants existants avant le déploiement ont `newCommentScope` à null
// en base. Le serveur interprète null comme 'off' : on aligne l'affichage
// pour que le modal reflète le comportement runtime réel.
function normalizeNewCommentScope(value: unknown): NewCommentScope {
	return value === "concerned" || value === "all" ? value : "off";
}

$effect(() => {
	if (!open) return;

	untrack(() => {
		if (!pb.authStore.isValid || !pb.authStore.record) return;

		pushSupported = "serviceWorker" in navigator && "PushManager" in window;

		// Charger les préférences par planning, fusionnées avec les defaults liés
		// au `recurrenceType` du master (rappels / missings J-X) pour les champs
		// éventuellement absents du record existant.
		getParticipantPrefs(planningId, pb.authStore.record.id)
			.then((existing) => {
				const merged = {
					...getDefaultPlanningPrefs(recurrenceType, isAdmin),
					...(existing as Partial<PlanningParticipantPrefs>)
				};
				prefs = {
					...merged,
					newCommentScope: normalizeNewCommentScope(merged.newCommentScope)
				};
				initialPushState = prefs.push;
			})
			.catch(() => {
				prefs = getDefaultPlanningPrefs(recurrenceType, isAdmin);
				initialPushState = prefs.push;
			});
	});
});

async function handleSave() {
	if (!pb.authStore.isValid || !pb.authStore.record) return;

	isSaving = true;
	try {
		// Gestion de la souscription Push
		if (prefs.push && pushSupported) {
			const success = await subscribeToPush(pb.authStore.record.id);
			if (!success) {
				toast.error(m.notif_toast_push_error());
				prefs.push = false;
			}
		} else if (!prefs.push && pushSupported && initialPushState) {
			// Désinscrire uniquement si c'était activé au chargement
			await unsubscribeFromPush(pb.authStore.record.id);
		}

		await updateParticipantPrefs(
			planningId,
			pb.authStore.record.id,
			prefs,
			recurrenceType,
			isAdmin
		);

		toast.success(m.notif_toast_save_success());
		onClose();
	} catch (error) {
		console.error("Erreur de sauvegarde", error);
		toast.error(m.notif_toast_save_error());
	} finally {
		isSaving = false;
	}
}
</script>

<Modal {open} {onClose} title={m.notif_modal_title()} size="md">
	{#if !pb.authStore.isValid}
		<div class="alert alert-warning alert-soft">
			{m.notif_no_account()}
		</div>
	{:else}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSave();
			}}
			class="space-y-6"
		>
			<!-- Canaux de communication -->
			<fieldset class="fieldset">
				<legend class="fieldset-legend flex items-center gap-2">
					<Bell size={16} /> {m.notif_channels()}
				</legend>

				<label
					class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
				>
					<input
						type="checkbox"
						bind:checked={prefs.email}
						class="checkbox checkbox-primary checkbox-sm"
					/>
					<div class="flex items-center gap-2">
						<Mail size={18} class="text-base-content/70" />
						<span class="label-text text-sm font-medium">{m.notif_email_notifications()}</span>
					</div>
				</label>

				{#if pushSupported}
					<label
						class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
					>
						<input
							type="checkbox"
							bind:checked={prefs.push}
							class="checkbox checkbox-secondary checkbox-sm"
						/>
						<div class="flex items-center gap-2">
							<Smartphone size={18} class="text-base-content/70" />
							<span class="label-text text-sm font-medium">{m.notif_push_notifications()}</span
							>
						</div>
					</label>
				{/if}
			</fieldset>

			<!-- Événements notifiables -->
			<fieldset
				class={['fieldset', !prefs.email && !prefs.push && 'pointer-events-none opacity-50']}
			>
				<legend class="fieldset-legend">{m.notif_what_notify()}</legend>

				<!-- Modifs d'occurrence (toggle unique : heure / lieu / détails / annulation) -->
				<label
					class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
				>
					<input
						type="checkbox"
						bind:checked={prefs.onOccurrenceChange}
						class="checkbox checkbox-sm"
					/>
					<span class="label-text text-sm font-medium">
						{m.notif_occurrence_changes()}
					</span>
				</label>

				<!-- Rappels (multi-select via checkboxes bind:group) -->
				<div class="bg-base-200 border-base-300 space-y-2 rounded-lg border p-3">
					<p class="label-text text-sm font-medium">{m.notif_reminders()}</p>
					<p class="text-xs opacity-60">{m.notif_reminders_hint()}</p>
					<div class="flex flex-wrap gap-x-4 gap-y-2 pt-1 pl-1">
						{#each reminderOptions as opt (opt.value)}
							<label class="label cursor-pointer justify-start gap-2 p-0">
								<input
									type="checkbox"
									bind:group={prefs.reminderDays}
									value={opt.value}
									class="checkbox checkbox-sm checkbox-primary"
								/>
								<span class="label-text text-sm">{opt.label}</span>
							</label>
						{/each}
					</div>
				</div>

				<!-- Missings (tous les participants non-absents sont destinataires) -->
				<div class="bg-base-200 border-base-300 space-y-2 rounded-lg border p-3">
					<p class="label-text text-sm font-medium">{m.notif_missing_participants()}</p>
					<p class="text-xs opacity-60">{m.notif_missing_hint()}</p>
					<div class="flex flex-wrap gap-x-4 gap-y-2 pt-1 pl-1">
						{#each missingOptions as opt (opt.value)}
							<label class="label cursor-pointer justify-start gap-2 p-0">
								<input
									type="checkbox"
									bind:group={prefs.missingDays}
									value={opt.value}
									class="checkbox checkbox-sm checkbox-warning"
								/>
								<span class="label-text text-sm">{opt.label}</span>
							</label>
						{/each}
					</div>
				</div>

				<!-- Messages sur les occurrences (préférence exclusive à 3 valeurs) -->
				<div class="bg-base-200 border-base-300 space-y-2 rounded-lg border p-3">
					<div class="flex items-center gap-2">
						<MessageSquare size={16} class="text-base-content/70" />
						<p class="label-text text-sm font-medium">{m.notif_new_messages()}</p>
					</div>
					<div class="space-y-2 pt-1">
						{#each newCommentScopeOptions as opt (opt.value)}
							<label class="label cursor-pointer justify-start gap-3 rounded-md p-1">
								<input
									type="radio"
									bind:group={prefs.newCommentScope}
									value={opt.value}
									class="radio radio-sm radio-primary"
								/>
								<span class="flex flex-col">
									<span class="label-text text-sm font-medium">{opt.label}</span>
									<span class="text-xs opacity-60">{opt.hint}</span>
								</span>
							</label>
						{/each}
					</div>
				</div>
			</fieldset>

			<!-- Section admin -->
			{#if isAdmin}
				<fieldset
					class={['fieldset', !prefs.email && !prefs.push && 'pointer-events-none opacity-50']}
				>
					<legend class="fieldset-legend flex items-center gap-2">
						<ShieldAlert size={16} /> Administration
					</legend>

					<label
						class="label bg-base-200 border-base-300 cursor-pointer justify-start gap-3 rounded-lg border p-3"
					>
						<input
							type="checkbox"
							bind:checked={prefs.onConfirmationNeeded}
							class="checkbox checkbox-warning checkbox-sm"
						/>
						<div class="space-y-0.5">
							<p class="label-text text-sm font-medium">
								{m.notif_unconfirmed_events()}
							</p>
							<p class="text-xs opacity-60">
								{m.notif_unconfirmed_hint()}
							</p>
						</div>
					</label>
				</fieldset>
			{/if}

			<div class="modal-action pt-2">
				<button type="submit" class="btn btn-primary gap-2" disabled={isSaving}>
					{#if isSaving}
						<LoaderCircle class="animate-spin" size={18} />
						{m.notif_saving()}
					{:else}
						<Save size={18} />
						{m.notif_save()}
					{/if}
				</button>
			</div>
		</form>
	{/if}
</Modal>
