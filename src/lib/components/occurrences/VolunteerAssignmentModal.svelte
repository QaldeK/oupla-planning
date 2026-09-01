<script lang="ts">
	import { Info, Plus } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import * as m from "$lib/paraglide/messages.js";
	import { addParticipant, submitResponse } from "$lib/services/planningActions";
	import type {
		Participant,
		ParticipantResponse,
		PlanningMaster,
		PlanningOccurrence,
		Task,
	} from "$lib/types/planning.types";
	import { classifyError } from "$lib/utils/errorHandler";
	import Modal from "../ui/Modal.svelte";

	interface Props {
		open: boolean;
		onClose: () => void;
		task: Task;
		participants: Participant[];
		responses: ParticipantResponse[];
		occurrenceId: string;
		token: string;
		masterId: string;
		/** Contrôle si les tâches onEvent forcent le statut "present" */
		allowResponses: boolean;
		/** Désactiver les interactions (hors-ligne, etc.) */
		disabled?: boolean;
		/** Appelé après chaque toggle — remonte l'occurrence mise à jour */
		onUpdateOccurrence: (updated: PlanningOccurrence) => void;
		/** Appelé après chaque création de participant — remonte le master mis à jour */
		onUpdateMaster: (updated: PlanningMaster) => void;
	}

	let {
		open = $bindable(false),
		onClose,
		task,
		participants,
		responses,
		occurrenceId,
		token,
		masterId,
		allowResponses,
		disabled = false,
		onUpdateOccurrence,
		onUpdateMaster,
	}: Props = $props();

	let newVolunteerName = $state("");
	let isCreatingVolunteer = $state(false);

	async function handleAddVolunteer() {
		if (!newVolunteerName.trim() || isCreatingVolunteer || disabled) return;

		isCreatingVolunteer = true;
		try {
			const updatedMaster = await addParticipant(
				masterId,
				{
					name: newVolunteerName.trim(),
					isAdmin: false,
				},
				token,
			);
			onUpdateMaster(updatedMaster);

			const newParticipant = updatedMaster.participants.find(
				(p) => p.name === newVolunteerName.trim(),
			);
			if (newParticipant) {
				await toggleVolunteer(newParticipant.id);
			}
			newVolunteerName = "";
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isCreatingVolunteer = false;
		}
	}

	async function toggleVolunteer(participantId: string) {
		if (disabled) return;

		try {
			const existingResponse = responses.find((r) => r.participantId === participantId);

			// Auto-set "present" pour onEvent si allowResponses
			let responseType: ParticipantResponse["response"] = existingResponse?.response || "present";
			if (task.type === "onEvent" && allowResponses && responseType !== "present") {
				responseType = "present";
			}

			const existingTasks = existingResponse?.tasks || [];
			const isAssigned = existingTasks.includes(task.id);
			const updatedTasks = isAssigned
				? existingTasks.filter((t) => t !== task.id)
				: [...new Set([...existingTasks, task.id])];

			const newResponse: ParticipantResponse = {
				participantId,
				response: responseType,
				tasks: updatedTasks,
				comment: existingResponse?.comment,
				respondedAt: new Date().toISOString(),
			};

			const updated = await submitResponse(occurrenceId, participantId, newResponse, token);
			onUpdateOccurrence(updated);
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		}
	}
</script>

<Modal {open} {onClose} title={task.name} size="md">
	{#if task}
		<div class="space-y-4">
			<div class="text-sm opacity-70">
				{task.requiredVolunteers}
				{m.volunteer_persons_required()}
				{task.type === "onEvent"
					? m.task_type_during()
					: task.type === "beforeEvent"
						? m.task_type_before()
						: m.task_type_after()}
			</div>

			{#if task.type === "onEvent" && allowResponses}
				<div class="alert alert-info">
					<Info size={16} />
					{m.volunteer_auto_present_notice()}
				</div>
			{/if}

			<div class="flex flex-wrap gap-2">
				{#each participants as participant (participant.id)}
					{@const isVolunteer = responses
						.find((r) => r.participantId === participant.id)
						?.tasks?.includes(task.id)}
					<label class="btn-sm btn flex gap-1 {isVolunteer ? 'btn-primary' : 'btn-soft'}">
						<input
							type="checkbox"
							class="check check-sm"
							checked={isVolunteer}
							onchange={() => toggleVolunteer(participant.id)}
							{disabled}
						/>
						{participant.name}
					</label>
				{/each}
			</div>

			<label class="input mt-2 w-full">
				<input
					type="text"
					bind:value={newVolunteerName}
					placeholder={m.volunteer_add_participant_placeholder()}
					onkeydown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							handleAddVolunteer();
						}
					}}
					{disabled}
				/>
				<button
					type="button"
					class="btn btn-primary btn-circle btn-sm"
					onclick={handleAddVolunteer}
					disabled={isCreatingVolunteer || !newVolunteerName.trim() || disabled}
					title={m.common_add()}
				>
					{#if isCreatingVolunteer}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<Plus size={16} />
					{/if}
				</button>
			</label>

			<div class="modal-action">
				<button type="button" class="btn" onclick={onClose}> {m.common_close()} </button>
			</div>
		</div>
	{/if}
</Modal>
