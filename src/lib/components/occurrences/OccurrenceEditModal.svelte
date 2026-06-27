<script lang="ts">
	import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_CONFIG } from '$lib/constants';
	import {
		addParticipant,
		sortTasks,
		submitResponse,
		updateOccurrence
	} from '$lib/services/planningActions';
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import { classifyError } from '$lib/utils/errorHandler';
	import type {
		Participant,
		ParticipantResponse,
		PlanningMaster,
		PlanningOccurrence,
		ResponseType,
		Task,
		TaskType
	} from '$lib/types/planning.types';
	import {
		AlignLeft,
		CheckCircle,
		CircleAlert,
		ClipboardCheck,
		Clock,
		Info,
		MapPin,
		Pencil,
		Plus,
		RefreshCcw,
		Trash2,
		User,
		UserPlus,
		Users,
		X,
		XCircle
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import NetworkAlert from '../NetworkAlert.svelte';
	import Modal from '../ui/Modal.svelte';
	import ConfirmModal from '../ui/ConfirmModal.svelte';
	import { slide } from 'svelte/transition';

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
		place: initialPlace = '',
		description: initialDescription = '',
		isConfirmed: initialIsConfirmed,
		isCanceled: initialIsCanceled,
		minPresentRequired: occMinPresentRequired,
		tasks: occTasks
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
			: masterMinPresentRequired
	);

	// Tâches
	let isTasksModified = $state(occTasks !== null && occTasks !== undefined && occTasks.length > 0);
	let tasks = $state<Task[]>(
		occTasks && occTasks.length > 0 ? [...occTasks] : [...(masterTasks || [])]
	);
	let newTaskName = $state('');
	let newTaskDescription = $state('');
	let newTaskVolunteers = $state(1);
	let newTaskType = $state<TaskType>('onEvent');
	let editingTaskId = $state<string | null>(null);
	let taskNameInput: HTMLInputElement;

	// Focus automatique sur l'input quand on entre en mode édition
	$effect(() => {
		if (editingTaskId && taskNameInput) {
			taskNameInput.focus();
			taskNameInput.select();
		}
	});

	// Vérifier si des changements ont été effectués en mode édition
	const taskHasChanges = $derived.by(() => {
		if (!editingTaskId) return false;
		const task = tasks.find((t) => t.id === editingTaskId);
		if (!task) return false;
		return (
			newTaskName.trim() !== task.name ||
			(newTaskDescription.trim() || '') !== (task.description || '') ||
			newTaskVolunteers !== task.requiredVolunteers ||
			newTaskType !== task.type
		);
	});

	function ensureSpecificTasks() {
		if (!isTasksModified) {
			isTasksModified = true;
			// On s'assure d'avoir une copie propre des tâches actuelles (venant du master)
			tasks = [...(master.tasks || [])];
		}
	}

	function resetToMasterTasks() {
		isTasksModified = false;
		tasks = [...(master.tasks || [])];
		newTaskName = '';
		newTaskDescription = '';
		editingTaskId = null;
	}

	// Logique de statut dérivé
	const toConfirm = $derived(master.toConfirm ?? false);

	// Statut actuel de l'occurrence
	type EventStatus = 'confirmed' | 'pending' | 'canceled';
	const currentStatus = $derived<EventStatus>(
		isCanceled ? 'canceled' : isConfirmed ? 'confirmed' : 'pending'
	);

	const statusLabel = $derived(
		currentStatus === 'canceled'
			? 'Annulé'
			: currentStatus === 'confirmed'
				? 'Confirmé'
				: toConfirm
					? 'En attente de confirmation'
					: 'Toujours confirmé'
	);

	// ===== Gestion admin des responses =====
	let newParticipantName = $state('');
	let isCreatingParticipant = $state(false);

	// ===== Gestion admin des bénévoles =====
	let taskVolunteerModalOpen = $state(false);
	let selectedTaskForVolunteers = $state<Task | null>(null);
	let newVolunteerName = $state('');
	let isCreatingVolunteer = $state(false);

	// ===== Helpers =====

	// Helper pour récupérer les participants inscrits à une tâche
	function getTaskVolunteers(taskId: string) {
		return occurrence.responses
			.filter((r) => r.tasks?.includes(taskId))
			.map((r) => {
				const participant = master.participants.find((p) => p.id === r.participantId);
				return {
					participantId: r.participantId,
					name: participant?.name || 'Inconnu',
					response: r
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
				respondedAt: new Date().toISOString()
			};

			const updated = await submitResponse(
				occurrence.id,
				participantId,
				newResponse,
				token,
				occurrence
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
				isAdmin: false
			},
			token
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
			newParticipantName = '';
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
		if (responseType !== 'present') {
			const existingResponse = occurrence.responses.find((r) => r.participantId === participantId);
			const onEventInscribed = tasks
				.filter((t) => t.type === 'onEvent' && (existingResponse?.tasks || []).includes(t.id))
				.map((t) => t.id);
			if (onEventInscribed.length > 0) {
				const participant = master.participants.find((p) => p.id === participantId);
				pendingResponseChange = {
					participantId,
					participantName: participant?.name || 'Inconnu',
					targetResponse: responseType,
					onEventTaskIds: onEventInscribed
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
		tasksToRemove?: string[]
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
				respondedAt: new Date().toISOString()
			};

			const updated = await submitResponse(
				occurrence.id,
				participantId,
				newResponse,
				token,
				occurrence
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
			pending.onEventTaskIds
		);
	}

	function cancelResponseChange() {
		pendingResponseChange = null;
	}

	function openVolunteerModal(task: Task) {
		selectedTaskForVolunteers = task;
		taskVolunteerModalOpen = true;
	}

	async function handleAddVolunteer() {
		if (!newVolunteerName.trim() || isCreatingVolunteer || !selectedTaskForVolunteers) return;

		isCreatingVolunteer = true;
		try {
			const newParticipant = await handleCreateParticipant(newVolunteerName.trim());
			// Assigner automatiquement le nouveau participant à la tâche
			await handleToggleVolunteer(newParticipant.id);
			newVolunteerName = '';
			// toast.success('Participant·e ajoutée');
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isCreatingVolunteer = false;
		}
	}

	async function handleToggleVolunteer(participantId: string) {
		const task = selectedTaskForVolunteers;
		if (!task) return;

		try {
			const existingResponse = occurrence.responses.find((r) => r.participantId === participantId);

			// Auto-set "present" pour onEvent si allowResponses
			let responseType: ResponseType = existingResponse?.response || 'present';
			if (task.type === 'onEvent' && master.allowResponses && responseType !== 'present') {
				responseType = 'present';
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
				respondedAt: new Date().toISOString()
			};

			const updated = await submitResponse(
				occurrence.id,
				participantId,
				newResponse,
				token,
				occurrence
			);
			occurrence = updated;
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		}
	}

	async function setStatus(newStatus: EventStatus) {
		isCanceled = newStatus === 'canceled';
		isConfirmed = newStatus === 'confirmed';
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
				tasks: isTasksModified ? sortTasks(tasks) : null
			};

			const updated = await updateOccurrence(occurrence.id, updates, token);

			// Mise à jour manuelle du store pour garantir la réactivité immédiate
			occurrence = updated;

			toast.success('Occurrence mise à jour');
			onClose();
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isSubmitting = false;
		}
	}

	function addTask() {
		if (!newTaskName.trim()) return;
		ensureSpecificTasks();

		if (editingTaskId) {
			tasks = tasks.map((t) =>
				t.id === editingTaskId
					? {
							...t,
							name: newTaskName.trim(),
							description: newTaskDescription.trim() || undefined,
							requiredVolunteers: newTaskVolunteers,
							type: newTaskType
						}
					: t
			);
			editingTaskId = null;
		} else {
			tasks = [
				...tasks,
				{
					id: crypto.randomUUID(),
					name: newTaskName.trim(),
					description: newTaskDescription.trim() || undefined,
					requiredVolunteers: newTaskVolunteers,
					type: newTaskType
				}
			];
		}
		newTaskName = '';
		newTaskDescription = '';
		newTaskVolunteers = 1;
		newTaskType = 'onEvent';
	}

	function removeTask(id: string) {
		ensureSpecificTasks();
		tasks = tasks.filter((t) => t.id !== id);
	}

	function editTask(task: Task) {
		newTaskName = task.name;
		newTaskDescription = task.description || '';
		newTaskVolunteers = task.requiredVolunteers;
		newTaskType = task.type;
		editingTaskId = task.id;
	}

	function cancelEdit() {
		editingTaskId = null;
		newTaskName = '';
		newTaskDescription = '';
		newTaskVolunteers = 1;
	}

	function cancelTaskInput() {
		newTaskName = '';
		newTaskDescription = '';
		newTaskVolunteers = 1;
		newTaskType = 'onEvent';
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
				? `« ${pending.participantName} » est inscrit à ${taskNames.length} tâches nécessitant sa présence : ${taskNames.join(', ')}.`
				: `« ${pending.participantName} » est inscrit à la tâche « ${taskNames[0]} » qui nécessite sa présence.`
		};
	});
