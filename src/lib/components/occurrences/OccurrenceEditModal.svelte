<script lang="ts">
	import {
		AlignLeft,
		CheckCircle,
		Clock,
		MapPin,
		Plus,
		User,
		UserPlus,
		Users,
		X,
		XCircle,
	} from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_CONFIG } from "$lib/constants";
	import * as m from "$lib/paraglide/messages.js";
	import {
		addParticipant,
		sortTasks,
		submitResponse,
		updateOccurrence,
	} from "$lib/services/planningActions";
	import { networkStore } from "$lib/stores/networkStore.svelte";
	import type {
		Participant,
		ParticipantResponse,
		PlanningMaster,
		PlanningOccurrence,
		ResponseType,
		Task,
	} from "$lib/types/planning.types";
	import { classifyError } from "$lib/utils/errorHandler";
	import NetworkAlert from "../NetworkAlert.svelte";
	import ConfirmModal from "../ui/ConfirmModal.svelte";
	import Modal from "../ui/Modal.svelte";
	import RichTextEditor from "../ui/RichTextEditor.svelte";
	import TaskManager from "./TaskManager.svelte";
	import VolunteerAssignmentModal from "./VolunteerAssignmentModal.svelte";

	interface Props {
		open: boolean;
		onClose: () => void;
		occurrence: PlanningOccurrence;
		master: PlanningMaster;
		token: string;
	}

	let { open = $bindable(false), onClose, occurrence, master, token }: Props = $props();

	let isSubmitting = $state(false);

	// Changement de réponse en attente de confirmation quand le participant visé
	// est inscrit à au moins une tâche onEvent et que l'admin vise une réponse ≠ present.
	// Singleton : la ConfirmModal est bloquante et chaque changement soumet immédiatement.
	let pendingResponseChange = $state<{
		participantId: string;
		participantName: string;
		targetResponse: ResponseType;
		onEventTaskIds: string[];
	} | null>(null);

	const isNetworkUnavailable = $derived(!networkStore.isNetworkOk);

	const {
		startTime: initialStartTime,
		endTime: initialEndTime,
		place: initialPlace = "",
		description: initialDescription = "",
		isConfirmed: initialIsConfirmed,
		isCanceled: initialIsCanceled,
		minPresentRequired: occMinPresentRequired,
		tasks: occTasks,
	} = (() => occurrence)();

	const { minPresentRequired: masterMinPresentRequired, tasks: masterTasks = [] } = (() =>
		master)();

	// États du formulaire (initialisés avec les valeurs de l'occurrence ou héritées du master)
	let startTime = $state(initialStartTime);
	let endTime = $state(initialEndTime);
	let place = $state(initialPlace);
	let description = $state(initialDescription);
	let isConfirmed = $state(initialIsConfirmed);
	let isCanceled = $state(initialIsCanceled);
	let minPresentRequired = $state(
		occMinPresentRequired && occMinPresentRequired > 0
			? occMinPresentRequired
			: masterMinPresentRequired,
	);

	// Tâches
	let isTasksModified = $state(occTasks !== null && occTasks !== undefined && occTasks.length > 0);
	let tasks = $state<Task[]>(
		occTasks && occTasks.length > 0 ? [...occTasks] : [...(masterTasks || [])],
	);

	// Logique de statut dérivé
	const toConfirm = $derived(master.toConfirm ?? false);

	// Statut actuel de l'occurrence
	type EventStatus = "confirmed" | "pending" | "canceled";
	const currentStatus = $derived<EventStatus>(
		isCanceled ? "canceled" : isConfirmed ? "confirmed" : "pending",
	);

	const statusLabel = $derived(
		currentStatus === "canceled"
			? m.occurrence_status_canceled()
			: currentStatus === "confirmed"
				? m.occurrence_status_confirmed()
				: toConfirm
					? m.occurrence_status_pending_confirmation()
					: m.occurrence_status_always_confirmed(),
	);

	// ===== Gestion admin des responses =====
	let newParticipantName = $state("");
	let isCreatingParticipant = $state(false);

	// ===== Gestion admin des bénévoles =====
	let taskVolunteerModalOpen = $state(false);
	let selectedTaskForVolunteers = $state<Task | null>(null);

	// ===== Helpers =====

	// Helper pour récupérer les participants inscrits à une tâche
	function getTaskVolunteers(taskId: string) {
		return occurrence.responses
			.filter((r) => r.tasks?.includes(taskId))
			.map((r) => {
				const participant = master.participants.find((p) => p.id === r.participantId);
				return {
					participantId: r.participantId,
					name: participant?.name || m.common_unknown(),
					response: r,
				};
			});
	}

	// Handler pour supprimer un participant d'une tâche
	async function handleRemoveVolunteerFromTask(taskId: string, participantId: string) {
		try {
			const existingResponse = occurrence.responses.find((r) => r.participantId === participantId);
			if (!existingResponse) return;

			const updatedTasks = (existingResponse.tasks || []).filter((t) => t !== taskId);

			const newResponse: ParticipantResponse = {
				participantId,
				response: existingResponse.response,
				tasks: updatedTasks,
				comment: existingResponse.comment,
				respondedAt: new Date().toISOString(),
			};

			const updated = await submitResponse(
				occurrence.id,
				participantId,
				newResponse,
				token,
				occurrence,
			);
			occurrence = updated;
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		}
	}

	async function handleCreateParticipant(name: string): Promise<Participant> {
		const updatedMaster = await addParticipant(
			master.id,
			{
				name,
				isAdmin: false,
			},
			token,
		);

		// Mettre à jour master localement pour réactivité
		master = updatedMaster;

		return updatedMaster.participants.find((p) => p.name === name)!;
	}

	async function handleAddParticipant() {
		if (!newParticipantName.trim() || isCreatingParticipant) return;

		isCreatingParticipant = true;
		try {
			await handleCreateParticipant(newParticipantName.trim());
			newParticipantName = "";
			// toast.success('Participant ajouté');
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isCreatingParticipant = false;
		}
	}

	async function handleResponseChange(participantId: string, responseType: ResponseType) {
		// Les tâches onEvent exigent "present". Un changement vers une autre réponse
		// désinscrirait ces tâches — confirmation requise (symétrique au côté participant).
		if (responseType !== "present") {
			const existingResponse = occurrence.responses.find((r) => r.participantId === participantId);
			const onEventInscribed = tasks
				.filter((t) => t.type === "onEvent" && (existingResponse?.tasks || []).includes(t.id))
				.map((t) => t.id);
			if (onEventInscribed.length > 0) {
				const participant = master.participants.find((p) => p.id === participantId);
				pendingResponseChange = {
					participantId,
					participantName: participant?.name || m.common_unknown(),
					targetResponse: responseType,
					onEventTaskIds: onEventInscribed,
				};
				return;
			}
		}

		await applyResponseChange(participantId, responseType);
	}

	// Applique un changement de réponse, en retirant optionnellement des tâches
	// (IDs fournis via tasksToRemove). Centralise la soumission pour le chemin
	// direct et le chemin post-confirmation.
	async function applyResponseChange(
		participantId: string,
		responseType: ResponseType,
		tasksToRemove?: string[],
	) {
		try {
			const existingResponse = occurrence.responses.find((r) => r.participantId === participantId);
			const existingTasks = existingResponse?.tasks || [];
			const newTasks = tasksToRemove
				? existingTasks.filter((t) => !tasksToRemove.includes(t))
				: existingTasks;

			const newResponse: ParticipantResponse = {
				participantId,
				response: responseType,
				tasks: newTasks,
				comment: existingResponse?.comment,
				respondedAt: new Date().toISOString(),
			};

			const updated = await submitResponse(
				occurrence.id,
				participantId,
				newResponse,
				token,
				occurrence,
			);
			occurrence = updated;
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		}
	}

	async function confirmResponseChange() {
		const pending = pendingResponseChange;
		if (!pending) return;
		pendingResponseChange = null;
		await applyResponseChange(
			pending.participantId,
			pending.targetResponse,
			pending.onEventTaskIds,
		);
	}

	function cancelResponseChange() {
		pendingResponseChange = null;
	}

	function openVolunteerModal(task: Task) {
		selectedTaskForVolunteers = task;
		taskVolunteerModalOpen = true;
	}

	function handleVolunteerUpdateOccurrence(updated: PlanningOccurrence) {
		occurrence = updated;
	}

	function handleVolunteerUpdateMaster(updated: PlanningMaster) {
		master = updated;
	}

	async function setStatus(newStatus: EventStatus) {
		isCanceled = newStatus === "canceled";
		isConfirmed = newStatus === "confirmed";
	}

	async function handleSubmit() {
		isSubmitting = true;
		try {
			const updates: Partial<PlanningOccurrence> = {
				startTime,
				endTime,
				place: place.trim() || undefined,
				description: description.trim() || undefined,
				isConfirmed,
				isCanceled,
				minPresentRequired:
					minPresentRequired !== master.minPresentRequired ? minPresentRequired : 0,
				// Si non modifié, on envoie null pour garder l'héritage du master
				tasks: isTasksModified ? sortTasks(tasks) : null,
			};

			const updated = await updateOccurrence(occurrence.id, updates, token);

			// Mise à jour manuelle du store pour garantir la réactivité immédiate
			occurrence = updated;

			toast.success(m.occurrence_updated());
			onClose();
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isSubmitting = false;
		}
	}

	// Message de la ConfirmModal de changement de réponse admin (désinscription onEvent).
	const responseChangeModal = $derived.by(() => {
		const pending = pendingResponseChange;
		if (!pending) return null;
		const taskNames = pending.onEventTaskIds
			.map((id) => tasks.find((t) => t.id === id)?.name)
			.filter((n): n is string => Boolean(n));
		if (taskNames.length === 0) return null;
		const isPlural = taskNames.length > 1;
		return {
			message: isPlural
				? m.occurrence_change_task_subscribed_multi({
						name: pending.participantName,
						count: taskNames.length,
						tasks: taskNames.join(", "),
					})
				: m.occurrence_change_task_subscribed_single({
						name: pending.participantName,
						task: taskNames[0],
					}),
		};
	});
