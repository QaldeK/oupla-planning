<script lang="ts">
	import type {
		RecurrenceConfig,
		Task,
		PlanningMaster,
		TaskType,
		ResponseType
	} from '$lib/types/planning.types';
	import MultiSelect from './MultiSelect.svelte';
	import MultiDatePicker from './ui/MultiDatePicker.svelte';
	import { Plus, Trash2, Calendar, Clock, MapPin, AlignLeft, Pencil, X } from 'lucide-svelte';
	import { generateRecurrenceDates, getRecurrenceLabel } from '$lib/utils/recurrence';
	import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_LABELS } from '$lib/constants';
	import { toast } from 'svelte-sonner';
	import { format, parse, compareAsc, addWeeks, addMonths } from 'date-fns';
	import { fr } from 'date-fns/locale';
	import { untrack } from 'svelte';

	interface Props {
		master?: PlanningMaster; // Si présent, on est en mode édition
		onSubmit: (data: PlanningFormData) => Promise<void>;
		isSubmitting?: boolean;
		datesWithData?: string[]; // Liste des dates (YYYY-MM-DD) ayant des réponses ou commentaires
		datesWithSpecificTasks?: string[]; // Liste des dates ayant des tâches personnalisées
	}

	export interface PlanningFormData {
		title: string;
		description?: string;
		place?: string;
		defaultStartTime: string;
		defaultEndTime: string;
		recurrence: RecurrenceConfig;
		tasks: Task[];
		minPresentRequired: number;
		allowResponses: boolean;
		toConfirm?: boolean;
		availableResponseTypes?: ResponseType[];
		forceTaskRefresh?: boolean;
	}

	let {
		master,
		onSubmit,
		isSubmitting = $bindable(false),
		datesWithData = [],
		datesWithSpecificTasks = []
	}: Props = $props();

	// Formulaire (initialisé avec le master si présent)
	const m = (() => master)() || {};
	const {
		title: initTitle = '',
		description: initDesc = '',
		place: initPlace = '',
		defaultStartTime: initStartTime = '19:00',
		defaultEndTime: initEndTime = '21:00',
		minPresentRequired: initMinPresent = 1,
		allowResponses: initAllowResponses = true,
		toConfirm: initToConfirm = false,
		recurrence = {},
		tasks: initTasks = []
	} = m as any;

	const {
		type: initRecType = 'WEEKLY',
		firstDate: initFirstDate = '',
		lastDate: initLastDate = '',
		monthlyByDayOccurrences: initMonthlyByDay = [],
		recurrenceDates: initRecDates = []
	} = recurrence || {};

	let title = $state(initTitle || '');
	let description = $state(initDesc || '');
	let place = $state(initPlace || '');
	let defaultStartTime = $state(initStartTime || '19:00');
	let defaultEndTime = $state(initEndTime || '21:00');
	let minPresentRequired = $state(initMinPresent ?? 1);
	let allowResponses = $state(initAllowResponses ?? true);
	let toConfirm = $state(initToConfirm ?? false);

	// Récurrence
	let recurrenceType = $state(initRecType || 'WEEKLY');
	let firstDate = $state(initFirstDate || '');
	let lastDate = $state(initLastDate || '');
	let monthlyByDayOccurrences = $state<number[]>(initMonthlyByDay || []);
	let recurrenceDates = $state<string[]>(initRecDates || []);

	// === Mode CUSTOM et dates arbitraires ===
	let customDates = $state<string[]>(initRecType === 'CUSTOM' ? initRecDates || [] : []); // Dates pour le mode CUSTOM
	let showArbitraryDatePicker = $state(false); // Afficher le picker inline pour dates arbitraires

	// Calculer les dates arbitraires (dates ajoutées manuellement hors du cycle généré)
	const arbitraryDates = $derived.by(() => {
		if (recurrenceType === 'CUSTOM') return [];
		const generatedSet = new Set(allGeneratedDates);
		return recurrenceDates.filter((d) => !generatedSet.has(d));
	});

	// Toutes les dates à afficher (générées + arbitraires triées par ordre chronologique)
	const allDatesToDisplay = $derived.by(() => {
		if (recurrenceType === 'CUSTOM') {
			return customDates;
		}
		return [...new Set([...allGeneratedDates, ...arbitraryDates])].sort();
	});

	// Tâches
	let tasks = $state<Task[]>(initTasks || []);
	let newTaskName = $state('');
	let newTaskDescription = $state('');
	let newTaskVolunteers = $state(1);
	let newTaskType = $state<TaskType>('onEvent');
	let forceTaskRefresh = $state(false);

	let availableResponseTypes = $state<ResponseType[]>(
		untrack(() => {
			if (!master) {
				return allowResponses ? [...AVAILABLE_RESPONSE_TYPES] : [];
			}
			return master.availableResponseTypes || (allowResponses ? [...AVAILABLE_RESPONSE_TYPES] : []);
		})
	);

	// === Édition de tâches ===
	let editingTaskId = $state<string | null>(null);
	const isEditingTask = $derived(editingTaskId !== null);
	const taskSubmitButtonLabel = $derived(isEditingTask ? 'Modifier' : 'Ajouter');

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

	// === État de validation ===
	let validationErrors = $state<{
		title?: boolean;
		dates?: boolean;
		responses?: boolean;
		tasks?: boolean;
		taskInProgress?: boolean;
	}>({});

	let hasAttemptedSubmit = $state(false);

	let isMounted = $state(false);
	let lastRecurrenceType = $state(initRecType);
	let prevAllGeneratedDates = $state<string[]>([]);
	// Note: En création, l'utilisateur peut modifier manuellement lastDate, mais elle sera réinitialisée
	// automatiquement si firstDate ou recurrenceType change. Comportement acceptable pour KISS.
	let lastDateWasManuallySet = $state(!!(() => master)());

	$effect(() => {
		isMounted = true;
	});

	// Calcul automatique de la date de fin
	$effect(() => {
		if (!isMounted || master || lastDateWasManuallySet) return;
		if (!firstDate || !recurrenceType) return;

		untrack(() => {
			const start = parse(firstDate, 'yyyy-MM-dd', new Date());
			let end: Date;

			switch (recurrenceType) {
				case 'DAILY':
					end = addWeeks(start, 1);
					break;
				case 'WEEKLY':
				case 'BIWEEKLY':
					end = addMonths(start, 6);
					break;
				case 'MONTHLY_BY_DATE':
				case 'MONTHLY_BY_DAY':
					end = addMonths(start, 12);
					break;
				default:
					return;
			}

			lastDate = format(end, 'yyyy-MM-dd');
		});
	});

	// Synchroniser les dates si la configuration de base change
	$effect(() => {
		// On s'abonne uniquement aux changements structurels
		const gen = allGeneratedDates;
		const type = recurrenceType;

		untrack(() => {
			if (!isMounted) return;

			// En mode CUSTOM, ne pas exécuter la logique de synchronisation automatique
			// car allGeneratedDates retourne [] et cela supprimerait toutes les dates
			if (type === 'CUSTOM') return;

			// FIX: Premier run en mode édition - on initialise seulement prevAllGeneratedDates
			// sans toucher à recurrenceDates (qui contient déjà la sélection sauvegardée)
			if (master && prevAllGeneratedDates.length === 0) {
				prevAllGeneratedDates = [...gen];
				lastRecurrenceType = type;
				return;
			}

			const currentSelected = new Set(recurrenceDates);

			if (type !== lastRecurrenceType) {
				// Nouveau type : on reset tout par défaut
				recurrenceDates = [...gen];
				lastRecurrenceType = type;
				prevAllGeneratedDates = [...gen];
				return;
			}

			// Changement de bornes ou de paramètres (mais même type)
			// 1. Ajouter les nouvelles dates générées qui n'existaient pas avant
			const added = gen.filter((d) => !prevAllGeneratedDates.includes(d));
			if (added.length > 0 && (master ? isMounted : true)) {
				added.forEach((d) => currentSelected.add(d));
			}

			// 2. Retirer les dates qui ne font plus partie du cycle généré
			const genSet = new Set(gen);
			for (const d of currentSelected) {
				if (!genSet.has(d)) {
					currentSelected.delete(d);
				}
			}

			const nextList = Array.from(currentSelected).sort();
			const currentList = [...recurrenceDates].sort();

			if (JSON.stringify(nextList) !== JSON.stringify(currentList)) {
				recurrenceDates = nextList;
			}

			prevAllGeneratedDates = [...gen];
		});
	});

	// Synchroniser les dates au chargement si on est en mode création
	$effect(() => {
		if (!isMounted || master) return;
		if (recurrenceDates.length === 0 && allGeneratedDates.length > 0) {
			recurrenceDates = [...allGeneratedDates];
		}
	});

	// Effet pour synchroniser allowResponses avec availableResponseTypes
	$effect(() => {
		if (!allowResponses) {
			availableResponseTypes = [];
		} else if (availableResponseTypes.length === 0) {
			// Réactiver les types de réponse
			if (!master) {
				// En création : recocher tous par défaut
				availableResponseTypes = [...AVAILABLE_RESPONSE_TYPES];
			} else {
				// En édition : restaurer les types originaux sauvegardés
				availableResponseTypes = master.availableResponseTypes || [...AVAILABLE_RESPONSE_TYPES];
			}
		}
	});

	// Effet pour effacer les erreurs de validation quand l'utilisateur corrige
	$effect(() => {
		if (!hasAttemptedSubmit) return;

		// Effacer l'erreur du titre si corrigé
		if (validationErrors.title && title.trim()) {
			validationErrors.title = false;
		}

		// Effacer l'erreur des dates si corrigé
		if (validationErrors.dates && recurrenceDates.length > 0) {
			const today = format(new Date(), 'yyyy-MM-dd');
			const hasValidDates = recurrenceDates.some((d) => d >= today);
			if (hasValidDates) {
				validationErrors.dates = false;
			}
		}

		// Effacer l'erreur des responses si corrigé
		if (validationErrors.responses) {
			const hasTasks = tasks.length > 0;
			const hasResponseTypes = availableResponseTypes.length > 0;
			const isValidResponses = !allowResponses || hasResponseTypes;
			if (hasTasks || isValidResponses) {
				validationErrors.responses = false;
			}
		}

		// Effacer l'erreur des tasks si corrigé
		if (validationErrors.tasks && tasks.length > 0) {
			validationErrors.tasks = false;
		}

		// Effacer l'erreur de tâche en cours si corrigé
		if (validationErrors.taskInProgress && !newTaskName.trim()) {
			validationErrors.taskInProgress = false;
		}
	});

	function addTask() {
		if (!newTaskName.trim()) {
			toast.error('Le nom de la tâche est requis');
			return;
		}

		if (isEditingTask && editingTaskId) {
			// Mode édition : mettre à jour la tâche existante
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
			// toast.success('Tâche modifiée');
		} else {
			// Mode création : ajouter une nouvelle tâche
			const task: Task = {
				id: crypto.randomUUID(),
				name: newTaskName.trim(),
				description: newTaskDescription.trim() || undefined,
				requiredVolunteers: newTaskVolunteers,
				type: newTaskType
			};

			tasks = [...tasks, task];
			// toast.success('Tâche ajoutée');
		}

		resetTaskForm();
	}

	function removeTask(taskId: string) {
		tasks = tasks.filter((t) => t.id !== taskId);
	}

	function editTask(taskId: string) {
		const task = tasks.find((t) => t.id === taskId);
		if (!task) return;

		newTaskName = task.name;
		newTaskDescription = task.description || '';
		newTaskVolunteers = task.requiredVolunteers;
		newTaskType = task.type;
		editingTaskId = taskId;
	}

	function cancelTaskEdit() {
		resetTaskForm();
	}

	function resetTaskForm() {
		newTaskName = '';
		newTaskDescription = '';
		newTaskVolunteers = 1;
		newTaskType = 'onEvent';
		editingTaskId = null;
	}

	function toggleDateSelection(dateToToggle: string) {
		const isSelected = recurrenceDates.includes(dateToToggle);
		if (isSelected) {
			recurrenceDates = recurrenceDates.filter((d) => d !== dateToToggle);
		} else {
			// Vérifier la limite de 100 dates futures avant d'ajouter
			const today = format(new Date(), 'yyyy-MM-dd');
			const futureDatesCount = recurrenceDates.filter((d) => d >= today).length;

			if (futureDatesCount >= 100 && dateToToggle >= today) {
				// Limite atteinte, ne pas ajouter la date
				return;
			}

			const newDates = [...recurrenceDates, dateToToggle];
			newDates.sort((a, b) =>
				compareAsc(parse(a, 'yyyy-MM-dd', new Date()), parse(b, 'yyyy-MM-dd', new Date()))
			);
			recurrenceDates = newDates;
		}
	}

	// Supprimer une date arbitraire
	function removeArbitraryDate(dateToRemove: string) {
		recurrenceDates = recurrenceDates.filter((d) => d !== dateToRemove);
	}

	async function handleSubmit() {
		// Marquer qu'une tentative de soumission a eu lieu
		hasAttemptedSubmit = true;

		// Reset des erreurs
		validationErrors = {};

		// Validation : nombre de dates futures max 100
		const datesToValidate = recurrenceType === 'CUSTOM' ? customDates : recurrenceDates;
		const today = format(new Date(), 'yyyy-MM-dd');
		const futureDatesCount = datesToValidate.filter((d) => d >= today).length;
		if (futureDatesCount > 100) {
			toast.error('Nombre de dates futures trop élevé', {
				description: `Vous avez sélectionné ${futureDatesCount} dates futures. La limite est de 100 dates futures.`
			});
			return;
		}

		// Validation : au moins une date pour CUSTOM
		if (recurrenceType === 'CUSTOM' && customDates.length === 0) {
			toast.error('Aucune date sélectionnée', {
				description: 'Veuillez sélectionner au moins une date pour le mode "Choix libre des dates".'
			});
			return;
		}

		// Validation du titre
		if (!title.trim()) {
			validationErrors.title = true;
			toast.error('Le titre est requis');
			return;
		}

		// Validation : tâche en cours de création/modification
		if (newTaskName.trim()) {
			validationErrors.taskInProgress = true;
			toast.error('Tâche en cours de saisie', {
				description:
					isEditingTask && editingTaskId
						? "Veuillez terminer la modification de la tâche en cours ou l'annuler avant de sauvegarder."
						: 'Veuillez terminer la création de la tâche en cours avant de sauvegarder.'
			});
			return;
		}

		// Validation : au moins une tâche OU allowResponses activé
		const hasTasks = tasks.length > 0;
		const hasResponsesEnabled = allowResponses;

		if (!hasTasks && !hasResponsesEnabled) {
			validationErrors.tasks = true;
			validationErrors.responses = true;
			toast.error('Configuration incomplète', {
				description: 'Vous devez soit créer des tâches, soit activer le formulaire de présence.'
			});
			return;
		}

		// Validation : au moins une réponse possible si allowResponses = true
		if (allowResponses && availableResponseTypes.length === 0) {
			validationErrors.responses = true;
			toast.error('Réponses possibles requises', {
				description: 'Veuillez sélectionner au moins un type de réponse possible.'
			});
			return;
		}

		// Validation : au moins une date sélectionnée et non passée (sauf mode CUSTOM)
		if (recurrenceType !== 'CUSTOM') {
			const today = format(new Date(), 'yyyy-MM-dd');
			const hasValidDates = recurrenceDates.some((d) => d >= today);

			if (recurrenceDates.length === 0) {
				validationErrors.dates = true;
				toast.error('Aucune date sélectionnée', {
					description: 'Veuillez sélectionner au moins une date pour le planning.'
				});
				return;
			}

			if (!hasValidDates) {
				validationErrors.dates = true;
				toast.error('Dates passées', {
					description:
						'Toutes les dates sélectionnées sont passées. Veuillez sélectionner au moins une date future.'
				});
				return;
			}

			if (!firstDate || !lastDate) {
				toast.error('Les dates de début et de fin sont requises');
				return;
			}
		}

		// Vérifier si des dates avec données vont être supprimées
		if (master && datesWithData.length > 0) {
			const datesToDelete = datesWithData.filter((d) => !recurrenceDates.includes(d));
			if (datesToDelete.length > 0) {
				const confirm = window.confirm(
					`Attention : Cette modification va supprimer ${datesToDelete.length} date(s) qui contiennent déjà des réponses ou des commentaires. Souhaitez-vous continuer ?`
				);
				if (!confirm) return;
			}
		}

		const recurrence: RecurrenceConfig = {
			type: recurrenceType,
			...(recurrenceType !== 'CUSTOM' && {
				firstDate,
				lastDate
			}),
			monthlyByDayOccurrences:
				recurrenceType === 'MONTHLY_BY_DAY' ? monthlyByDayOccurrences : undefined,
			recurrenceDates: recurrenceType === 'CUSTOM' ? customDates : recurrenceDates
		};

		const data: PlanningFormData = {
			title: title.trim(),
			description: description.trim() || undefined,
			place: place.trim() || undefined,
			defaultStartTime,
			defaultEndTime,
			minPresentRequired,
			allowResponses,
			toConfirm,
			availableResponseTypes,
			recurrence,
			tasks,
			forceTaskRefresh
		};

		isSubmitting = true;
		try {
			await onSubmit(data);
		} catch (error) {
			console.error('Submit error:', error);
		} finally {
			isSubmitting = false;
		}
	}

	const allGeneratedDates = $derived.by(() => {
		if (recurrenceType === 'CUSTOM') return []; // Pas de génération automatique en mode CUSTOM
		if (!firstDate || !lastDate || !recurrenceType) return [];

		const generated = generateRecurrenceDates({
			type: recurrenceType,
			firstDate,
			lastDate,
			monthlyByDayOccurrences:
				recurrenceType === 'MONTHLY_BY_DAY' ? monthlyByDayOccurrences : undefined
		});

		// Limiter à 100 dates futures maximum
		const today = format(new Date(), 'yyyy-MM-dd');
		return generated.filter((d) => d >= today).slice(0, 100);
	});

	const recurrenceLabel = $derived.by(() => {
		// Mode CUSTOM : afficher le nombre de dates définies
		if (recurrenceType === 'CUSTOM') {
			return customDates.length === 0
				? 'Dates libres'
				: `${customDates.length} date${customDates.length > 1 ? 's' : ''} définie${customDates.length > 1 ? 's' : ''}`;
		}

		// Pas de date de début définie
		if (!firstDate || !recurrenceType) return '';

		// Label de base de la récurrence
		const baseLabel = getRecurrenceLabel({
			type: recurrenceType,
			firstDate,
			lastDate,
			monthlyByDayOccurrences:
				recurrenceType === 'MONTHLY_BY_DAY' ? monthlyByDayOccurrences : undefined
		});

		// Ajouter les dates arbitraires si présentes
		const arbitraryCount = arbitraryDates.length;
		if (arbitraryCount > 0) {
			return `${baseLabel} + ${arbitraryCount} date${arbitraryCount > 1 ? 's' : ''}`;
		}

		return baseLabel;
	});
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="space-y-8"
>
	<!-- Informations principales -->
	<section class="card card-xs sm:card-md bg-base-100 border-base-200 border shadow-sm">
		<div class="card-body gap-6">
			<h3 class="card-title flex items-center gap-2 text-xl">
				<AlignLeft class="text-primary" />
				Informations générales
			</h3>

			<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
				<fieldset class="fieldset col-span-full">
					<label
						class="label bg-primary/5 ring-primary/20 flex cursor-pointer items-start gap-4 rounded-xl p-4 ring-1"
					>
						<input
							type="checkbox"
							bind:checked={toConfirm}
							class="checkbox checkbox-primary mt-1"
						/>
						<div class="min-w-0 flex-1">
							<span class="text-base">Confirmer les événements</span>
							<p class="text-sm text-wrap opacity-80">
								Les administrateurs devront confirmer la tenue de l'événement. Si non coché, les
								événements seront toujours considérés comme ayant lieu.
							</p>
						</div>
					</label>
				</fieldset>

				<fieldset class="fieldset col-span-full">
					<legend class="fieldset-legend">Titre du planning</legend>
					<input
						type="text"
						bind:value={title}
						class="input input-lg w-full {validationErrors.title ? 'input-error' : ''}"
						placeholder="."
						required
						disabled={isSubmitting}
						maxlength="80"
					/>
				</fieldset>

				<fieldset class="fieldset col-span-full">
					<legend class="fieldset-legend">Description</legend>
					<textarea
						bind:value={description}
						class="textarea w-full"
						placeholder="Expliquez l'objectif de ce planning..."
						rows="3"
						disabled={isSubmitting}
						maxlength="280"
					></textarea>
				</fieldset>

				<fieldset class="fieldset">
					<legend class="fieldset-legend flex items-center gap-2">
						<MapPin size={16} /> Lieu
					</legend>
					<input
						type="text"
						bind:value={place}
						class="input w-full"
						placeholder="Ex: Club house, Terrain 1..."
						disabled={isSubmitting}
					/>
				</fieldset>

				<div class="space-y-4">
					<div class="grid grid-cols-2 gap-4">
						<fieldset class="fieldset">
							<legend class="fieldset-legend flex items-center gap-2">
								<Clock size={16} /> Début
							</legend>
							<input
								type="time"
								bind:value={defaultStartTime}
								class="input w-full"
								required
								disabled={isSubmitting}
							/>
						</fieldset>
						<fieldset class="fieldset">
							<legend class="fieldset-legend flex items-center gap-2">
								<Clock size={16} /> Fin
							</legend>
							<input
								type="time"
								bind:value={defaultEndTime}
								class="input w-full"
								required
								disabled={isSubmitting}
							/>
						</fieldset>
					</div>

					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="btn btn-ghost btn-xs bg-base-200"
							onclick={() => {
								defaultStartTime = '08:00';
								defaultEndTime = '12:00';
							}}
						>
							Matinée (8h-12h)
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-xs bg-base-200"
							onclick={() => {
								defaultStartTime = '13:00';
								defaultEndTime = '18:00';
							}}
						>
							Après-midi (13h-18h)
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-xs bg-base-200"
							onclick={() => {
								defaultStartTime = '19:00';
								defaultEndTime = '23:00';
							}}
						>
							Soirée (19h-23h)
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-xs bg-base-200"
							onclick={() => {
								defaultStartTime = '08:00';
								defaultEndTime = '23:00';
							}}
						>
							Journée (8h-23h)
						</button>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Récurrence -->
	<section class="card card-xs sm:card-md bg-base-100 border-base-200 border shadow-sm">
		<div class="card-body gap-6">
			<h3 class="card-title flex items-center gap-2 text-xl">
				<Calendar class="text-primary" />
				Calendrier et récurrence
			</h3>

			<div class="flex flex-col gap-6">
				<fieldset class="fieldset md:max-w-1/2">
					<legend class="fieldset-legend">Type de récurrence</legend>
					<select
						bind:value={recurrenceType}
						class="select w-full"
						disabled={isSubmitting}
						onchange={() => (lastDateWasManuallySet = false)}
					>
						<option value="DAILY">Quotidienne</option>
						<option value="WEEKLY">Hebdomadaire</option>
						<option value="BIWEEKLY">Toutes les 2 semaines</option>
						<option value="MONTHLY_BY_DATE">Mensuel (même date)</option>
						<option value="MONTHLY_BY_DAY">Mensuel (même jour)</option>
						<option value="CUSTOM">Choix libre des dates</option>
					</select>
				</fieldset>

				{#if recurrenceType === 'MONTHLY_BY_DAY'}
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Occurrences dans le mois</legend>
						<MultiSelect
							bind:selectedValues={monthlyByDayOccurrences}
							options={[
								{ value: 1, label: '1er' },
								{ value: 2, label: '2ème' },
								{ value: 3, label: '3ème' },
								{ value: 4, label: '4ème' },
								{ value: 5, label: 'Dernier' }
							]}
							placeholder="Choisir les jours"
						/>
					</fieldset>
				{/if}

				{#if recurrenceType !== 'CUSTOM'}
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<fieldset class="fieldset">
							<legend class="fieldset-legend">Du</legend>
							<input
								type="date"
								bind:value={firstDate}
								class="input w-full"
								required
								disabled={isSubmitting}
							/>
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend">Au</legend>
							<input
								type="date"
								bind:value={lastDate}
								class="input w-full"
								required
								disabled={isSubmitting}
								oninput={() => (lastDateWasManuallySet = true)}
							/>
						</fieldset>
					</div>
				{/if}
			</div>

			{#if recurrenceType !== 'CUSTOM' && allGeneratedDates.length > 0}
				<div
					class="mt-4 space-y-3 {validationErrors.dates
						? 'ring-error rounded-xl p-2 ring-2 ring-offset-2'
						: ''}"
				>
					<div class="flex items-end justify-between">
						<div class="font-bold">
							Sélection des dates ({recurrenceDates.length} / {allGeneratedDates.length})
						</div>
						<div class="text-base-content/60 font-medium italic">{recurrenceLabel}</div>
					</div>
					<div class="bg-base-200/50 flex max-h-64 flex-wrap gap-2 overflow-y-auto rounded-xl p-4">
						{#each allDatesToDisplay as date (date)}
							{@const isSelected = recurrenceDates.includes(date)}
							{@const isArbitrary = arbitraryDates.includes(date)}
							{@const hasData = datesWithData.includes(date)}
							{@const willBeDeleted = hasData && !isSelected}
							<button
								type="button"
								class="btn btn-sm transition-all {isSelected
									? 'btn-primary'
									: 'btn-ghost bg-base-300 opacity-50'} {isArbitrary
									? 'ring-primary ring-2 ring-offset-2'
									: ''} {willBeDeleted ? 'ring-error ring-2 ring-offset-2' : ''}"
								onclick={() => toggleDateSelection(date)}
								disabled={isSubmitting}
								title={willBeDeleted
									? 'Attention: suppression de données sur cette date'
									: isArbitrary
										? ' cliquez pour la supprimer de la sélection'
										: ''}
							>
								{#if willBeDeleted}
									<Trash2 class="mr-1" />
								{/if}
								{format(parse(date, 'yyyy-MM-dd', new Date()), 'EEE d MMM', { locale: fr })}
								{#if isArbitrary}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="btn btn-circle btn-xs btn-error ml-1"
										onclick={(e) => {
											e.stopPropagation();
											removeArbitraryDate(date);
										}}
										title="Supprimer cette date"
									>
										<X size={14} />
									</div>
								{/if}
							</button>
						{/each}
					</div>

					{#if allGeneratedDates.length === 100}
						<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
							<span>Limite atteinte : 100 dates futures (maximum autorisé).</span>
						</div>
					{/if}

					{#if datesWithData.some((d) => !recurrenceDates.includes(d))}
						<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
							<Trash2 size={16} />
							<span>Certaines dates supprimées contiennent des réponses de participants.</span>
						</div>
					{/if}

					<!-- Bouton pour ajouter des dates arbitraires -->
					{#if showArbitraryDatePicker}
						<div class="border-base-300 mt-4 space-y-3 border-t pt-4">
							<div class="flex items-center justify-between">
								<h4 class="text-sm font-medium">Ajouter des dates arbitraires</h4>
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									onclick={() => (showArbitraryDatePicker = false)}
								>
									Fermer
								</button>
							</div>
							<MultiDatePicker
								selectedDates={recurrenceDates}
								excludeDates={allGeneratedDates}
								maxSelection={100}
								onChange={(dates) => {
									recurrenceDates = dates;
								}}
								class="bg-base-200/50 rounded-lg p-4"
							/>
						</div>
					{:else}
						<div class="flex justify-center">
							<button
								type="button"
								class="link link-primary link-hover text-sm font-medium"
								onclick={() => (showArbitraryDatePicker = true)}
							>
								+ Ajouter des dates arbitraires
							</button>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Mode CUSTOM : Choix libre des dates -->
			{#if recurrenceType === 'CUSTOM'}
				<div
					class="mt-4 space-y-4 {validationErrors.dates
						? 'ring-error rounded-xl p-2 ring-2 ring-offset-2'
						: ''}"
				>
					<div class="flex items-end justify-between">
						<div class="font-medium">Dates libres ({customDates.length} / 100)</div>
						<div class="flex items-center">
							<Calendar size={16} />
							<span>{customDates.length} date(s)</span>
						</div>
					</div>

					<MultiDatePicker
						selectedDates={customDates}
						excludeDates={[]}
						maxSelection={100}
						onChange={(dates) => {
							customDates = dates;
						}}
					/>

					{#if customDates.length > 0}
						<div
							class="bg-base-200/50 mt-4 flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-xl p-4"
						>
							{#each customDates as date (date)}
								{@const hasData = datesWithData.includes(date)}
								<button
									type="button"
									class="btn btn-sm btn-primary ring-primary ring-2 ring-offset-2"
									onclick={() => (customDates = customDates.filter((d) => d !== date))}
									disabled={isSubmitting}
									title={hasData
										? 'Attention: cette date contient des données'
										: 'Supprimer cette date'}
								>
									{#if hasData}
										<Trash2 size={12} class="mr-1" />
									{/if}
									{format(parse(date, 'yyyy-MM-dd', new Date()), 'EEE d MMM', { locale: fr })}
									<span class="badge badge-error badge-xs ml-1">×</span>
								</button>
							{/each}
						</div>
					{/if}

					{#if customDates.length > 0}
						{@const futureDatesCount = customDates.filter(
							(d) => d >= format(new Date(), 'yyyy-MM-dd')
						).length}
						{#if futureDatesCount === 100}
							<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
								<span>Limite atteinte : 100 dates futures (maximum autorisé).</span>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</section>

	<!-- Tâches -->
	<section class="card card-xs sm:card-md bg-base-100 border-base-200 border shadow-sm">
		<div class="card-body gap-6">
			<h3 class="card-title flex items-center gap-2 text-xl">
				<Plus class="text-primary" />
				Réponses et tâches
			</h3>

			<div class=" space-y-4">
				<!-- Checkbox allowResponses déplacée ici -->
				<fieldset class="fieldset">
					<label
						class="label bg-primary/5 ring-primary/20 flex cursor-pointer items-start gap-4 rounded-xl p-4 ring-1"
					>
						<input
							type="checkbox"
							bind:checked={allowResponses}
							class="checkbox checkbox-primary mt-1"
						/>
						<div class="min-w-0 flex-1">
							<span class="label-text text-base">Activer le formulaire de présence</span>
							<p class="text-sm text-wrap opacity-80">
								Permet aux participants de confirmer leur présence. Si décoché, vous devez créer des
								tâches ou sélectionner des réponses possibles.
							</p>
						</div>
					</label>
				</fieldset>

				<!-- Sélection des ResponseType -->
				{#if allowResponses}
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-medium">Présences minimum souhaitées</legend>
						<div class="flex items-center gap-4">
							<input
								type="range"
								min="1"
								max="20"
								bind:value={minPresentRequired}
								class="range range-primary"
								disabled={isSubmitting}
							/>
							<span class="badge badge-lg badge-primary min-w-12 tabular-nums">
								{minPresentRequired}
							</span>
						</div>
						<p class="text-base-content/50 mt-2 text-sm">
							Nombre de réponses "Présent" idéal pour chaque occurrence.
						</p>
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-medium">Réponses possibles</legend>
						<p class="text-base-content/50 mb-3 text-sm">
							Sélectionnez les options que les participants peuvent choisir.
						</p>

						<div
							class="flex flex-wrap gap-3 {validationErrors.responses
								? 'ring-error rounded-xl p-2 ring-2 ring-offset-2'
								: ''}"
						>
							{#each AVAILABLE_RESPONSE_TYPES as responseType (responseType)}
								<label
									class="label border-base-300 bg-base-200/30 hover:bg-base-200 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2"
								>
									<input
										type="checkbox"
										class="checkbox checkbox-sm checkbox-primary"
										checked={availableResponseTypes.includes(responseType)}
										onchange={(e) => {
											if (e.currentTarget.checked) {
												availableResponseTypes = [...availableResponseTypes, responseType];
											} else {
												availableResponseTypes = availableResponseTypes.filter(
													(rt) => rt !== responseType
												);
											}
										}}
									/>
									<span class="label-text text-sm font-medium">
										{RESPONSE_TYPE_LABELS[responseType]}
									</span>
								</label>
							{/each}
						</div>
					</fieldset>
				{/if}
			</div>

			<div class="divider"></div>
			<div
				class="space-y-4 {validationErrors.tasks || validationErrors.taskInProgress
					? 'ring-error rounded-xl p-2 ring-2 ring-offset-2'
					: ''}"
			>
				{#if master && datesWithSpecificTasks.length > 0}
					<div class="alert alert-info max-sm:alert-vertical rounded-2xl shadow-sm">
						<AlignLeft size={20} />
						<div class="flex-1">
							<h4 class="font-semibold">Tâches personnalisées détectées</h4>
							<p class="text-sm opacity-70">
								{datesWithSpecificTasks.length} occurrence(s) possèdent des listes de tâches spécifiques
								qui diffèrent de la configuration du planning. Cochez "tout remplacer" si vous souhaitez
								que les modifications s'appliquent y compris à ces occurrences (cela supprimera les tâches
								spécifiques)
							</p>
						</div>
						<label
							class="label bg-base-200 border-base-300 cursor-pointer gap-3 rounded-md border px-4 py-2"
						>
							<input
								type="checkbox"
								bind:checked={forceTaskRefresh}
								class="checkbox checkbox-sm checkbox-warning"
							/>
							<span class="label-text text-sm font-medium">Tout remplacer</span>
						</label>
					</div>
				{/if}

				{#each tasks as task (task.id)}
					{@const isEditing = editingTaskId === task.id}
					<div
						class="bg-base-200/50 group flex items-center gap-4 rounded-lg p-3 {isEditing
							? 'ring-primary ring-2 ring-offset-2'
							: ''}"
					>
						<div class="flex-1">
							<div class="font-bold">{task.name}</div>
							{#if task.description}
								<div class="text-sm opacity-70">{task.description}</div>
							{/if}
						</div>
						<div class="badge badge-outline">{task.requiredVolunteers} pers.</div>

						<div class="flex gap-1">
							<!-- Bouton édition -->
							<button
								type="button"
								class="btn btn-ghost btn-circle"
								onclick={() => editTask(task.id)}
								disabled={isSubmitting}
								title="Modifier cette tâche"
							>
								<Pencil size={14} />
							</button>

							<!-- Bouton supprimer -->
							<button
								type="button"
								class="btn btn-ghost btn-circle text-error"
								onclick={() => removeTask(task.id)}
								disabled={isSubmitting}
								title="Supprimer cette tâche"
							>
								<Trash2 size={14} />
							</button>
						</div>
					</div>
				{/each}

				<div class="flex flex-col gap-3">
					<!-- Indicateur de mode édition -->
					{#if isEditingTask}
						<div class="alert alert-info rounded-lg py-2 text-sm">
							<Pencil size={16} />
							<span>Modification de la tâche en cours</span>
						</div>
					{:else}
						<div class="fieldset-legend">Ajouter une tâche</div>
					{/if}

					<div class="grid grid-cols-1 items-center justify-between gap-3 md:grid-cols-3">
						<input
							type="text"
							bind:value={newTaskName}
							bind:this={taskNameInput}
							class="input input-sm {validationErrors.taskInProgress ? 'input-error' : ''}"
							placeholder="Nom de la tâche"
							disabled={isSubmitting}
							maxlength="50"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addTask();
								}
							}}
						/>
						<label class="input input-sm w-44 items-center gap-2">
							<input
								type="number"
								bind:value={newTaskVolunteers}
								class=" w-full"
								min="1"
								placeholder="Nb. pers"
								disabled={isSubmitting}
								max="1000"
							/>
							<span class="text-sm whitespace-nowrap opacity-60">pers.</span>
						</label>
						<select
							bind:value={newTaskType}
							class="select select-sm w-full"
							disabled={isSubmitting}
						>
							<option value="beforeEvent">Avant l'événement</option>
							<option value="onEvent">Pendant l'événement</option>
							<option value="afterEvent">Après l'événement</option>
						</select>
					</div>
					<!-- <textarea
						bind:value={newTaskDescription}
						class="textarea textarea-sm h-16 w-full"
						placeholder="Description de la tâche (optionnel)"
						disabled={isSubmitting}
					></textarea> -->
					<!-- Boutons d'action -->
					<div class="flex gap-2">
						{#if isEditingTask}
							<button
								type="button"
								class="btn btn-sm btn-ghost"
								onclick={cancelTaskEdit}
								disabled={isSubmitting}
							>
								Annuler
							</button>
						{/if}
						<button
							type="button"
							class="btn btn-sm btn-primary flex-1"
							onclick={addTask}
							disabled={isSubmitting ||
								newTaskName.trim().length === 0 ||
								(isEditingTask && !taskHasChanges)}
						>
							{#if isEditingTask}
								<Pencil size={14} class="mr-1" />
							{/if}
							{taskSubmitButtonLabel}
						</button>
					</div>
				</div>
			</div>
		</div>
	</section>

	<div
		class="fixed bottom-0 left-0 z-10 flex w-full justify-center gap-4 border-t border-slate-400 p-2 shadow-xl backdrop-blur md:sticky md:bottom-2 md:justify-end md:rounded-2xl md:border md:p-4"
	>
		<button
			type="button"
			class="btn btn-ghost max-sm:btn-sm"
			onclick={() => history.back()}
			disabled={isSubmitting}
		>
			Annuler
		</button>
		<button type="submit" class="btn max-sm:btn-sm btn-primary px-8" disabled={isSubmitting}>
			{#if isSubmitting}
				<span class="loading loading-spinner loading-sm"></span>
			{/if}

			<span class="hidden md:block">
				{master ? 'Enregistrer les modifications' : 'Créer le planning'}</span
			>

			<span class="md:hidden"> {master ? 'Enregistrer' : 'Créer'}</span>
		</button>
	</div>
</form>