</script>

{#snippet actions()}
	<button type="button" class="btn" onclick={onClose}>Annuler</button>
	<button
		type="submit"
		form="occurrence-edit-form"
		class="btn btn-primary px-8"
		disabled={isSubmitting}
	>
		{#if isSubmitting}
			<span class="loading loading-spinner loading-sm"></span>
		{/if}
		Enregistrer <span class="hidden md:flex">les changements</span>
	</button>
{/snippet}

<Modal {open} {onClose} {actions} title=" Modifier l'occurrence" size="lg">
	<NetworkAlert message="Modifications impossibles - Serveur indisponible" />
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
				Statut de l'événement : <span
					class="text-base-content {currentStatus === 'canceled' && 'text-error'}"
					>{statusLabel}</span
				>
			</h4>
			{#if toConfirm}
				<div class="join max-sm:mx-auto" role="radiogroup" aria-label="Statut de l'événement">
					<label
						class="join-item btn btn-sm {currentStatus === 'confirmed'
							? 'btn-success'
							: 'btn-soft'}"
					>
						<input
							type="radio"
							class="hidden"
							name="event-status"
							checked={currentStatus === 'confirmed'}
							onchange={() => setStatus('confirmed')}
						/>
						<CheckCircle size={16} class="mr-2" />
						Confirmé
					</label>
					<label
						class="join-item btn btn-sm {currentStatus === 'pending' ? 'btn-warning' : 'btn-soft'}"
					>
						<input
							type="radio"
							class="hidden"
							name="event-status"
							checked={currentStatus === 'pending'}
							onchange={() => setStatus('pending')}
						/>
						<Clock size={16} class="mr-2" />
						En attente
					</label>
					<label
						class="join-item btn btn-sm {currentStatus === 'canceled' ? 'btn-error' : 'btn-soft'}"
					>
						<input
							type="radio"
							class="hidden"
							name="event-status"
							checked={currentStatus === 'canceled'}
							onchange={() => setStatus('canceled')}
						/>
						<XCircle size={16} class="mr-2" />
						Annulé
					</label>
				</div>
			{:else if currentStatus !== 'canceled'}
				<p class="text-base-content/80 text-sm">
					Ce planning est configuré de façon à ce que ses événements soient toujours considérés
					comme ayant lieu. Vous pouvez cependant annuler une date spécifique. <button
						class="link link-error"
						onclick={() => setStatus('canceled')}>annuler cette date</button
					>
				</p>
			{:else}
				<p class="text-base-content/80">
					Cette date a été annulée. <button
						class="link link-error"
						onclick={() => setStatus('pending')}>réactiver cette date</button
					>
				</p>
			{/if}
		</div>
		<fieldset disabled={isNetworkUnavailable || currentStatus === 'canceled'}>
			<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
				<!-- Horaires -->
				<div class="">
					<h4 class="flex items-center gap-2 font-medium">
						<Clock size={18} class="text-primary" />
						Horaires
					</h4>
					<div class="grid grid-cols-2 gap-4">
						<fieldset class="fieldset">
							<legend class="fieldset-legend">Début</legend>
							<input type="time" bind:value={startTime} class="input w-full" required />
						</fieldset>
						<fieldset class="fieldset">
							<legend class="fieldset-legend">Fin</legend>
							<input type="time" bind:value={endTime} class="input w-full" required />
						</fieldset>
					</div>
				</div>

				<!-- Lieu -->
				<div class="">
					<h4 class="flex items-center gap-2 font-medium">
						<MapPin size={18} class="text-primary" />
						Lieu
					</h4>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Lieu spécifique</legend>
						<input
							type="text"
							bind:value={place}
							class="input w-full"
							placeholder={master.place || 'Lieu par défaut'}
						/>
					</fieldset>
				</div>
			</div>

			<!-- Description -->
			<div class="space-y-2">
				<h4 class="flex items-center gap-2 font-medium">
					<AlignLeft size={18} class="text-primary" />
					Description
				</h4>
				<textarea
					bind:value={description}
					class="textarea h-24 w-full"
					placeholder="Notes spécifiques pour cette occurrence..."
				></textarea>
			</div>

			<div class="divider"></div>

			<!-- Paramètres de réponse -->
			<div class="space-y-4">
				<h4 class="flex items-center gap-2 font-medium">
					<Users size={18} class="text-primary" />
					Présences
				</h4>

				<div class="space-y-2 md:max-w-1/2">
					<label class="label-text font-medium"
						>Présences minimum souhaitées
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
						Gérer les réponses des participants
					</h4>

					<div class="space-y-2">
						{#each master.participants as participant (participant.id)}
							{#key participant.id}
								{@const response = occurrence.responses.find(
									(r) => r.participantId === participant.id
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
													{config.label}
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
							placeholder="Nouveau participant..."
							onkeydown={(e) => {
								if (e.key === 'Enter') {
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
							title="Ajouter"
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
			<div class="space-y-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<h4 class="flex items-center gap-2 font-medium">
						<ClipboardCheck size={18} class="text-primary" />
						Liste des tâches
					</h4>
					<div class="flex flex-wrap items-center gap-2">
						{#if isTasksModified}
							<span class="badge badge-warning h-auto font-medium"
								><CircleAlert class="size-4" /> Certaines tâches sont spécifiques à cette date</span
							>
							<button
								type="button"
								class="btn btn-soft btn-error btn-sm sm:btn-xs"
								onclick={resetToMasterTasks}
							>
								<RefreshCcw class="size-3" />
								Rétablir les tâches communes à toutes les dates ({masterTasks?.length ?? 0})
							</button>
						{:else if !isTasksModified && masterTasks?.length > 0}
							<span class="badge badge-info badge-soft h-auto font-medium"
								><CircleAlert class="size-4" /> Tâches communes à toutes les dates</span
							>
						{/if}
					</div>
				</div>

				<div class="space-y-2">
					{#each tasks as task (task.id)}
						{@const taskVolunteers = getTaskVolunteers(task.id)}
						<div
							class="bg-base-200 flex gap-3 rounded-lg p-3 {editingTaskId === task.id
								? 'ring-primary ring-2 ring-offset-2'
								: ''}"
						>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
									<div class="text-sm font-medium">{task.name}</div>
									<div class="text-sm opacity-60">
										{task.requiredVolunteers} pers. • {task.type === 'beforeEvent'
											? 'Avant'
											: task.type === 'onEvent'
												? 'Pendant'
												: 'Après'}
									</div>
								</div>

								<!-- Badges des participants inscrits -->
								<div class="mt-2 flex flex-wrap items-center gap-2 pl-1">
									{#if taskVolunteers.length > 0}
										{#each taskVolunteers as volunteer (volunteer.participantId)}
											<div class="badge md:badge-lg bg-accent flex items-center gap-1 pe-0.5">
												{volunteer.name}
												<button
													type="button"
													class="btn btn-error btn-sm sm:btn-xs btn-soft btn-circle m-1 ml-2 size-4"
													onclick={() =>
														handleRemoveVolunteerFromTask(task.id, volunteer.participantId)}
													aria-label="Retirer {volunteer.name} de cette tâche"
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
											{taskVolunteers.length > 0 ? 'Gérer les inscrits' : 'Ajouter'}
										</button>
									</div>
								</div>
							</div>
							<!-- Boutons d'action alignés à droite -->
							<div class="flex shrink-0 flex-col justify-between">
								<button
									type="button"
									class="btn btn-ghost sm:btn-sm btn-circle"
									title="Modifier cette tâche"
									onclick={() => editTask(task)}
								>
									<Pencil size={14} />
								</button>
								<button
									type="button"
									class="btn btn-ghost sm:btn-sm btn-circle text-error"
									title="Supprimer cette tâche pour cet événement"
									onclick={() => removeTask(task.id)}
								>
									<Trash2 size={14} />
								</button>
							</div>
						</div>
					{/each}
				</div>

				<div class="space-y-3">
					<div class="bg-base-200/50 space-y-3 rounded-xl p-4">
						<div class="grid grid-cols-1 items-baseline gap-3 sm:grid-cols-2">
							{#if editingTaskId}
								<div
									class="alert alert-info alert-outline rounded-lg py-2 text-sm"
									transition:slide
								>
									<Pencil size={16} />
									<span>Modification de la tâche sélectionnée}</span>
								</div>
							{/if}
							<fieldset class="fieldset">
								<label class="input w-full">
									<input
										type="text"
										bind:value={newTaskName}
										bind:this={taskNameInput}
										placeholder="Nom de la tâche"
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												addTask();
											}
										}}
									/>
									<!-- Bouton + intégré visible uniquement en mobile -->
									<button
										type="button"
										class="btn btn-primary btn-circle btn-sm hidden max-sm:flex"
										onclick={addTask}
										disabled={newTaskName.trim().length === 0 ||
											(editingTaskId !== null && !taskHasChanges)}
										title="Ajouter la tâche"
									>
										<Plus size={16} />
									</button>
								</label>
							</fieldset>
							<div class="grid grid-cols-2 gap-3">
								<fieldset class="fieldset">
									<legend class="fieldset-legend">Participant·es requis·ses</legend>
									<input
										type="number"
										bind:value={newTaskVolunteers}
										class="input w-full"
										min="1"
										placeholder="Nb."
									/>
								</fieldset>
								<fieldset class="fieldset">
									<legend class="fieldset-legend">Moment</legend>
									<select bind:value={newTaskType} class="select w-full">
										<option value="beforeEvent">Avant</option>
										<option value="onEvent">Pendant</option>
										<option value="afterEvent">Après</option>
									</select>
								</fieldset>
							</div>
						</div>
						<!-- <fieldset class="fieldset">
						<legend class="fieldset-legend">Description (optionnel)</legend>
						<textarea
							bind:value={newTaskDescription}
							class="textarea textarea-sm w-full"
							placeholder="Instructions pour les bénévoles..."
						></textarea>
					</fieldset> -->
						<div class="flex gap-2">
							{#if !editingTaskId && newTaskName.trim().length > 0}
								<button
									type="button"
									class="btn sm:btn-sm btn-ghost"
									onclick={cancelTaskInput}
									disabled={isSubmitting}
								>
									Annuler
								</button>
							{/if}
							{#if editingTaskId}
								<button type="button" class="btn sm:btn-sm btn-ghost" onclick={cancelEdit}
									>Annuler</button
								>
							{/if}
							<button
								type="button"
								class="btn sm:btn-sm btn-primary grow"
								onclick={addTask}
								disabled={newTaskName.trim().length === 0 ||
									(editingTaskId !== null && !taskHasChanges)}
							>
								{editingTaskId ? 'Modifier la tâche' : 'Ajouter la tâche'}
							</button>
						</div>
					</div>
				</div>
			</div>
		</fieldset>
	</form>
</Modal>

<!-- Modal de gestion des bénévoles -->
<Modal
	bind:open={taskVolunteerModalOpen}
	title={selectedTaskForVolunteers?.name}
	size="md"
	onClose={() => (taskVolunteerModalOpen = false)}
>
	{#if selectedTaskForVolunteers}
		<div class="space-y-4">
			<div class="text-sm opacity-70">
				{selectedTaskForVolunteers.requiredVolunteers} personne·s requise·s •
				{selectedTaskForVolunteers.type === 'onEvent'
					? 'Pendant'
					: selectedTaskForVolunteers.type === 'beforeEvent'
						? 'Avant'
						: 'Après'}
			</div>

			<!-- Info pour tâches onEvent -->
			{#if selectedTaskForVolunteers.type === 'onEvent' && master.allowResponses}
				<div class="alert alert-info">
					<Info size={16} />
					Les participants assignés seront automatiquement marqués "Présent"
				</div>
			{/if}

			<!-- Checkboxes pour chaque participant -->
			<div class="flex flex-wrap gap-2">
				{#each master.participants as participant (participant.id)}
					{@const isVolunteer = occurrence.responses
						.find((r) => r.participantId === participant.id)
						?.tasks?.includes(selectedTaskForVolunteers.id)}
					<label class="btn-sm btn flex gap-1 {isVolunteer ? 'btn-primary' : 'btn-soft'}">
						<input
							type="checkbox"
							class="check check-sm"
							checked={isVolunteer}
							onchange={() => handleToggleVolunteer(participant.id)}
						/>
						{participant.name}
					</label>
				{/each}
			</div>

			<!-- Ajouter un nouveau bénévole -->
			<label class="input mt-2 w-full">
				<input
					type="text"
					bind:value={newVolunteerName}
					placeholder="Ajouter un·e participant·e..."
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							handleAddVolunteer();
						}
					}}
				/>
				<button
					type="button"
					class="btn btn-primary btn-circle btn-sm"
					onclick={handleAddVolunteer}
					disabled={isCreatingVolunteer || !newVolunteerName.trim()}
					title="Ajouter"
				>
					{#if isCreatingVolunteer}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<Plus size={16} />
					{/if}
				</button>
			</label>

			<div class="modal-action">
				<button type="button" class="btn" onclick={() => (taskVolunteerModalOpen = false)}>
					Fermer
				</button>
			</div>
		</div>
	{/if}
</Modal>

{#if responseChangeModal}
	<ConfirmModal
		open={pendingResponseChange !== null}
		onClose={cancelResponseChange}
		onConfirm={confirmResponseChange}
		title="Présence requise"
		message={responseChangeModal.message}
		description="Changer sa réponse le désinscrira de cette ou ces tâche(s)."
		confirmLabel="Changer la réponse"
		variant="warning"
	/>
{/if}