</script>

{#snippet actions()}
	<button type="button" class="btn" onclick={onClose}>{m.common_cancel()}</button>
	<button
		type="submit"
		form="occurrence-edit-form"
		class="btn btn-primary px-8"
		disabled={isSubmitting}
	>
		{#if isSubmitting}
			<span class="loading loading-spinner loading-sm"></span>
		{/if}
		{m.occurrence_save_changes()}
	</button>
{/snippet}

<Modal {open} {onClose} {actions} title={m.occurrence_edit_title()} size="lg">
	<NetworkAlert message={m.common_network_unavailable_edit()} />
	<form
		id="occurrence-edit-form"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		class="space-y-6"
	>
		<!-- Statut de l'événement -->
		<div class="bg-base-200 card mb-8 flex flex-col gap-3 px-4 py-2">
			<h4 class="text-sm font-medium">
				{m.occurrence_event_status_heading()}
				<span class="text-base-content {currentStatus === 'canceled' && 'text-error'}"
					>{statusLabel}</span
				>
			</h4>
			{#if toConfirm}
				<div
					class="join max-sm:mx-auto"
					role="radiogroup"
					aria-label={m.occurrence_event_status_aria()}
				>
					<label
						class="join-item btn btn-sm {currentStatus === 'confirmed'
							? 'btn-success'
							: 'btn-soft'}"
					>
						<input
							type="radio"
							class="hidden"
							name="event-status"
							checked={currentStatus === "confirmed"}
							onchange={() => setStatus("confirmed")}
						/>
						<CheckCircle size={16} class="mr-2" />
						{m.occurrence_status_confirmed()}
					</label>
					<label
						class="join-item btn btn-sm {currentStatus === 'pending' ? 'btn-warning' : 'btn-soft'}"
					>
						<input
							type="radio"
							class="hidden"
							name="event-status"
							checked={currentStatus === "pending"}
							onchange={() => setStatus("pending")}
						/>
						<Clock size={16} class="mr-2" />
						{m.occurrence_status_pending()}
					</label>
					<label
						class="join-item btn btn-sm {currentStatus === 'canceled' ? 'btn-error' : 'btn-soft'}"
					>
						<input
							type="radio"
							class="hidden"
							name="event-status"
							checked={currentStatus === "canceled"}
							onchange={() => setStatus("canceled")}
						/>
						<XCircle size={16} class="mr-2" />
						{m.occurrence_status_canceled()}
					</label>
				</div>
			{:else if currentStatus !== "canceled"}
				<p class="text-base-content/80 text-sm">
					{m.occurrence_always_on_description()}
					<button class="link link-error" onclick={() => setStatus("canceled")}
						>{m.occurrence_cancel_this_date()}</button
					>
				</p>
			{:else}
				<p class="text-base-content/80">
					{m.occurrence_date_canceled()}
					<button class="link link-error" onclick={() => setStatus("pending")}
						>{m.occurrence_reactivate_this_date()}</button
					>
				</p>
			{/if}
		</div>
		<fieldset disabled={isNetworkUnavailable || currentStatus === "canceled"}>
			<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
				<!-- Horaires -->
				<div class="">
					<h4 class="flex items-center gap-2 font-medium">
						<Clock size={18} class="text-primary" />
						{m.occurrence_schedule()}
					</h4>
					<div class="grid grid-cols-2 gap-4">
						<fieldset class="fieldset">
							<legend class="fieldset-legend">{m.occurrence_start_time()}</legend>
							<input type="time" bind:value={startTime} class="input w-full" required />
						</fieldset>
						<fieldset class="fieldset">
							<legend class="fieldset-legend">{m.occurrence_end_time()}</legend>
							<input type="time" bind:value={endTime} class="input w-full" required />
						</fieldset>
					</div>
				</div>

				<!-- Lieu -->
				<div class="">
					<h4 class="flex items-center gap-2 font-medium">
						<MapPin size={18} class="text-primary" />
						{m.occurrence_place()}
					</h4>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">{m.occurrence_specific_place()}</legend>
						<input
							type="text"
							bind:value={place}
							class="input w-full"
							placeholder={master.place || m.occurrence_default_place_placeholder()}
						/>
					</fieldset>
				</div>
			</div>

			<!-- Description -->
			<div class="space-y-2">
				<h4 class="flex items-center gap-2 font-medium">
					<AlignLeft size={18} class="text-primary" />
					{m.occurrence_description()}
				</h4>
				<!-- `disabled` explicite : les éléments contenteditable (TipTap) ne respectent
				     pas le disabled du fieldset parent, il faut le propager manuellement. -->
				<RichTextEditor
					bind:value={description}
					disabled={isNetworkUnavailable || currentStatus === "canceled"}
					placeholder={m.occurrence_specific_notes_placeholder()}
				/>
			</div>

			<div class="divider"></div>

			<!-- Paramètres de réponse -->
			<div class="space-y-4">
				<h4 class="flex items-center gap-2 font-medium">
					<Users size={18} class="text-primary" />
					{m.occurrence_attendees()}
				</h4>

				<div class="space-y-2 md:max-w-1/2">
					<label class="label-text font-medium"
						>{m.occurrence_min_present_required()}
						<div class="flex items-center gap-4">
							<input
								type="range"
								min="1"
								max="20"
								bind:value={minPresentRequired}
								class="range range-primary range-sm"
							/>
							<span class="badge badge-primary tabular-nums">{minPresentRequired}</span>
						</div>
					</label>
				</div>
			</div>

			<div class="divider"></div>

			<!-- Gestion des réponses des participants -->
			{#if master.allowResponses}
				<div class="space-y-4">
					<h4 class="flex items-center gap-2 font-medium">
						<UserPlus size={18} class="text-primary" />
						{m.occurrence_manage_responses()}
					</h4>

					<div class="space-y-2">
						{#each master.participants as participant (participant.id)}
							{#key participant.id}
								{@const response = occurrence.responses.find(
									(r) => r.participantId === participant.id,
								)}
								<div class="bg-base-200 rounded-box px-4 py-1">
									<div class="flex items-center justify-between gap-4 max-sm:flex-col">
										<div class="self-start font-medium">
											<User class="me-1 inline size-4 opacity-70" />
											{participant.name}
										</div>

										<div class=" flex flex-wrap gap-x-4 gap-y-2">
											{#each master.availableResponseTypes || AVAILABLE_RESPONSE_TYPES as type (type)}
												{@const config = RESPONSE_TYPE_CONFIG[type]}
												<label
													class="btn-xs btn flex gap-1 {config.btnClass} {config.borderClass} {response?.response !==
														type && 'btn-soft text-base-content/80 '}"
												>
													<input
														type="radio"
														class="check check-sm"
														name="response-{participant.id}"
														checked={response?.response === type}
														onchange={() => handleResponseChange(participant.id, type)}
													/>
													{config.label()}
												</label>
											{/each}
										</div>
									</div>
								</div>
							{/key}
						{/each}
					</div>

					<!-- Ajouter un nouveau participant -->
					<label class="input mt-2 w-full">
						<input
							type="text"
							bind:value={newParticipantName}
							placeholder={m.occurrence_new_participant_placeholder()}
							onkeydown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									handleAddParticipant();
								}
							}}
						/>
						<button
							type="button"
							class="btn btn-primary btn-circle btn-sm"
							onclick={handleAddParticipant}
							disabled={isCreatingParticipant || !newParticipantName.trim()}
							title={m.common_add()}
						>
							{#if isCreatingParticipant}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								<Plus size={16} />
							{/if}
						</button>
					</label>
				</div>
			{/if}

			<div class="divider"></div>

			<!-- Tâches -->
			<TaskManager
				bind:tasks
				bind:isTasksModified
				{masterTasks}
				disabled={isNetworkUnavailable || currentStatus === "canceled"}
			>
				{#snippet children(task)}
					{@const taskVolunteers = getTaskVolunteers(task.id)}
					<div class="mt-2 flex flex-wrap items-center gap-2 pl-1">
						{#if taskVolunteers.length > 0}
							{#each taskVolunteers as volunteer (volunteer.participantId)}
								<div class="badge md:badge-lg bg-accent flex items-center gap-1 pe-0.5">
									{volunteer.name}
									<button
										type="button"
										class="btn btn-error btn-sm sm:btn-xs btn-soft btn-circle m-1 ml-2 size-4"
										onclick={() => handleRemoveVolunteerFromTask(task.id, volunteer.participantId)}
										aria-label={m.occurrence_remove_volunteer_aria({ name: volunteer.name })}
									>
										<X class="size-4" />
									</button>
								</div>
							{/each}
						{/if}
						<!-- Bouton pour ajouter/gérer des participants -->
						<div class="pl-1">
							<button
								type="button"
								class="btn btn-outline btn-sm sm:btn-xs gap-1"
								onclick={() => openVolunteerModal(task)}
							>
								<Users size={12} />
								{taskVolunteers.length > 0
									? m.occurrence_manage_subscribers()
									: m.occurrence_add_volunteer()}
							</button>
						</div>
					</div>
				{/snippet}
			</TaskManager>
		</fieldset>
	</form>
</Modal>

{#if selectedTaskForVolunteers}
	<VolunteerAssignmentModal
		bind:open={taskVolunteerModalOpen}
		task={selectedTaskForVolunteers}
		participants={master.participants.filter((p) => !p.hasQuit)}
		responses={occurrence.responses}
		occurrenceId={occurrence.id}
		{token}
		masterId={master.id}
		allowResponses={master.allowResponses}
		disabled={isNetworkUnavailable}
		onUpdateOccurrence={handleVolunteerUpdateOccurrence}
		onUpdateMaster={handleVolunteerUpdateMaster}
		onClose={() => (taskVolunteerModalOpen = false)}
	/>
{/if}

{#if responseChangeModal}
	<ConfirmModal
		open={pendingResponseChange !== null}
		onClose={cancelResponseChange}
		onConfirm={confirmResponseChange}
		title={m.occurrence_presence_required_title()}
		message={responseChangeModal.message}
		description={m.occurrence_change_response_admin_warning()}
		confirmLabel={m.occurrence_change_response_admin_confirm()}
		variant="warning"
	/>
{/if}
