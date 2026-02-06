<script lang="ts">
	import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_CONFIG } from '$lib/constants';
	import {
		addParticipant,
		sortTasks,
		submitResponse,
		updateOccurrence
	} from '$lib/services/planningActions';
	import { planningStore } from '$lib/stores/planningStore.svelte';
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
		Trash2,
		User,
		UserPlus,
		Users,
		X,
		XCircle
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmModal from '../ui/ConfirmModal.svelte';
	import Modal from '../ui/Modal.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		occurrence: PlanningOccurrence;
		master: PlanningMaster;
		token: string;
	}

	let { open = $bindable(false), onClose, occurrence, master, token }: Props = $props();

	let isSubmitting = $state(false);

	// États du formulaire (initialisés avec les valeurs de l'occurrence ou héritées du master)
	let startTime = $state(occurrence.startTime);
	let endTime = $state(occurrence.endTime);
	let place = $state(occurrence.place ?? '');
	let description = $state(occurrence.description ?? '');
	let isConfirmed = $state(occurrence.isConfirmed);
	let isCanceled = $state(occurrence.isCanceled);
	let minPresentRequired = $state(
		occurrence.minPresentRequired && occurrence.minPresentRequired > 0
			? occurrence.minPresentRequired
			: master.minPresentRequired
	);

	// Tâches
	let isTasksModified = $state(
		occurrence.tasks !== null && occurrence.tasks !== undefined && occurrence.tasks.length > 0
	);
	let tasks = $state<Task[]>(
		occurrence.tasks && occurrence.tasks.length > 0
			? [...occurrence.tasks]
			: [...(master.tasks || [])]
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

	let showCancelConfirm = $state(false);

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
			planningStore.updateOccurrence(occurrence);
		} catch (error) {
			console.error('Error removing volunteer from task:', error);
			toast.error('Erreur lors de la suppression');
		}
	}

	async function handleCreateParticipant(name: string): Promise<Participant> {
		const updatedMaster = await addParticipant(
			master.id,
			{
				name,
				isAdmin: false,
				notifyOnMissingParticipants: false
			},
			token
		);

		// Mettre à jour master localement pour réactivité
		master = updatedMaster;
		planningStore.setMaster(updatedMaster);

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
			console.error('Error creating participant:', error);
			toast.error('Erreur lors de la création');
		} finally {
			isCreatingParticipant = false;
		}
	}

	async function handleResponseChange(participantId: string, responseType: ResponseType) {
		try {
			const existingResponse = occurrence.responses.find((r) => r.participantId === participantId);

			const newResponse: ParticipantResponse = {
				participantId,
				response: responseType,
				tasks: existingResponse?.tasks || [],
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
			planningStore.updateOccurrence(occurrence);
		} catch (error) {
			console.error('Error updating response:', error);
			toast.error('Erreur lors de la mise à jour');
		}
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
			console.error('Error creating volunteer:', error);
			toast.error('Erreur lors de la création');
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
			planningStore.updateOccurrence(occurrence);
		} catch (error) {
			console.error('Error toggling volunteer:', error);
			toast.error('Erreur lors de la modification');
		}
	}

	async function setStatus(newStatus: 'confirmed' | 'canceled' | 'pending') {
		if (newStatus === 'canceled') {
			showCancelConfirm = true;
			return;
		}

		isCanceled = false;
		isConfirmed = newStatus === 'confirmed';
	}

	function confirmCancel() {
		showCancelConfirm = false;
		isCanceled = true;
		isConfirmed = false;
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

			const updated = await updateOccurrence(occurrence.id, updates, token, occurrence);

			// Mise à jour manuelle du store pour garantir la réactivité immédiate
			planningStore.updateOccurrence(updated);

			toast.success('Occurrence mise à jour');
			onClose();
		} catch (error) {
			console.error('Update occurrence error:', error);
			toast.error('Erreur lors de la mise à jour');
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
</script>

<Modal {open} {onClose} title="Modifier l'occurrence" size="lg">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		class="space-y-6"
	>
		<!-- Statut et Actions Rapides -->
		<div class="flex flex-col gap-3">
			<h4 class="text-sm font-bold opacity-60">Statut de l'événement</h4>
			<div class="flex flex-wrap gap-2">
				{#if isCanceled}
					<button
						type="button"
						class="btn btn-error btn-sm grow"
						onclick={() => setStatus(toConfirm ? 'pending' : 'confirmed')}
					>
						<XCircle size={16} class="mr-2" />
						Événement annulé (cliquer pour rétablir)
					</button>
				{:else}
					{#if toConfirm}
						<button
							type="button"
							class="btn btn-sm grow {isConfirmed ? 'btn-success' : 'btn-outline'}"
							onclick={() => setStatus('confirmed')}
						>
							<CheckCircle size={16} class="mr-2" />
							{isConfirmed ? 'Confirmé' : 'Confirmer la tenue'}
						</button>
						{#if isConfirmed}
							<button
								type="button"
								class="btn btn-outline btn-sm"
								onclick={() => setStatus('pending')}
							>
								Remettre en attente
							</button>
						{/if}
					{/if}

					<button
						type="button"
						class="btn btn-outline btn-error btn-sm {toConfirm ? '' : 'grow'}"
						onclick={() => setStatus('canceled')}
					>
						<XCircle size={16} class="mr-2" />
						Annuler l'événement
					</button>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
			<!-- Horaires -->
			<div class="space-y-4">
				<h4 class="flex items-center gap-2 font-bold">
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
			<div class="space-y-4">
				<h4 class="flex items-center gap-2 font-bold">
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
			<h4 class="flex items-center gap-2 font-bold">
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
			<h4 class="flex items-center gap-2 font-bold">
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
		<div class="space-y-4">
			<h4 class="flex items-center gap-2 font-bold">
				<UserPlus size={18} class="text-primary" />
				Gérer les réponses des participants
			</h4>

			<div class="space-y-2">
				{#each master.participants as participant (participant.id)}
					{#key participant.id}
						{@const response = occurrence.responses.find((r) => r.participantId === participant.id)}
						<div class="bg-base-200 rounded-box px-4 py-1">
							<div class="flex items-center justify-between gap-4 max-sm:flex-col">
								<div class="self-start font-medium">
									<User class="me-1 inline size-4 opacity-70" />
									{participant.name}
								</div>

								<div class=" flex flex-wrap gap-x-4 gap-y-2">
									{#each AVAILABLE_RESPONSE_TYPES as type (type)}
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
			<div class="join mt-2">
				<input
					type="text"
					bind:value={newParticipantName}
					class="input join-item grow"
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
					class="btn btn-primary join-item"
					onclick={handleAddParticipant}
					disabled={isCreatingParticipant || !newParticipantName.trim()}
				>
					{#if isCreatingParticipant}
						<span class="loading loading-spinner loading-sm"></span>
					{:else}
						<Plus size={14} />
					{/if}
				</button>
			</div>
		</div>

		<div class="divider"></div>

		<!-- Tâches -->
		<div class="space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h4 class="flex items-center gap-2 font-bold">
					<ClipboardCheck size={18} class="text-primary" />
					Liste des tâches
				</h4>
				<div class="flex items-center gap-2">
					{#if isTasksModified}
						<span class="badge badge-warning badge-soft font-medium"
							><CircleAlert class="size-4" /> Tâches spécifiques à cette date</span
						>
						<button
							type="button"
							class="btn btn-ghost btn-xs text-error"
							onclick={resetToMasterTasks}
						>
							Rétablir les tâches communes à toutes les dates
						</button>
					{:else}
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
						class="bg-base-200 flex flex-col gap-2 rounded-lg p-3 {editingTaskId === task.id
							? 'ring-primary ring-2 ring-offset-2'
							: ''}"
					>
						<div class="flex items-center gap-3">
							<div class="flex flex-1 flex-wrap items-center gap-3">
								<div class="text-sm font-bold">{task.name}</div>
								<div class="text-sm opacity-60">
									{task.requiredVolunteers} pers. • {task.type === 'beforeEvent'
										? 'Avant'
										: task.type === 'onEvent'
											? 'Pendant'
											: 'Après'}
								</div>
							</div>
							<div class="flex gap-1">
								<button
									type="button"
									class="btn btn-ghost btn-sm btn-circle"
									onclick={() => editTask(task)}
								>
									<Pencil size={14} />
								</button>
								<button
									type="button"
									class="btn btn-ghost btn-sm btn-circle text-error"
									onclick={() => removeTask(task.id)}
								>
									<Trash2 size={14} />
								</button>
							</div>
						</div>

						<!-- Badges des participants inscrits -->
						<div class="flex flex-wrap items-center gap-2 pl-1">
							{#if taskVolunteers.length > 0}
								{#each taskVolunteers as volunteer (volunteer.participantId)}
									<div class="badge md:badge-lg bg-accent flex items-center gap-1 pe-0.5">
										{volunteer.name}
										<button
											type="button"
											class="btn btn-error btn-xs btn-soft btn-circle m-1 ml-2 size-4"
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
									class="btn btn-outline btn-xs gap-1"
									onclick={() => openVolunteerModal(task)}
								>
									<Users size={12} />
									{taskVolunteers.length > 0 ? 'Gérer les inscrits' : 'Ajouter'}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>

			<div class="space-y-3">
				{#if editingTaskId}
					<div class="alert alert-info rounded-lg py-2 text-sm">
						<Pencil size={16} />
						<span>Modification de la tâche en cours</span>
					</div>
				{/if}

				<div class="bg-base-200/50 space-y-3 rounded-xl p-4">
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<fieldset class="fieldset">
							<legend class="fieldset-legend">Nom de la tâche</legend>
							<input
								type="text"
								bind:value={newTaskName}
								bind:this={taskNameInput}
								class="input input-sm w-full"
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										addTask();
									}
								}}
							/>
						</fieldset>
						<div class="grid grid-cols-2 gap-3">
							<fieldset class="fieldset">
								<legend class="fieldset-legend">Pariticpant·es</legend>
								<input
									type="number"
									bind:value={newTaskVolunteers}
									class="input input-sm w-full"
									min="1"
								/>
							</fieldset>
							<fieldset class="fieldset">
								<legend class="fieldset-legend">Moment</legend>
								<select bind:value={newTaskType} class="select select-sm w-full">
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
						<button
							type="button"
							class="btn btn-sm btn-primary grow"
							onclick={addTask}
							disabled={newTaskName.trim().length === 0 ||
								(editingTaskId !== null && !taskHasChanges)}
						>
							{editingTaskId ? 'Modifier la tâche' : 'Ajouter la tâche'}
						</button>
						{#if editingTaskId}
							<button type="button" class="btn btn-sm btn-ghost" onclick={cancelEdit}
								>Annuler</button
							>
						{/if}
					</div>
				</div>
			</div>

			<div class="modal-action">
				<button type="button" class="btn" onclick={onClose}>Annuler</button>
				<button type="submit" class="btn btn-primary px-8" disabled={isSubmitting}>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Enregistrer <span class="hidden md:flex">les changements</span>
				</button>
			</div>
		</div>
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
			<div class="join mt-2">
				<input
					type="text"
					bind:value={newVolunteerName}
					class="input join-item grow"
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
					class="btn btn-primary join-item"
					onclick={handleAddVolunteer}
					disabled={isCreatingVolunteer || !newVolunteerName.trim()}
				>
					{#if isCreatingVolunteer}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<Plus size={14} />
					{/if}
				</button>
			</div>

			<div class="modal-action">
				<button type="button" class="btn" onclick={() => (taskVolunteerModalOpen = false)}>
					Fermer
				</button>
			</div>
		</div>
	{/if}
</Modal>

<ConfirmModal
	bind:open={showCancelConfirm}
	onClose={() => (showCancelConfirm = false)}
	onConfirm={confirmCancel}
	title="Annuler l'événement"
	message="Voulez-vous vraiment annuler cet événement ?"
	description="Les participants en seront informés par notification."
	confirmLabel="Oui, annuler"
	variant="danger"
/>
