<script lang="ts">
	import type {
		RecurrenceConfig,
		Task,
		PlanningMaster,
		PlanningOccurrence,
		OccurrenceTarget,
		TaskType,
		ResponseType,
		TimeSlot,
		DateSlot
	} from '$lib/types/planning.types';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import MultiSelect from './MultiSelect.svelte';
	import MultiDatePicker from './ui/MultiDatePicker.svelte';
	import ConfirmModal from './ui/ConfirmModal.svelte';
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import { classifyError } from '$lib/utils/errorHandler';
	import { generateTimeSlotId } from '$lib/services/planningActions';
	import {
		Plus,
		Trash2,
		Calendar,
		Clock,
		MapPin,
		AlignLeft,
		Pencil,
		ClipboardCheck,
		Check,
		RotateCcw
	} from '@lucide/svelte';
	import { generateRecurrenceDates, getRecurrenceLabel } from '$lib/utils/recurrence';
	import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_LABELS } from '$lib/constants';
	import { toast } from 'svelte-sonner';
	import { format, parse, addWeeks, addMonths } from 'date-fns';
	import { fr } from 'date-fns/locale';
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';
	import NetworkAlert from './NetworkAlert.svelte';
	import { slide } from 'svelte/transition';

	interface Props {
		master?: PlanningMaster; // Si présent, on est en mode édition
		onSubmit: (data: PlanningFormData) => Promise<void>;
		isSubmitting?: boolean;
		datesWithData?: string[]; // Liste des dates (YYYY-MM-DD) ayant des réponses ou commentaires
		datesWithSpecificTasks?: string[]; // Liste des dates ayant des tâches personnalisées
		occurrences?: PlanningOccurrence[]; // Occurrences futures (soft-deleted incluses) pour le seeding édition
	}

	export interface PlanningFormData {
		title: string;
		description?: string;
		place?: string;
		// Champs legacy conservés : requis par PocketBase (champ `defaultStartTime`/`defaultEndTime`
		// obligatoires sur la collection) et utilisés comme fallback mono-slot côté service.
		// Valorisés depuis le 1er slot du répéteur (référence legacy) dans handleSubmit.
		defaultStartTime: string;
		defaultEndTime: string;
		timeSlots: TimeSlot[];
		recurrence: RecurrenceConfig;
		/** Occurrences cibles voulues (source unique côté UI, contrat formulaire↔service). */
		occurrenceTargets: OccurrenceTarget[];
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
		datesWithSpecificTasks = [],
		occurrences = []
	}: Props = $props();

	// Formulaire (initialisé avec le master si présent)
	const m = (() => master)() || {};
	const {
		title: initTitle = '',
		description: initDesc = '',
		place: initPlace = '',
		defaultStartTime: initStartTime = '19:00',
		defaultEndTime: initEndTime = '21:00',
		timeSlots: initMasterTimeSlots,
		minPresentRequired: initMinPresent = 1,
		allowResponses: initAllowResponses = true,
		toConfirm: initToConfirm = false,
		recurrence = {},
		tasks: initTasks = []
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la prop m est très polymorphe (PlanningMaster avec champs optionnels)
	} = m as any;

	const {
		type: initRecType = 'WEEKLY',
		firstDate: initFirstDate = '',
		lastDate: initLastDate = '',
		monthlyByDayOccurrences: initMonthlyByDay = []
	} = recurrence || {};

	let title = $state(initTitle || '');
	let description = $state(initDesc || '');
	let place = $state(initPlace || '');

	// Répéteur de créneaux (multi-slots). En édition on réutilise master.timeSlots ;
	// sinon fallback mono-slot depuis defaultStartTime/defaultEndTime (cohérent avec
	// resolveTimeSlots côté service, qui synthétise un slot `s1`). En création, valeurs
	// par défaut du formulaire.
	let timeSlots = $state<TimeSlot[]>(
		initMasterTimeSlots && initMasterTimeSlots.length > 0
			? initMasterTimeSlots.map((s: TimeSlot) => ({ ...s }))
			: [{ id: 's1', startTime: initStartTime || '19:00', endTime: initEndTime || '21:00' }]
	);
	let minPresentRequired = $state(initMinPresent ?? 1);
	let allowResponses = $state(initAllowResponses ?? true);
	let toConfirm = $state(initToConfirm ?? false);

	// Récurrence
	let recurrenceType = $state(initRecType || 'WEEKLY');
	let firstDate = $state(initFirstDate || '');
	let lastDate = $state(initLastDate || '');
	let monthlyByDayOccurrences = $state<number[]>(initMonthlyByDay || []);

	// Dates candidates ajoutées manuellement : dates arbitraires (hors cycle en mode récurrent)
	// ou toutes les dates (mode CUSTOM). C'est la *liste à afficher*, distincte de la sélection
	// active (portée par `disabledSlotKeys`). En édition, le seeding y ajoute les dates
	// d'occurrences actives hors-cycle (rétrécissement de bornes, changement de type, dates
	// arbitraires d'origine) — en CUSTOM, toutes les occurrences sont hors-cycle et y passent.
	let manualDates = $state<string[]>([]);

	let showArbitraryDatePicker = $state(false); // Afficher le picker inline pour dates arbitraires

	// Dates générées par la récurrence — déclaré avant les $derived qui le référencent
	// (nécessaire pour le prerender SSR, sinon TDZ "Cannot access before initialization")
	const allGeneratedDates = $derived.by(() => {
		if (recurrenceType === 'CUSTOM') return [];
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

	// Dates manuelles hors cycle généré (mode récurrent uniquement). En CUSTOM, toutes
	// les dates sont manuelles, donc pas de notion d'« arbitraire ». Ne sert qu'au libellé
	// `recurrenceLabel` (« ... + N dates »). NE DÉTERMINE PAS la catégorie d'affichage :
	// celle-ci est stable et se fonde sur `manualDates` (sticky) — voir `isManual` au rendu.
	const arbitraryDates = $derived.by(() => {
		if (recurrenceType === 'CUSTOM') return [];
		const generatedSet = new Set(allGeneratedDates);
		return manualDates.filter((d) => !generatedSet.has(d));
	});

	// Toutes les dates à afficher (candidats). CUSTOM → manualDates ; sinon union triée
	// du cycle généré et des dates arbitraires manuelles.
	const allDatesToDisplay = $derived.by(() => {
		if (recurrenceType === 'CUSTOM') {
			return manualDates;
		}
		return [...new Set([...allGeneratedDates, ...manualDates])].sort();
	});

	// === Multi-créneaux : produit cartésien date × slot ===
	// `allDateSlots` est le produit cartésien complet (affichage de toutes les combos possibles,
	// y compris désactivées). La sélection active est portée par `disabledSlotKeys` (plus bas) :
	// une combo est active ssi sa clé n'y figure pas. `activeDateSlots` en est la projection.
	const showSlot = $derived(timeSlots.length > 1);

	/**
	 * Clé stable d'une combinaison date + créneau, cohérente avec `reconciliationKey` côté
	 * service (`date|slotId`). Le fallback sur `startTime` (legacy) est retiré : une occurrence
	 * sans slotId ne matche aucune combo active. Recopiée localement car le helper service
	 * attend un master, indisponible en création.
	 *
	 * Accepte un shape minimal `{date, slotId?}` pour servir aussi bien les DateSlot que les
	 * OccurrenceTarget (et les partiels construits au seeding).
	 */
	function slotKey(ds: { date: string; slotId?: string }): string {
		return `${ds.date}|${ds.slotId ?? ''}`;
	}

	function compareDateSlots(a: DateSlot, b: DateSlot): number {
		return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime);
	}

	// Produit cartésien DateSlot[] = dates à afficher × créneaux, trié (date puis startTime).
	const allDateSlots = $derived.by(() => {
		const result: DateSlot[] = [];
		for (const date of allDatesToDisplay) {
			for (const slot of timeSlots) {
				result.push({
					date,
					startTime: slot.startTime,
					endTime: slot.endTime,
					slotId: slot.id
				});
			}
		}
		return result.sort(compareDateSlots);
	});

	// === Sélection unifiée : disabledSlotKeys + seededOccurrences ===
	// Deux états canoniques mutés uniquement par les handlers purs (setSlotEnabled,
	// addTimeSlot/commitRemoveTimeSlot) et le seeding édition one-shot. Plus
	// aucun `$effect` de sync : la projection (`occurrenceTargets`) est un `$derived`,
	// ce qui élimine l'anti-pattern d'un effect écrasant le state qu'il lit.
	//  - disabledSlotKeys : clés `date|slotId` explicitement désactivées par l'admin.
	//    En mono-slot, slotId = 's1' (cas particulier du multi). Unification mono/multi.
	//  - seededOccurrences : overrides portés (id occurrence + horaires réels) par clé,
	//    peuplés au seeding édition depuis les occurrences actives.
	let disabledSlotKeys = new SvelteSet<string>();
	let seededOccurrences = new SvelteMap<string, OccurrenceTarget>();

	// Projection du produit cartésien (allDateSlots) moins les combos désactivées.
	// Horaires = override seedé (édition) sinon template du slot. Contrat formulaire↔service.
	const occurrenceTargets = $derived.by(() => {
		const result: OccurrenceTarget[] = [];
		for (const ds of allDateSlots) {
			const key = slotKey(ds);
			if (disabledSlotKeys.has(key)) continue;
			const seeded = seededOccurrences.get(key);
			result.push(
				seeded ?? {
					date: ds.date,
					startTime: ds.startTime,
					endTime: ds.endTime,
					slotId: ds.slotId
				}
			);
		}
		return result;
	});

	/** True si la combo est active (non désactivée). Unifie mono/multi/CUSTOM. */
	function isSlotActive(ds: DateSlot): boolean {
		return !disabledSlotKeys.has(slotKey(ds));
	}

	/** Active/désactive une combo (popover multi-slot). Mute disabledSlotKeys. */
	function setSlotEnabled(ds: DateSlot, enabled: boolean) {
		const key = slotKey(ds);
		if (enabled) disabledSlotKeys.delete(key);
		else disabledSlotKeys.add(key);
	}

	/** Horaires à afficher : override seedé (édition) sinon template du slot. */
	function displayTimes(ds: DateSlot): { startTime: string; endTime: string } {
		const seeded = seededOccurrences.get(slotKey(ds));
		return seeded
			? { startTime: seeded.startTime, endTime: seeded.endTime }
			: { startTime: ds.startTime, endTime: ds.endTime };
	}

	// --- Seeding édition (one-shot, seul `$effect` autorisé) ---
	// Se déclenche à l'ouverture en édition (master + occurrences). Remplit les deux états
	// canoniques depuis l'état persisté, puis pose un flag pour ne JAMAIS re-seeder
	// (préserve les désactivations/réactivations faites durant la session). En création,
	// disabledSlotKeys reste vide → toutes les combos sont actives par défaut.
	let seedingDone = $state(false);
	$effect(() => {
		if (seedingDone) return;
		if (!master || occurrences.length === 0) return;
		// Snapshot du cycle généré au moment du seeding : sert à détecter les dates
		// d'occurrences hors-cycle (rétrécissement de bornes, changement de type, ou dates
		// arbitraires d'origine) pour les préserver dans manualDates. Figé ici : un changement
		// ultérieur de bornes par l'admin est un choix explicite (soft-delete au save).
		const generated = new Set(allGeneratedDates);
		const manualAdded = new Set<string>();
		for (const occ of occurrences) {
			const d = occ.date.split(' ')[0].split('T')[0];
			const key = slotKey({ date: d, slotId: occ.slotId });
			if (occ.deleted === true) {
				disabledSlotKeys.add(key);
			} else {
				seededOccurrences.set(key, {
					id: occ.id,
					date: d,
					startTime: occ.startTime,
					endTime: occ.endTime,
					slotId: occ.slotId
				});
				if (!generated.has(d)) manualAdded.add(d);
			}
		}
		if (manualAdded.size > 0) {
			manualDates.push(...manualAdded);
		}
		seedingDone = true;
	});

	// --- Vues dérivées (consommées par le rendu) ---
	// activeDateSlots = projection de occurrenceTargets en DateSlot (trié). Unifie les modes.
	const activeDateSlots = $derived.by(() => {
		return occurrenceTargets
			.map((t) => ({
				date: t.date,
				startTime: t.startTime,
				endTime: t.endTime,
				slotId: t.slotId
			}))
			.sort(compareDateSlots);
	});

	// Dates distinctes ayant au moins une combinaison active (alerte datesWithData, limite).
	const activeDates = $derived(new SvelteSet(activeDateSlots.map((ds) => ds.date)));

	// === Popover par badge (multi-slot uniquement) ===
	// Popover en position fixe pour échapper au conteneur `overflow-y-auto` (sinon clippé).
	// Fermeture extérieure via listener document (pas de backdrop bloquant).
	let activePopoverKey = $state<string | null>(null);
	let popoverPos = $state<{ top: number; left: number }>({ top: 0, left: 0 });

	// Draft des horaires du popover ouvert (édition inline, 3.3). Initialisé à
	// l'ouverture (displayTimes = override seedé sinon template), commité sur
	// « Appliquer ». Fermeture sans apply = revert gratuit (state non muté).
	let popoverTimeDraft = $state<{ startTime: string; endTime: string }>({
		startTime: '',
		endTime: ''
	});

	function togglePopoverFor(ds: DateSlot, btn: HTMLElement) {
		const key = slotKey(ds);
		if (activePopoverKey === key) {
			activePopoverKey = null;
			return;
		}
		const times = displayTimes(ds);
		popoverTimeDraft = { startTime: times.startTime, endTime: times.endTime };
		const rect = btn.getBoundingClientRect();
		// Garde le popover (~220×160px) dans la fenêtre : à droite horizontalement,
		// et bascule au-dessus du badge si manque de place en bas.
		const left = Math.min(rect.left, window.innerWidth - 230);
		const below = rect.bottom + 170 < window.innerHeight;
		activePopoverKey = key;
		popoverPos = {
			top: below ? rect.bottom + 6 : rect.top - 160,
			left: Math.max(8, left)
		};
	}

	function closePopover() {
		activePopoverKey = null;
	}

	/** True si la combo porte un override (horaires divergeant du slot template). */
	function isOverriddenCombo(ds: DateSlot): boolean {
		const seeded = seededOccurrences.get(slotKey(ds));
		const slot = timeSlots.find((s) => s.id === ds.slotId);
		if (!seeded || !slot) return false;
		return seeded.startTime !== slot.startTime || seeded.endTime !== slot.endTime;
	}

	/** Applique le draft comme override sur la combo (3.3). Préserve l'id seedé. */
	function commitPopoverOverride(ds: DateSlot) {
		const { startTime, endTime } = popoverTimeDraft;
		if (!startTime || !endTime) {
			toast.error('Horaires incomplets', {
				description: 'Indiquez une heure de début et de fin.'
			});
			return;
		}
		if (startTime >= endTime) {
			toast.error('Horaires invalides', {
				description: "L'heure de fin doit être après l'heure de début."
			});
			return;
		}
		const key = slotKey(ds);
		const seeded = seededOccurrences.get(key);
		seededOccurrences.set(
			key,
			seeded
				? { ...seeded, startTime, endTime }
				: { date: ds.date, startTime, endTime, slotId: ds.slotId }
		);
		closePopover();
	}

	/** Remet les horaires de la combo au template du slot (retire l'override). */
	function resetPopoverToTemplate(ds: DateSlot) {
		const slot = timeSlots.find((s) => s.id === ds.slotId);
		if (!slot) return;
		const key = slotKey(ds);
		const seeded = seededOccurrences.get(key);
		if (!seeded) {
			popoverTimeDraft = { startTime: slot.startTime, endTime: slot.endTime };
			return;
		}
		seededOccurrences.set(key, { ...seeded, startTime: slot.startTime, endTime: slot.endTime });
		popoverTimeDraft = { startTime: slot.startTime, endTime: slot.endTime };
	}

	// === Confirmations destructrices (pattern intercept → confirm → commit/revert) ===
	// Une seule instance de ConfirmModal pilotée par `confirmState`. Chaque handler `request*`
	// peuple la config puis ouvre ; `onConfirm` exécute le commit puis ferme. L'annulation =
	// ne rien faire (revert automatique pour les inputs one-way : la valeur non mutée du
	// state est réaffichée). `occurrenceTargets` reste un `$derived` pur, jamais écrit.
	interface ConfirmConfig {
		title: string;
		message: string;
		description?: string;
		variant: 'danger' | 'warning' | 'info' | 'success';
		confirmLabel?: string;
		onConfirm: () => void;
	}
	let confirmState = $state<{ open: boolean; config: ConfirmConfig | null }>({
		open: false,
		config: null
	});

	function openConfirm(config: ConfirmConfig) {
		confirmState = { open: true, config };
	}

	function closeConfirm() {
		confirmState = { open: false, config: null };
	}

	function handleConfirm() {
		confirmState.config?.onConfirm();
		closeConfirm();
	}

	$effect(() => {
		const open = activePopoverKey;
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && !t.closest('[data-slot-ui]')) activePopoverKey = null;
		};
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
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

	const isNetworkUnavailable = $derived(!networkStore.isNetworkOk);

	let isMounted = $state(false);
	// Note: En création, l'utilisateur peut modifier manuellement lastDate, mais elle sera réinitialisée
	// automatiquement si firstDate ou recurrenceType change. Comportement acceptable pour KISS.
	let lastDateWasManuallySet = $state(!!(() => master)());

	onMount(() => {
		isMounted = true;
	});

	// Calcul automatique de la date de fin (création uniquement)
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

	// Aucune sync supplémentaire de la sélection n'est nécessaire : les changements de
	// firstDate/lastDate/recurrenceType/monthlyByDay recalculent réactivement les dérivés
	// (allGeneratedDates → allDateSlots → occurrenceTargets). Les nouvelles dates générées
	// sont actives par défaut (disabledSlotKeys vide en création) ; les dates hors-cycle
	// sortent de allDateSlots donc de occurrenceTargets ; les clés orphelines éventuelles
	// dans disabledSlotKeys sont inoffensives (elles ne filtrent que des combos existantes).

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

		// Effacer l'erreur des dates si corrigée (basée sur la sélection réelle active)
		if (validationErrors.dates && activeDateSlots.length > 0) {
			const today = format(new Date(), 'yyyy-MM-dd');
			const hasValidCombos = activeDateSlots.some((ds) => ds.date >= today);
			if (hasValidCombos) {
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

	function cancelTaskInput() {
		newTaskName = '';
		newTaskDescription = '';
		newTaskVolunteers = 1;
		newTaskType = 'onEvent';
	}

	function resetTaskForm() {
		newTaskName = '';
		newTaskDescription = '';
		newTaskVolunteers = 1;
		newTaskType = 'onEvent';
		editingTaskId = null;
	}

	// Retire une date manuelle (popover « Supprimer » mono-slot) : la sort de
	// manualDates, donc de l'affichage. Distinct de la désactivation d'une combo
	// (setSlotEnabled / disabledSlotKeys), qui préserve la date candidate.
	function removeManualDate(dateToRemove: string) {
		manualDates = manualDates.filter((d) => d !== dateToRemove);
	}

	// Affecte manualDates depuis un picker (CUSTOM ou arbitraires récurrent). Une date
	// (re)ajoutée est entièrement réactivée : on retire toutes ses combos de
	// disabledSlotKeys. Sans cela, une date dont toutes les combos avaient été
	// désactivées puis (re)sélectionnées au picker réapparaîtrait grisée — car ses clés
	// persistent dans disabledSlotKeys (notamment après réouverture : le seeding y met
	// les occurrences soft-deleted, sans les compter dans manualDates). Au save, le
	// service un-soft-delete l'occurrence existante (match par date|slotId) en
	// préservant id/responses/comments (décision 2.2).
	function setManualDates(dates: string[]) {
		const prev = new Set(manualDates);
		for (const d of dates) {
			if (prev.has(d)) continue;
			for (const slot of timeSlots) {
				disabledSlotKeys.delete(slotKey({ date: d, slotId: slot.id }));
			}
		}
		manualDates = dates;
	}

	// --- Portes de confirmation (intercept → confirm → commit/revert) ---
	// Une action destructrice ne mute jamais le state directement depuis le rendu :
	// elle passe par un handler `request*` qui décide commit direct vs confirmation.

	// Porte 1 — Changement de récurrence : modification fondamentale. Ne se confirme
	// qu'en édition (`master`) : en création, aucune occurrence existante à détruire, le
	// reset est sans risque. Sur confirm : reset des opt-out (`disabledSlotKeys`) et des
	// dates candidates (`manualDates`). Ne touche ni à `seededOccurrences` (mémoire des
	// overrides d'édition) ni à `timeSlots`. `lastDateWasManuallySet = false` permet le
	// recalc de lastDate en création (cohérent avec un reset complet de config).
	function applyRecurrenceTypeChange(newValue: string) {
		recurrenceType = newValue;
		disabledSlotKeys.clear();
		manualDates = [];
		lastDateWasManuallySet = false;
	}

	function requestRecurrenceTypeChange(newValue: string) {
		if (newValue === recurrenceType) return;
		if (!master) {
			applyRecurrenceTypeChange(newValue);
			return;
		}
		openConfirm({
			title: 'Changer le type de récurrence',
			message:
				'Changer le type de récurrence est une modification fondamentale : les désactivations et les dates manuelles seront réinitialisées, et les occurrences hors nouveau cycle seront supprimées.',
			variant: 'warning',
			confirmLabel: 'Changer',
			onConfirm: () => applyRecurrenceTypeChange(newValue)
		});
	}

	// Porte 2 — Changement de borne (firstDate/lastDate) : confirme seulement si des
	// occurrences avec données sortent du nouveau cycle. Calcule le cycle candidat avec
	// la nouvelle borne (fonction pure) et compare à l'actuel `allGeneratedDates`. Une
	// date manuelle (sticky) reste couverte par `manualDates` même hors cycle → non à risque.
	function commitDateChange(field: 'firstDate' | 'lastDate', newValue: string) {
		if (field === 'firstDate') {
			firstDate = newValue;
		} else {
			lastDate = newValue;
			lastDateWasManuallySet = true;
		}
	}

	function requestDateChange(field: 'firstDate' | 'lastDate', newValue: string) {
		if (
			(field === 'firstDate' && newValue === firstDate) ||
			(field === 'lastDate' && newValue === lastDate)
		)
			return;
		if (recurrenceType === 'CUSTOM' || datesWithData.length === 0) {
			commitDateChange(field, newValue);
			return;
		}
		const newCycle = new Set(
			generateRecurrenceDates({
				type: recurrenceType,
				firstDate: field === 'firstDate' ? newValue : firstDate,
				lastDate: field === 'lastDate' ? newValue : lastDate,
				monthlyByDayOccurrences:
					recurrenceType === 'MONTHLY_BY_DAY' ? monthlyByDayOccurrences : undefined
			})
		);
		const atRisk = allGeneratedDates.some(
			(d) => !newCycle.has(d) && datesWithData.includes(d) && !manualDates.includes(d)
		);
		if (!atRisk) {
			commitDateChange(field, newValue);
			return;
		}
		openConfirm({
			title: 'Modifier la période',
			message: 'Cette modification supprimera des dates contenant des réponses. Continuer ?',
			variant: 'warning',
			confirmLabel: 'Modifier',
			onConfirm: () => commitDateChange(field, newValue)
		});
	}

	// Porte 3 — Suppression d'une date manuelle : confirme si la date a des données.
	// Ferme le popover après commit (idempotent si appelé hors popover).
	function requestRemoveManualDate(dateToRemove: string) {
		if (!datesWithData.includes(dateToRemove)) {
			removeManualDate(dateToRemove);
			closePopover();
			return;
		}
		openConfirm({
			title: 'Supprimer la date',
			message:
				'Des participant·es au planning ont répondu ou commenté sur cette date. Êtes-vous sure de vouloir la supprimer ?',
			variant: 'warning',
			confirmLabel: 'Supprimer',
			onConfirm: () => {
				removeManualDate(dateToRemove);
				closePopover();
			}
		});
	}

	// Porte 4 — Désactivation d'une combo générée : confirme si la date a des données.
	// La réactivation ne se confirme jamais.
	function requestDisableSlot(ds: DateSlot) {
		if (!datesWithData.includes(ds.date)) {
			setSlotEnabled(ds, false);
			closePopover();
			return;
		}
		openConfirm({
			title: 'Retirer cette date',
			message:
				'Des participant·es au planning ont répondu ou commenté sur cette date. Êtes-vous sure de vouloir la supprimer ?',
			variant: 'warning',
			confirmLabel: 'Désactiver',
			onConfirm: () => {
				setSlotEnabled(ds, false);
				closePopover();
			}
		});
	}

	// Applique un preset horaire. En session pencil sur ce slot, le preset alimente
	// le draft (aperçu avant apply) ; sinon il mute le template (comportement création).
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- utilisé dans le template commenté (presets horaires)
	function applyTimePreset(index: number, startTime: string, endTime: string) {
		const slot = timeSlots[index];
		if (!slot) return;
		if (editingSlotId === slot.id) {
			slotDraft = { startTime, endTime };
			return;
		}
		slot.startTime = startTime;
		slot.endTime = endTime;
	}

	function addTimeSlot() {
		timeSlots.push({
			id: generateTimeSlotId(timeSlots),
			startTime: '12:00',
			endTime: '14:00'
		});
	}

	function removeTimeSlot(slotId: string) {
		// En création, suppression directe (aucune occurrence persistée). En édition,
		// la suppression d'un slot soft-deletera au save toutes les occurrences liées
		// (le slotId ne figure plus dans occurrenceTargets) → porte de confirmation.
		if (!master) {
			commitRemoveTimeSlot(slotId);
			return;
		}
		const count = activeDateSlots.filter((ds) => ds.slotId === slotId).length;
		const message =
			count === 0
				? "Les occurrences de ce créneau seront supprimées à l'enregistrement."
				: count === 1
					? "L'occurrence de ce créneau sera supprimée à l'enregistrement, ainsi que les réponses et commentaires éventuels."
					: `Les ${count} occurrences de ce créneau seront supprimées à l'enregistrement, ainsi que les réponses et commentaires éventuels.`;
		openConfirm({
			title: 'Supprimer ce créneau',
			message,
			variant: 'danger',
			confirmLabel: 'Supprimer',
			onConfirm: () => commitRemoveTimeSlot(slotId)
		});
	}

	function commitRemoveTimeSlot(slotId: string) {
		const index = timeSlots.findIndex((s) => s.id === slotId);
		if (index === -1) return;
		timeSlots.splice(index, 1);
		// Réinitialiser une éventuelle session pencil sur le slot supprimé (sinon
		// editingSlotId pointerait vers un id absent → submit bloqué à tort).
		if (editingSlotId === slotId) cancelSlotEdit();
	}

	// === Édition pencil/apply d'un slot (mode édition uniquement, 3.2) ===
	// En édition, les horaires d'un slot ne se mutent pas en direct (read-only) :
	// l'admin ouvre une session « pencil » (draft isolé), ajuste les horaires, puis
	// « Appliquer » propage le draft aux occurrences alignées sur l'ancien template.
	// Les overrides individuels (occurrences dont les horaires divergent du template
	// avant modif) sont préservés. « Annuler » revert le draft sans toucher au state.
	// En création, les inputs restent libres (pas de pencil/apply).
	let editingSlotId = $state<string | null>(null);
	let slotDraft = $state<{ startTime: string; endTime: string }>({ startTime: '', endTime: '' });
	let slotStartInput = $state<HTMLInputElement | undefined>(undefined);

	$effect(() => {
		if (editingSlotId && slotStartInput) {
			slotStartInput.focus();
			slotStartInput.select();
		}
	});

	function startSlotEdit(slotId: string) {
		const slot = timeSlots.find((s) => s.id === slotId);
		if (!slot) return;
		editingSlotId = slotId;
		slotDraft = { startTime: slot.startTime, endTime: slot.endTime };
	}

	function cancelSlotEdit() {
		editingSlotId = null;
		slotDraft = { startTime: '', endTime: '' };
	}

	function applySlotEdit(slotId: string) {
		const slot = timeSlots.find((s) => s.id === slotId);
		if (!slot) return;
		const { startTime: newStart, endTime: newEnd } = slotDraft;
		if (!newStart || !newEnd) {
			toast.error('Créneau incomplet', {
				description: 'Chaque créneau doit avoir une heure de début et une heure de fin.'
			});
			return;
		}
		const oldStart = slot.startTime;
		const oldEnd = slot.endTime;
		if (newStart === oldStart && newEnd === oldEnd) {
			cancelSlotEdit();
			return;
		}
		openConfirm({
			title: 'Appliquer les nouveaux horaires',
			message:
				'Les occurrences de ce créneau suivront les nouveaux horaires, sauf celles que vous avez modifiées individuellement (elles conservent leurs horaires personnalisés).',
			variant: 'warning',
			confirmLabel: 'Appliquer',
			onConfirm: () => commitSlotEdit(slotId, newStart, newEnd, oldStart, oldEnd)
		});
	}

	// Commit du pencil/apply : propage le draft aux occurrences seedées non-overridées
	// (horaires == ancien template) et mute le template. Les occurrences overridées
	// (horaires != ancien template) restent intactes dans seededOccurrences. Les combos
	// non-seedées suivent automatiquement via le `$derived` occurrenceTargets.
	function commitSlotEdit(
		slotId: string,
		newStart: string,
		newEnd: string,
		oldStart: string,
		oldEnd: string
	) {
		for (const [key, seeded] of seededOccurrences) {
			if (seeded.slotId !== slotId) continue;
			if (seeded.startTime === oldStart && seeded.endTime === oldEnd) {
				seededOccurrences.set(key, { ...seeded, startTime: newStart, endTime: newEnd });
			}
		}
		const slot = timeSlots.find((s) => s.id === slotId);
		if (slot) {
			slot.startTime = newStart;
			slot.endTime = newEnd;
		}
		cancelSlotEdit();
	}

	async function handleSubmit() {
		// Marquer qu'une tentative de soumission a eu lieu
		hasAttemptedSubmit = true;

		// Reset des erreurs
		validationErrors = {};

		// Limite Phase 1 : 100 combinaisons date×slot futures maximum (remplace l'ancienne
		// limite de 100 dates). En mono-slot, 1 slot = 1 combinaison/date, donc équivalent.
		const today = format(new Date(), 'yyyy-MM-dd');
		const futureCombosCount = activeDateSlots.filter((ds) => ds.date >= today).length;
		if (futureCombosCount > 100) {
			toast.error('Trop de créneaux planifiés', {
				description: `Vous avez ${futureCombosCount} combinaisons date×créneau futures. La limite est de 100.`
			});
			return;
		}

		// Validation du titre
		if (!title.trim()) {
			validationErrors.title = true;
			toast.error('Le titre est requis');
			return;
		}

		// Validation des créneaux : au moins 1 slot, et chacun doit avoir des horaires complets.
		// Les chevauchements et l'ordre chronologique ne sont PAS vérifiés en Phase 1.
		if (timeSlots.length === 0) {
			toast.error('Aucun créneau défini', {
				description: 'Veuillez conserver au moins un créneau horaire.'
			});
			return;
		}
		const incompleteSlot = timeSlots.find((s) => !s.startTime || !s.endTime);
		if (incompleteSlot) {
			toast.error('Créneau incomplet', {
				description: 'Chaque créneau doit avoir une heure de début et une heure de fin.'
			});
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

		// Validation : session d'édition de slot ouverte (pencil/apply non appliqué)
		if (editingSlotId) {
			toast.error('Créneau en cours de modification', {
				description:
					'Veuillez appliquer ou annuler les modifications du créneau avant de sauvegarder.'
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

		// Validation : au moins une combinaison future active (unifie CUSTOM et récurrent).
		// En mono-slot cela équivaut à « au moins une date future sélectionnée ».
		const todayForValidation = format(new Date(), 'yyyy-MM-dd');
		const hasFutureCombo = activeDateSlots.some((ds) => ds.date >= todayForValidation);
		if (activeDateSlots.length === 0) {
			validationErrors.dates = true;
			toast.error('Aucune date sélectionnée', {
				description: 'Veuillez sélectionner au moins une date pour le planning.'
			});
			return;
		}
		if (!hasFutureCombo) {
			validationErrors.dates = true;
			toast.error('Dates passées', {
				description:
					'Toutes les dates sélectionnées sont passées. Veuillez sélectionner au moins une date future.'
			});
			return;
		}
		if (recurrenceType !== 'CUSTOM' && (!firstDate || !lastDate)) {
			toast.error('Les dates de début et de fin sont requises');
			return;
		}

		// Alerte datesWithData (granularité date en Phase 1) : une date est « supprimée »
		// si plus aucune combinaison active ne la concerne. L'affinage au niveau combinaison
		// (savoir quel slot avait des données) est reporté en Phase 3.
		if (master && datesWithData.length > 0) {
			const datesToDelete = datesWithData.filter((d) => !activeDates.has(d));
			if (datesToDelete.length > 0) {
				const confirm = window.confirm(
					`Attention : Cette modification va supprimer ${datesToDelete.length} date(s) qui contiennent déjà des réponses ou des commentaires. Souhaitez-vous continuer ?`
				);
				if (!confirm) return;
			}
		}

		// recurrence : seed déclaratif (type + bornes + monthlyByDay). La source
		// unique des occurrences est occurrenceTargets ci-dessous.
		const recurrence: RecurrenceConfig = {
			type: recurrenceType,
			...(recurrenceType !== 'CUSTOM' && {
				firstDate,
				lastDate
			}),
			monthlyByDayOccurrences:
				recurrenceType === 'MONTHLY_BY_DAY' ? monthlyByDayOccurrences : undefined
		};

		const data: PlanningFormData = {
			title: title.trim(),
			description: description.trim() || undefined,
			place: place.trim() || undefined,
			// Référence legacy depuis le 1er slot : defaultStartTime/defaultEndTime restent
			// requis côté PocketBase et servent de fallback mono-slot côté service.
			defaultStartTime: timeSlots[0].startTime,
			defaultEndTime: timeSlots[0].endTime,
			timeSlots: timeSlots.map((s) => ({ ...s })),
			minPresentRequired,
			allowResponses,
			toConfirm,
			availableResponseTypes,
			recurrence,
			// Source unique : c'est ce tableau qui pilote create/update côté service.
			occurrenceTargets: occurrenceTargets.map((t) => ({ ...t })),
			tasks,
			forceTaskRefresh
		};

		isSubmitting = true;
		try {
			await onSubmit(data);
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isSubmitting = false;
		}
	}

	const recurrenceLabel = $derived.by(() => {
		// Mode CUSTOM : afficher le nombre de dates définies
		if (recurrenceType === 'CUSTOM') {
			return manualDates.length === 0
				? 'Dates libres'
				: `${manualDates.length} date${manualDates.length > 1 ? 's' : ''} définie${manualDates.length > 1 ? 's' : ''}`;
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
	<NetworkAlert message="Le formulaire est désactivé - Serveur indisponible" />

	<!-- Informations principales -->
	<fieldset
		class="card card-xs sm:card-md bg-base-100 border-base-200 border shadow-sm"
		disabled={isSubmitting || isNetworkUnavailable}
	>
		<div class="card-body gap-4 sm:gap-6">
			<h3 class="card-title flex items-center gap-2 text-xl max-sm:p-2">
				<AlignLeft class="text-primary" />
				Informations générales
			</h3>

			<div class="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
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
								événements seront toujours considérés comme ayant lieu. Utile si un nombre de
								participant·es conditionne l'organisation de l'événement. Cela permet aussi de
								recevoir des notifications (si configuré) lorsqu'un événement est confirmé, etc..
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
						rows="3"
						disabled={isSubmitting}
						maxlength="280"></textarea>
				</fieldset>

				<fieldset class="fieldset col-span-full">
					<label class="input w-full">
						<span class="label"><MapPin size={16} />Lieu</span>
						<input
							type="text"
							bind:value={place}
							class="w-full"
							placeholder="Lieu."
							disabled={isSubmitting}
						/>
					</label>
				</fieldset>
			</div>
		</div>
	</fieldset>

	<!-- Récurrence -->
	<fieldset
		class="card card-xs sm:card-md bg-base-100 border-base-200 border shadow-sm"
		disabled={isSubmitting || isNetworkUnavailable}
	>
		<div class="card-body gap-4 sm:gap-6">
			<h3 class="card-title flex items-center gap-2 text-xl max-sm:p-2">
				<Calendar class="text-primary" />
				Calendrier et récurrences
			</h3>

			<div class="flex flex-col gap-4 sm:gap-6">
				<fieldset class="fieldset md:max-w-1/2">
					<legend class="fieldset-legend">Type de récurrence</legend>
					<select
						value={recurrenceType}
						class="select w-full"
						disabled={isSubmitting}
						onchange={(e) => requestRecurrenceTypeChange(e.currentTarget.value)}
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
								value={firstDate}
								class="input w-full"
								required
								disabled={isSubmitting}
								onchange={(e) => requestDateChange('firstDate', e.currentTarget.value)}
							/>
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend">Au</legend>
							<input
								type="date"
								value={lastDate}
								class="input w-full"
								required
								disabled={isSubmitting}
								onchange={(e) => requestDateChange('lastDate', e.currentTarget.value)}
							/>
						</fieldset>
					</div>
				{/if}
			</div>

			{#snippet comboBadge(ds: DateSlot)}
				{@const isSelected = isSlotActive(ds)}
				{@const isManual = manualDates.includes(ds.date)}
				{@const hasData = datesWithData.includes(ds.date)}
				{@const willBeDeleted = hasData && !isSelected}
				<div class="relative">
					<button
						type="button"
						data-slot-ui
						class="btn sm:btn-sm transition-all {isSelected
							? 'btn-primary'
							: 'btn-ghost bg-base-300 opacity-50'} {isManual
							? 'ring-primary ring-2 ring-offset-2'
							: ''} {willBeDeleted ? 'ring-error ring-2 ring-offset-2' : ''}"
						onclick={(e) => togglePopoverFor(ds, e.currentTarget)}
						disabled={isSubmitting}
						title={willBeDeleted
							? 'Attention : cette date contient des réponses et sera supprimée'
							: 'Cliquez pour afficher les options'}
					>
						{#if willBeDeleted}
							<Trash2 class="mr-1" />
						{/if}
						{format(parse(ds.date, 'yyyy-MM-dd', new Date()), 'EEE d MMM', { locale: fr })}
						{#if showSlot}
							<span class="opacity-80"
								>· {displayTimes(ds).startTime}-{displayTimes(ds).endTime}</span
							>
						{/if}
					</button>
					{#if activePopoverKey === slotKey(ds)}
						<div
							data-slot-ui
							class="bg-base-100 ring-base-300 fixed z-50 mt-1 w-56 rounded-xl p-3 shadow-lg ring-1"
							style="top:{popoverPos.top}px; left:{popoverPos.left}px;"
						>
							<div class="text-base-content/70 mb-1 text-xs">
								{format(parse(ds.date, 'yyyy-MM-dd', new Date()), 'EEE d MMM', {
									locale: fr
								})}
							</div>
							{#if master && isSelected}
								<div class="mb-2">
									<div class="mb-1 text-xs font-medium opacity-70">Horaires</div>
									<div class="grid grid-cols-2 gap-1">
										<input
											type="time"
											data-slot-ui
											class="input input-sm px-1"
											bind:value={popoverTimeDraft.startTime}
											disabled={isSubmitting}
										/>
										<input
											type="time"
											data-slot-ui
											class="input input-sm px-1"
											bind:value={popoverTimeDraft.endTime}
											disabled={isSubmitting}
										/>
									</div>
								</div>
							{:else}
								<div class="mb-3 flex items-center gap-2 text-sm font-medium">
									<Clock size={14} />
									{displayTimes(ds).startTime} – {displayTimes(ds).endTime}
								</div>
							{/if}
							<div class="flex flex-col gap-2">
								{#if master && isSelected}
									<div class="flex gap-1">
										<button
											type="button"
											class="btn btn-primary btn-sm flex-1"
											onclick={() => commitPopoverOverride(ds)}
										>
											<Check size={14} /> Appliquer
										</button>
										{#if isOverriddenCombo(ds)}
											<button
												type="button"
												class="btn btn-ghost btn-sm btn-square"
												title="Réinitialiser aux horaires du créneau"
												onclick={() => resetPopoverToTemplate(ds)}
											>
												<RotateCcw size={14} />
											</button>
										{/if}
									</div>
								{/if}
								{#if !showSlot && isManual}
									<button
										type="button"
										class="btn btn-error btn-sm"
										onclick={() => requestRemoveManualDate(ds.date)}
									>
										<Trash2 size={14} /> Supprimer
									</button>
								{:else if isSelected}
									<button
										type="button"
										class="btn btn-error btn-sm"
										onclick={() => requestDisableSlot(ds)}
									>
										<Trash2 size={14} /> Désactiver
									</button>
								{:else}
									<button
										type="button"
										class="btn btn-primary btn-sm"
										onclick={() => {
											setSlotEnabled(ds, true);
											closePopover();
										}}
									>
										Réactiver
									</button>
								{/if}
								<button type="button" class="btn btn-ghost btn-sm" onclick={closePopover}
									>Fermer</button
								>
							</div>
						</div>
					{/if}
				</div>
			{/snippet}

			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<Clock class="text-primary" size={18} />
					<span class="font-medium">Créneaux horaires</span>
				</div>

				{#each timeSlots as slot, _i (slot.id)}
					{@const isEditingThis = editingSlotId === slot.id}
					<div class="space-y-2">
						<div class="flex flex-wrap items-end gap-2">
							{#if isEditingThis}
								<fieldset class="fieldset">
									<legend class="fieldset-legend flex items-center gap-2">
										<Clock size={16} /> Début
									</legend>
									<input
										type="time"
										bind:this={slotStartInput}
										bind:value={slotDraft.startTime}
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
										bind:value={slotDraft.endTime}
										class="input w-full"
										required
										disabled={isSubmitting}
									/>
								</fieldset>
							{:else}
								<fieldset class="fieldset">
									<legend class="fieldset-legend flex items-center gap-2">
										<Clock size={16} /> Début
									</legend>
									<input
										type="time"
										bind:value={slot.startTime}
										class="input w-full"
										required
										disabled={isSubmitting || !!master}
									/>
								</fieldset>
								<fieldset class="fieldset">
									<legend class="fieldset-legend flex items-center gap-2">
										<Clock size={16} /> Fin
									</legend>
									<input
										type="time"
										bind:value={slot.endTime}
										class="input w-full"
										required
										disabled={isSubmitting || !!master}
									/>
								</fieldset>
							{/if}

							{#if isEditingThis}
								<button
									type="button"
									class="btn btn-primary btn-sm"
									onclick={() => applySlotEdit(slot.id)}
									disabled={isSubmitting}
								>
									Appliquer
								</button>
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									onclick={cancelSlotEdit}
									disabled={isSubmitting}
								>
									Annuler
								</button>
							{:else if master}
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									onclick={() => startSlotEdit(slot.id)}
									disabled={isSubmitting || editingSlotId !== null}
									aria-label="Modifier les horaires du créneau"
									title="Modifier les horaires (propage aux occurrences, préserve les modifications individuelles)"
								>
									<Pencil size={16} />
								</button>
							{/if}
							{#if timeSlots.length > 1}
								<button
									type="button"
									class="btn btn-error btn-ghost btn-sm"
									onclick={() => removeTimeSlot(slot.id)}
									disabled={isSubmitting || editingSlotId !== null}
									aria-label="Supprimer ce créneau"
								>
									<Trash2 size={16} />
								</button>
							{/if}
						</div>

						<!-- <div class="flex w-full flex-wrap gap-2">
							<button
								type="button"
								class="btn btn-ghost btn-xs bg-base-200"
								disabled={isSubmitting || (!!master && !isEditingThis)}
								onclick={() => applyTimePreset(i, '08:00', '12:00')}>Matinée (8h-12h)</button
							>
							<button
								type="button"
								class="btn btn-ghost btn-xs bg-base-200"
								disabled={isSubmitting || (!!master && !isEditingThis)}
								onclick={() => applyTimePreset(i, '13:00', '18:00')}>Après-midi (13h-18h)</button
							>
							<button
								type="button"
								class="btn btn-ghost btn-xs bg-base-200"
								disabled={isSubmitting || (!!master && !isEditingThis)}
								onclick={() => applyTimePreset(i, '19:00', '23:00')}>Soirée (19h-23h)</button
							>
							<button
								type="button"
								class="btn btn-ghost btn-xs bg-base-200"
								disabled={isSubmitting || (!!master && !isEditingThis)}
								onclick={() => applyTimePreset(i, '08:00', '23:00')}>Journée (8h-23h)</button
							>
						</div> -->
					</div>
					{#if timeSlots.length > 1}
						<span class="divider"></span>
					{/if}
				{/each}

				<button
					type="button"
					class="btn btn-ghost btn-sm w-fit"
					onclick={addTimeSlot}
					disabled={isSubmitting}
				>
					<Plus size={16} /> Ajouter un créneau
				</button>
			</div>

			{#if recurrenceType !== 'CUSTOM' && allGeneratedDates.length > 0}
				<div
					class="mt-4 space-y-3 {validationErrors.dates
						? 'ring-error rounded-xl p-2 ring-2 ring-offset-2'
						: ''}"
				>
					<div class="flex items-end justify-between">
						<div class="font-bold">
							{#if showSlot}
								Sélection des dates ({activeDateSlots.length} / {allDateSlots.length} combinaisons)
							{:else}
								Sélection des dates ({activeDateSlots.length} / {allDateSlots.length})
							{/if}
						</div>
						<div class="text-base-content/60 font-medium italic">{recurrenceLabel}</div>
					</div>
					<div class="bg-base-200/50 flex max-h-64 flex-wrap gap-2 overflow-y-auto rounded-xl p-4">
						{#each allDateSlots as ds (slotKey(ds))}
							{@render comboBadge(ds)}
						{/each}
					</div>

					{#if activeDateSlots.filter((ds) => ds.date >= format(new Date(), 'yyyy-MM-dd')).length >= 100}
						<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
							<span>
								{#if showSlot}
									Limite atteinte : 100 combinaisons date×créneau futures (maximum autorisé).
								{:else}
									Limite atteinte : 100 dates futures (maximum autorisé).
								{/if}
							</span>
						</div>
					{/if}

					{#if datesWithData.some((d) => !activeDates.has(d))}
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
									class="btn btn-ghost sm:btn-sm"
									onclick={() => (showArbitraryDatePicker = false)}
								>
									Fermer
								</button>
							</div>
							<MultiDatePicker
								selectedDates={manualDates}
								excludeDates={allGeneratedDates}
								maxSelection={100}
								onChange={setManualDates}
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
						<div class="font-medium">
							{#if showSlot}
								Dates libres ({activeDateSlots.length} / {allDateSlots.length} combinaisons)
							{:else}
								Dates libres ({manualDates.length} / 100)
							{/if}
						</div>
						<div class="flex items-center">
							<Calendar size={16} />
							<span>{manualDates.length} date(s)</span>
						</div>
					</div>

					<MultiDatePicker
						selectedDates={manualDates}
						excludeDates={[]}
						maxSelection={100}
						onChange={setManualDates}
					/>

					{#if manualDates.length > 0}
						<div
							class="bg-base-200/50 mt-4 flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-xl p-4"
						>
							{#each allDateSlots as ds (slotKey(ds))}
								{@render comboBadge(ds)}
							{/each}
						</div>
					{/if}

					{#if manualDates.length > 0}
						{@const todayStr = format(new Date(), 'yyyy-MM-dd')}
						{@const futureComboCount = activeDateSlots.filter((ds) => ds.date >= todayStr).length}
						{#if futureComboCount >= 100}
							<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
								<span>
									{#if showSlot}
										Limite atteinte : 100 combinaisons date×créneau futures (maximum autorisé).
									{:else}
										Limite atteinte : 100 dates futures (maximum autorisé).
									{/if}
								</span>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</fieldset>

	<!-- Tâches -->
	<fieldset
		class="card card-xs sm:card-md bg-base-100 border-base-200 border shadow-sm"
		disabled={isSubmitting || isNetworkUnavailable}
	>
		<div class="card-body sm-gap-6 gap-4">
			<h3 class="card-title flex items-center gap-2 text-xl max-sm:p-2">
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
										class="checkbox sm:checkbox-sm checkbox-primary"
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

			<div class="divider my-0"></div>
			<div
				class="space-y-4 {validationErrors.tasks || validationErrors.taskInProgress
					? 'ring-error rounded-xl p-2 ring-2 ring-offset-2'
					: ''}"
			>
				<h4 class="flex items-center gap-2 text-base font-medium">
					<ClipboardCheck size={18} class="text-primary" />
					Liste des tâches
				</h4>
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
								class="checkbox sm:checkbox-sm checkbox-warning"
							/>
							<span class="label-text text-sm font-medium">Tout remplacer</span>
						</label>
					</div>
				{/if}

				{#each tasks as task (task.id)}
					{@const isEditing = editingTaskId === task.id}
					<div
						class="bg-accent/20 group flex items-center gap-4 rounded-lg px-3 py-2 {isEditing
							? 'ring-primary ring-2 ring-offset-2'
							: ''}"
					>
						<div class="flex-1">
							<div class="text-base font-medium">{task.name}</div>

							{#if task.description}
								<div class="text-sm opacity-70">{task.description}</div>
							{/if}
						</div>

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
						</div>
					</div>
				{/each}

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
								<label class="input w-full {validationErrors.taskInProgress ? 'input-error' : ''}">
									<input
										type="text"
										bind:value={newTaskName}
										bind:this={taskNameInput}
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
									<!-- Bouton + intégré visible uniquement en mobile -->
									<button
										type="button"
										class="btn btn-primary btn-circle btn-sm hidden max-sm:flex"
										onclick={addTask}
										disabled={isSubmitting ||
											newTaskName.trim().length === 0 ||
											(isEditingTask && !taskHasChanges)}
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
										disabled={isSubmitting}
										max="1000"
									/>
								</fieldset>
								<fieldset class="fieldset">
									<legend class="fieldset-legend">Moment</legend>
									<select bind:value={newTaskType} class="select w-full" disabled={isSubmitting}>
										<option value="beforeEvent">Avant</option>
										<option value="onEvent">Pendant</option>
										<option value="afterEvent">Après</option>
									</select>
								</fieldset>
							</div>
						</div>
						<!-- <textarea
						bind:value={newTaskDescription}
						class="textarea textarea-sm h-16 w-full"
						placeholder="Description de la tâche (optionnel)"
						disabled={isSubmitting}
					></textarea> -->
						<!-- Boutons d'action -->
						<div class="flex justify-end gap-2">
							{#if !isEditingTask && newTaskName.trim().length > 0}
								<button
									type="button"
									class="btn sm:btn-sm btn-ghost"
									onclick={cancelTaskInput}
									disabled={isSubmitting}
								>
									Annuler
								</button>
							{/if}
							{#if isEditingTask}
								<button type="button" class="btn sm:btn-sm btn-ghost" onclick={cancelTaskEdit}
									>Annuler</button
								>
							{/if}
							<button
								type="button"
								class="btn sm:btn-sm btn-primary"
								onclick={addTask}
								disabled={isSubmitting ||
									newTaskName.trim().length === 0 ||
									(isEditingTask && !taskHasChanges)}
							>
								{isEditingTask ? 'Modifier la tâche' : 'Ajouter la tâche'}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	</fieldset>

	<div
		class="bg-base-100/80 fixed bottom-0 left-0 z-10 flex w-full justify-between gap-4 border-t border-slate-400 p-2 shadow-xl backdrop-blur md:sticky md:bottom-2 md:justify-end md:rounded-2xl md:border md:p-4"
	>
		<button
			type="button"
			class="btn btn-ghost"
			onclick={() => history.back()}
			disabled={isSubmitting}
		>
			Annuler
		</button>
		<button type="submit" class="btn btn-primary px-8" disabled={isSubmitting}>
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

<ConfirmModal
	open={confirmState.open}
	onClose={closeConfirm}
	onConfirm={handleConfirm}
	title={confirmState.config?.title ?? ''}
	message={confirmState.config?.message ?? ''}
	description={confirmState.config?.description}
	variant={confirmState.config?.variant ?? 'warning'}
	confirmLabel={confirmState.config?.confirmLabel}
/>
