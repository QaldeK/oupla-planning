<script lang="ts">
import {
	AlignLeft,
	Calendar,
	Check,
	ClipboardCheck,
	Clock,
	MapPin,
	Pencil,
	Plus,
	RotateCcw,
	Trash2
} from "@lucide/svelte";
import { addMonths, addWeeks, format, parse } from "date-fns";
import { onMount, untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { slide } from "svelte/transition";
import { toast } from "svelte-sonner";
import { AVAILABLE_RESPONSE_TYPES, RESPONSE_TYPE_LABELS } from "$lib/constants";
import * as msg from "$lib/paraglide/messages.js";
import { generateTimeSlotId } from "$lib/services/planningActions";
import { networkStore } from "$lib/stores/networkStore.svelte";
import type {
	DateSlot,
	OccurrenceTarget,
	PlanningMaster,
	PlanningOccurrence,
	RecurrenceConfig,
	ResponseType,
	Task,
	TaskType,
	TimeSlot
} from "$lib/types/planning.types";
import { formatDate } from "$lib/utils/date";
import { computeMaxDateForLimit } from "$lib/utils/dateSlotLimit";
import { computeDateSlotSelection, seedFromOccurrences } from "$lib/utils/dateSlotSelection";
import { classifyError } from "$lib/utils/errorHandler";
import {
	generateRecurrenceDates,
	getRecurrenceLabel,
	isLastDayOfMonth
} from "$lib/utils/recurrence";
import { formatSlotKey } from "$lib/utils/slots";
import MultiSelect from "./MultiSelect.svelte";
import NetworkAlert from "./NetworkAlert.svelte";
import ConfirmModal from "./ui/ConfirmModal.svelte";
import Modal from "./ui/Modal.svelte";
import MultiDatePicker from "./ui/MultiDatePicker.svelte";
import RichTextEditor from "./ui/RichTextEditor.svelte";

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
	title: initTitle = "",
	description: initDesc = "",
	place: initPlace = "",
	defaultStartTime: initStartTime = "14:00",
	defaultEndTime: initEndTime = "18:00",
	timeSlots: initMasterTimeSlots,
	minPresentRequired: initMinPresent = 1,
	allowResponses: initAllowResponses = true,
	toConfirm: initToConfirm = false,
	recurrence = {},
	tasks: initTasks = []
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la prop m est très polymorphe (PlanningMaster avec champs optionnels)
} = m as any;

const {
	type: initRecType = "WEEKLY",
	firstDate: initFirstDate = "",
	lastDate: initLastDate = "",
	monthlyByDayOccurrences: initMonthlyByDay = [],
	monthlyByDateMode: initMonthlyByDateMode
} = recurrence || {};

let title = $state(initTitle || "");
let description = $state(initDesc || "");
let place = $state(initPlace || "");

// Répéteur de créneaux (multi-slots). En édition on réutilise master.timeSlots ;
// sinon fallback mono-slot depuis defaultStartTime/defaultEndTime (cohérent avec
// resolveTimeSlots côté service, qui synthétise un slot `s1`). En création, valeurs
// par défaut du formulaire.
let timeSlots = $state<TimeSlot[]>(
	initMasterTimeSlots && initMasterTimeSlots.length > 0
		? initMasterTimeSlots.map((s: TimeSlot) => ({ ...s }))
		: [{ id: "s1", startTime: initStartTime || "14:00", endTime: initEndTime || "18:00" }]
);
let minPresentRequired = $state(initMinPresent ?? 1);
let allowResponses = $state(initAllowResponses ?? true);
let toConfirm = $state(initToConfirm ?? false);

// Récurrence
let recurrenceType = $state(initRecType || "WEEKLY");
let firstDate = $state(initFirstDate || "");
let lastDate = $state(initLastDate || "");
let monthlyByDayOccurrences = $state<number[]>(initMonthlyByDay || []);
// 'fixed-day' (défaut) | 'last-day' | undefined (neutre = fixed-day implicite).
// Conservé à travers les changements de firstDate non-dernier-de-mois : le mode
// devient inerte (l'algorithme retombe sur fixed-day) sans reset.
let monthlyByDateMode = $state<"fixed-day" | "last-day" | undefined>(initMonthlyByDateMode);

// Dates candidates ajoutées manuellement : dates arbitraires (hors cycle en mode récurrent)
// ou toutes les dates (mode CUSTOM). C'est la *liste à afficher*, distincte de la sélection
// active (portée par `disabledSlotKeys`). En édition, le seeding y ajoute les dates
// d'occurrences actives hors-cycle (rétrécissement de bornes, changement de type, dates
// arbitraires d'origine) — en CUSTOM, toutes les occurrences sont hors-cycle et y passent.
let manualDates = $state<string[]>([]);

let showArbitraryDatePicker = $state(false); // Afficher le picker inline pour dates arbitraires

// « Aujourd'hui » figé à la résolution du dérivé. Source unique partagée par
// le picker minDate, la validation des DateSlots futurs, et le masquage des badges passés.
const todayStr = $derived(format(new Date(), "yyyy-MM-dd"));

// Multi-créneaux : afficher le badge slotId uniquement en mode multi-slot.
const showSlot = $derived(timeSlots.length > 1);

// Toggle MONTHLY_BY_DATE : visible si et seulement si firstDate est dernier
// jour de son mois. Couvre 31 (mois 31j), 30 (mois 30j), 29 fév bis, 28 fév
// non-bis. Sinon, le mode est inerte (l'algorithme retombe sur fixed-day).
const showMonthlyByDateMode = $derived(
	recurrenceType === "MONTHLY_BY_DATE" &&
		firstDate !== "" &&
		isLastDayOfMonth(parse(firstDate, "yyyy-MM-dd", new Date()))
);

// Valeur effective du mode pour les calculs et la soumission. Quand le toggle
// est caché (firstDate non-dernier-de-mois), le mode est silencieusement
// inactif — on ne le propage pas à la payload pour ne pas le persisted inutilement.
const effectiveMonthlyByDateMode = $derived(showMonthlyByDateMode ? monthlyByDateMode : undefined);

// --- Sélection unifiée : disabledSlotKeys + seededOccurrences ---
// États canoniques mutés uniquement par les handlers purs (setSlotEnabled,
// addTimeSlot/commitRemoveTimeSlot) et le seeding édition one-shot.
//  - disabledSlotKeys : clés `date|slotId` explicitement désactivées par l'admin.
//  - seededOccurrences : overrides portés (id occurrence + horaires réels) par clé.
let disabledSlotKeys = new SvelteSet<string>();
let seededOccurrences = new SvelteMap<string, OccurrenceTarget>();

// --- Moteur pur de sélection DateSlot ---
// Toute la logique de calcul (produit cartésien, filtrage désactivées, overrides,
// masquage passées, comptages) vit dans `dateSlotSelection.ts`. Le composant ne
// fait plus que binding Svelte + template + état réactif mutable (disabledSlotKeys,
// seededOccurrences).
const views = $derived(
	computeDateSlotSelection(
		{
			recurrenceType,
			firstDate,
			lastDate,
			monthlyByDayOccurrences:
				recurrenceType === "MONTHLY_BY_DAY" ? monthlyByDayOccurrences : undefined,
			monthlyByDateMode:
				recurrenceType === "MONTHLY_BY_DATE" ? effectiveMonthlyByDateMode : undefined,
			manualDates,
			timeSlots,
			todayStr
		},
		{
			disabledSlotKeys: new Set(disabledSlotKeys),
			seededOccurrences: new Map(seededOccurrences)
		}
	)
);

/** True si la DateSlot est active (non désactivée). Unifie mono/multi/CUSTOM. */
function isSlotActive(ds: DateSlot): boolean {
	return !disabledSlotKeys.has(formatSlotKey(ds.date, ds.slotId));
}

/** Active/désactive une DateSlot (popover multi-slot). Mute disabledSlotKeys. */
function setSlotEnabled(ds: DateSlot, enabled: boolean) {
	const key = formatSlotKey(ds.date, ds.slotId);
	if (enabled) disabledSlotKeys.delete(key);
	else disabledSlotKeys.add(key);
}

/** Horaires à afficher : override seedé (édition) sinon template du slot. */
function displayTimes(ds: DateSlot): { startTime: string; endTime: string } {
	const seeded = seededOccurrences.get(formatSlotKey(ds.date, ds.slotId));
	return seeded
		? { startTime: seeded.startTime, endTime: seeded.endTime }
		: { startTime: ds.startTime, endTime: ds.endTime };
}

// --- Seeding édition (one-shot, seul `$effect` autorisé) ---
// Se déclenche à l'ouverture en édition (master + occurrences). Remplit les deux états
// canoniques depuis l'état persisté, puis pose un flag pour ne JAMAIS re-seeder.
let seedingDone = $state(false);
$effect(() => {
	if (seedingDone) return;
	if (!master || occurrences.length === 0) return;
	const result = seedFromOccurrences(occurrences, new Set(views.allGeneratedDates));
	for (const key of result.disabledKeys) disabledSlotKeys.add(key);
	for (const [key, target] of result.seeded) seededOccurrences.set(key, target);
	if (result.manualDatesToAdd.length > 0) {
		manualDates.push(...result.manualDatesToAdd);
	}
	seedingDone = true;
});

// --- Vues dérivées (consommées par le rendu) ---
const hiddenPastLabel = $derived(
	views.hiddenPastDateCount > 0
		? msg.planform_hidden_past({ count: views.hiddenPastDateCount })
		: ""
);

// Dernière date de cycle ramenant le compte de DateSlots futurs à ≤ 100, pour
// le bouton « Ajuster au ... » de l'alerte (mode récurrent uniquement).
const maxAdjustDate = $derived(
	recurrenceType !== "CUSTOM" && firstDate && lastDate
		? computeMaxDateForLimit({
				firstDate,
				lastDate,
				recurrenceType,
				monthlyByDayOccurrences:
					recurrenceType === "MONTHLY_BY_DAY" ? monthlyByDayOccurrences : undefined,
				monthlyByDateMode:
					recurrenceType === "MONTHLY_BY_DATE" ? effectiveMonthlyByDateMode : undefined,
				manualDates,
				timeSlots,
				disabledSlotKeys: new Set(disabledSlotKeys),
				todayStr
			})
		: null
);
const maxAdjustDateLabel = $derived(
	maxAdjustDate ? formatDate(parse(maxAdjustDate, "yyyy-MM-dd", new Date()), "d MMM yyyy") : ""
);

// === Popover par badge (multi-slot uniquement) ===
// Popover en position fixe pour échapper au conteneur `overflow-y-auto` (sinon clippé).
// Fermeture extérieure via listener document (pas de backdrop bloquant).
let activePopoverKey = $state<string | null>(null);
let popoverPos = $state<{ top: number; left: number }>({ top: 0, left: 0 });

// Draft des horaires du popover ouvert (édition inline, 3.3). Initialisé à
// l'ouverture (displayTimes = override seedé sinon template), commité sur
// « Appliquer ». Fermeture sans apply = revert gratuit (state non muté).
let popoverTimeDraft = $state<{ startTime: string; endTime: string }>({
	startTime: "",
	endTime: ""
});

function togglePopoverFor(ds: DateSlot, btn: HTMLElement) {
	const key = formatSlotKey(ds.date, ds.slotId);
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

/** True si la DateSlot porte un override (horaires divergeant du slot template). */
function isOverriddenDateSlot(ds: DateSlot): boolean {
	const seeded = seededOccurrences.get(formatSlotKey(ds.date, ds.slotId));
	const slot = timeSlots.find((s) => s.id === ds.slotId);
	if (!seeded || !slot) return false;
	return seeded.startTime !== slot.startTime || seeded.endTime !== slot.endTime;
}

/** Applique le draft comme override sur la DateSlot (3.3). Préserve l'id seedé. */
function commitPopoverOverride(ds: DateSlot) {
	const { startTime, endTime } = popoverTimeDraft;
	if (!startTime || !endTime) {
		toast.error(msg.planform_toast_hours_incomplete(), {
			description: msg.planform_toast_hours_incomplete_desc()
		});
		return;
	}
	if (startTime >= endTime) {
		toast.error(msg.planform_toast_hours_invalid(), {
			description: msg.planform_toast_hours_invalid_desc()
		});
		return;
	}
	const key = formatSlotKey(ds.date, ds.slotId);
	const seeded = seededOccurrences.get(key);
	seededOccurrences.set(
		key,
		seeded
			? { ...seeded, startTime, endTime }
			: { date: ds.date, startTime, endTime, slotId: ds.slotId }
	);
	closePopover();
}

/** Remet les horaires de la DateSlot au template du slot (retire l'override). */
function resetPopoverToTemplate(ds: DateSlot) {
	const slot = timeSlots.find((s) => s.id === ds.slotId);
	if (!slot) return;
	const key = formatSlotKey(ds.date, ds.slotId);
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
	variant: "danger" | "warning" | "info" | "success";
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
		if (t && !t.closest("[data-slot-ui]")) activePopoverKey = null;
	};
	document.addEventListener("pointerdown", onPointerDown);
	return () => document.removeEventListener("pointerdown", onPointerDown);
});

// Tâches
let tasks = $state<Task[]>(initTasks || []);
let newTaskName = $state("");
let newTaskDescription = $state("");
let newTaskVolunteers = $state(1);
let newTaskType = $state<TaskType>("onEvent");
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
		(newTaskDescription.trim() || "") !== (task.description || "") ||
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
		const start = parse(firstDate, "yyyy-MM-dd", new Date());
		let end: Date;

		switch (recurrenceType) {
			case "DAILY":
				end = addWeeks(start, 1);
				break;
			case "WEEKLY":
			case "BIWEEKLY":
				end = addMonths(start, 6);
				break;
			case "MONTHLY_BY_DATE":
			case "MONTHLY_BY_DAY":
				end = addMonths(start, 12);
				break;
			default:
				return;
		}

		lastDate = format(end, "yyyy-MM-dd");
	});
});

// Aucune sync supplémentaire de la sélection n'est nécessaire : les changements de
// firstDate/lastDate/recurrenceType/monthlyByDay recalculent réactivement les dérivés
// (allGeneratedDates → allDateSlots → occurrenceTargets). Les nouvelles dates générées
// sont actives par défaut (disabledSlotKeys vide en création) ; les dates hors-cycle
// sortent de allDateSlots donc de occurrenceTargets ; les clés orphelines éventuelles
// dans disabledSlotKeys sont inoffensives (elles ne filtrent que des DateSlots existantes).

// Effet pour effacer les erreurs de validation quand l'utilisateur corrige
$effect(() => {
	if (!hasAttemptedSubmit) return;

	// Effacer l'erreur du titre si corrigé
	if (validationErrors.title && title.trim()) {
		validationErrors.title = false;
	}

	// Effacer l'erreur des dates si corrigée (basée sur la sélection réelle active)
	if (validationErrors.dates && views.activeDateSlots.length > 0) {
		const hasValidDateSlots = views.activeDateSlots.some((ds) => ds.date >= todayStr);
		if (hasValidDateSlots) {
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
		toast.error(msg.planform_validation_name_required());
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
	newTaskDescription = task.description || "";
	newTaskVolunteers = task.requiredVolunteers;
	newTaskType = task.type;
	editingTaskId = taskId;
}

function cancelTaskEdit() {
	resetTaskForm();
}

function cancelTaskInput() {
	newTaskName = "";
	newTaskDescription = "";
	newTaskVolunteers = 1;
	newTaskType = "onEvent";
}

function resetTaskForm() {
	newTaskName = "";
	newTaskDescription = "";
	newTaskVolunteers = 1;
	newTaskType = "onEvent";
	editingTaskId = null;
}

// Retire une date manuelle (popover « Supprimer » mono-slot) : la sort de
// manualDates, donc de l'affichage. Distinct de la désactivation d'une DateSlot
// (setSlotEnabled / disabledSlotKeys), qui préserve la date candidate.
function removeManualDate(dateToRemove: string) {
	manualDates = manualDates.filter((d) => d !== dateToRemove);
}

// Affecte manualDates depuis un picker (CUSTOM ou arbitraires récurrent). Une date
// (re)ajoutée est entièrement réactivée : on retire toutes ses DateSlots de
// disabledSlotKeys. Sans cela, une date dont toutes les DateSlots avaient été
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
			disabledSlotKeys.delete(formatSlotKey(d, slot.id));
		}
	}
	manualDates = dates;
}

// --- Portes de confirmation (intercept → confirm → commit/revert) ---
// Une action destructrice ne mute jamais le state directement depuis le rendu :
// elle passe par un handler `request*` qui décide commit direct vs confirmation.
//
// Deux patterns :
// - **changement structurel** : confirme en édition indépendamment des données
//   (reset, propagation d'horaires, suppression de créneau) — Portes 1, 5, 6
// - **suppression de données** : confirme seulement si une date avec données
//   participant est affectée — Portes 2, 3, 4

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
		title: msg.planform_confirm_change_type_title(),
		message: msg.planform_confirm_change_type_message(),
		variant: "warning",
		confirmLabel: msg.planform_confirm_change_type_button(),
		onConfirm: () => applyRecurrenceTypeChange(newValue)
	});
}

// Porte 2 — Changement de borne (firstDate/lastDate) : confirme seulement si des
// occurrences avec données sortent du nouveau cycle. Calcule le cycle candidat avec
// la nouvelle borne (fonction pure) et compare à l'actuel `allGeneratedDates`. Une
// date manuelle (sticky) reste couverte par `manualDates` même hors cycle → non à risque.
function commitDateChange(field: "firstDate" | "lastDate", newValue: string) {
	if (field === "firstDate") {
		firstDate = newValue;
	} else {
		lastDate = newValue;
		lastDateWasManuallySet = true;
	}
}

function requestDateChange(field: "firstDate" | "lastDate", newValue: string) {
	if (
		(field === "firstDate" && newValue === firstDate) ||
		(field === "lastDate" && newValue === lastDate)
	)
		return;
	if (recurrenceType === "CUSTOM" || datesWithData.length === 0) {
		commitDateChange(field, newValue);
		return;
	}
	const newCycle = new Set(
		generateRecurrenceDates({
			type: recurrenceType,
			firstDate: field === "firstDate" ? newValue : firstDate,
			lastDate: field === "lastDate" ? newValue : lastDate,
			monthlyByDayOccurrences:
				recurrenceType === "MONTHLY_BY_DAY" ? monthlyByDayOccurrences : undefined,
			monthlyByDateMode:
				recurrenceType === "MONTHLY_BY_DATE" ? effectiveMonthlyByDateMode : undefined
		})
	);
	const atRisk = views.allGeneratedDates.some(
		(d) => !newCycle.has(d) && datesWithData.includes(d) && !manualDates.includes(d)
	);
	if (!atRisk) {
		commitDateChange(field, newValue);
		return;
	}
	openConfirm({
		title: msg.planform_confirm_change_period_title(),
		message: msg.planform_confirm_change_period_message(),
		variant: "warning",
		confirmLabel: msg.planform_confirm_change_period_button(),
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
		title: msg.planform_confirm_delete_date_title(),
		message: msg.planform_confirm_delete_date_message(),
		variant: "warning",
		confirmLabel: msg.planform_confirm_delete_date_button(),
		onConfirm: () => {
			removeManualDate(dateToRemove);
			closePopover();
		}
	});
}

// Porte 4 — Désactivation d'une DateSlot générée : confirme si la date a des données.
// La réactivation ne se confirme jamais.
function requestDisableSlot(ds: DateSlot) {
	if (!datesWithData.includes(ds.date)) {
		setSlotEnabled(ds, false);
		closePopover();
		return;
	}
	openConfirm({
		title: msg.planform_confirm_disable_slot_title(),
		message: msg.planform_confirm_disable_slot_message(),
		variant: "warning",
		confirmLabel: msg.planform_confirm_disable_slot_button(),
		onConfirm: () => {
			setSlotEnabled(ds, false);
			closePopover();
		}
	});
}

// Applique un preset horaire au draft courant du modal (utilisé pour l'aperçu
// avant Apply). Muter directement le draft garantit que la validation du bouton
// Appliquer et les inputs restent synchrones.
function applyTimePreset(startTime: string, endTime: string) {
	if (!slotModal.state) return;
	slotModal.state.draft = { startTime, endTime };
}

function addTimeSlot() {
	openSlotModalCreate();
}

function removeTimeSlot(slotId: string) {
	// En création, suppression directe (aucune occurrence persistée). En édition,
	// la suppression d'un slot soft-deletera au save les occurrences liées à ce slot.
	// Pattern "changement structurel" : on confirme seulement si des occurrences
	// actives existent pour ce slot (`count > 0`). Sinon, suppression directe —
	// l'action n'est pas destructive.
	if (!master) {
		commitRemoveTimeSlot(slotId);
		return;
	}
	const count = views.activeDateSlots.filter((ds) => ds.slotId === slotId).length;
	if (count === 0) {
		commitRemoveTimeSlot(slotId);
		return;
	}
	const message =
		count === 1
			? msg.planform_slot_delete_message_one()
			: msg.planform_slot_delete_message_other({ count });
	openConfirm({
		title: msg.planform_slot_delete_title(),
		message,
		variant: "danger",
		confirmLabel: msg.planform_confirm_delete_date_button(),
		onConfirm: () => commitRemoveTimeSlot(slotId)
	});
}

function commitRemoveTimeSlot(slotId: string) {
	const index = timeSlots.findIndex((s) => s.id === slotId);
	if (index === -1) return;
	timeSlots.splice(index, 1);
	// Réinitialiser une éventuelle session d'édition sur le slot supprimé
	if (slotModal.state?.slotId === slotId) closeSlotModal();
}

// === Modal unifié d'ajout/édition d'un créneau ===
// Un seul modal sert aux deux flux : ajout (mode create) et modification (mode
// edit). À l'ouverture, le draft est pré-rempli (valeurs du slot édité, ou héritage
// du dernier slot à l'ajout, ou vide avec validation bloquante). Les presets
// horaires mute le draft. « Appliquer » branche sur le bon commit : push direct
// en create, flux confirm de propagation en edit (préservation overrides).
interface SlotModalState {
	mode: "create" | "edit";
	slotId: string | null;
	draft: { startTime: string; endTime: string };
}
let slotModal = $state<{ open: boolean; state: SlotModalState | null }>({
	open: false,
	state: null
});
let slotStartInput = $state<HTMLInputElement | undefined>(undefined);

$effect(() => {
	if (slotModal.open && slotStartInput) {
		slotStartInput.focus();
		slotStartInput.select();
	}
});

function openSlotModalCreate() {
	const last = timeSlots.at(-1);
	slotModal = {
		open: true,
		state: {
			mode: "create",
			slotId: null,
			draft: last
				? { startTime: last.startTime, endTime: last.endTime }
				: { startTime: "", endTime: "" }
		}
	};
}

function startSlotEdit(slotId: string) {
	const slot = timeSlots.find((s) => s.id === slotId);
	if (!slot) return;
	slotModal = {
		open: true,
		state: {
			mode: "edit",
			slotId,
			draft: { startTime: slot.startTime, endTime: slot.endTime }
		}
	};
}

function closeSlotModal() {
	slotModal = { open: false, state: null };
}

function applySlotEdit() {
	if (!slotModal.state) return;
	const { mode, slotId, draft } = slotModal.state;
	const { startTime: newStart, endTime: newEnd } = draft;
	if (!newStart || !newEnd) {
		toast.error(msg.planform_validation_incomplete_slot(), {
			description: msg.planform_validation_incomplete_slot_desc()
		});
		return;
	}
	if (mode === "create") {
		timeSlots.push({
			id: generateTimeSlotId(timeSlots),
			startTime: newStart,
			endTime: newEnd
		});
		closeSlotModal();
		return;
	}
	// mode 'edit'
	if (!slotId) {
		closeSlotModal();
		return;
	}
	const slot = timeSlots.find((s) => s.id === slotId);
	if (!slot) {
		closeSlotModal();
		return;
	}
	const oldStart = slot.startTime;
	const oldEnd = slot.endTime;
	if (newStart === oldStart && newEnd === oldEnd) {
		closeSlotModal();
		return;
	}
	// Sans master (pas d'occurrences seedées à propager), on mute directement
	// le slot. Avec master, on ferme d'abord le modal slot puis on ouvre le
	// ConfirmModal de propagation (on ne peut pas empiler deux modals) ; le
	// commit préserve les overrides individuels d'occurrences.
	if (!master) {
		slot.startTime = newStart;
		slot.endTime = newEnd;
		closeSlotModal();
		return;
	}
	closeSlotModal();
	openConfirm({
		title: msg.planform_confirm_apply_hours_title(),
		message: msg.planform_confirm_apply_hours_message(),
		variant: "warning",
		confirmLabel: msg.planform_confirm_apply_hours_button(),
		onConfirm: () => commitSlotEdit(slotId, newStart, newEnd, oldStart, oldEnd)
	});
}

// Applique la modification d'un créneau : propage aux occurrences seedées
// non-overridées (celles dont les horaires == ancien template) et mute le
// template. Les occurrences overridées restent intactes dans seededOccurrences.
// Les DateSlots non-seedées suivent automatiquement via le `$derived` occurrenceTargets.
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
}

async function handleSubmit() {
	// Marquer qu'une tentative de soumission a eu lieu
	hasAttemptedSubmit = true;

	// Reset des erreurs
	validationErrors = {};

	// Limite Phase 1 : 100 DateSlots futurs maximum (remplace l'ancienne
	// limite de 100 dates). En mono-slot, 1 slot = 1 DateSlot/date, donc équivalent.
	const futureActiveDateSlotCount = views.futureActiveDateSlotCount;
	if (futureActiveDateSlotCount > 100) {
		toast.error(msg.planform_toast_too_many(), {
			description: msg.planform_toast_too_many_desc({ count: futureActiveDateSlotCount })
		});
		return;
	}

	// Validation du titre
	if (!title.trim()) {
		validationErrors.title = true;
		toast.error(msg.planform_validation_title_required());
		return;
	}

	// Validation des créneaux : au moins 1 slot, et chacun doit avoir des horaires complets.
	// Les chevauchements et l'ordre chronologique ne sont PAS vérifiés en Phase 1.
	if (timeSlots.length === 0) {
		toast.error(msg.planform_validation_no_slots(), {
			description: msg.planform_validation_no_slots_desc()
		});
		return;
	}
	const incompleteSlot = timeSlots.find((s) => !s.startTime || !s.endTime);
	if (incompleteSlot) {
		toast.error(msg.planform_validation_incomplete_slot(), {
			description: msg.planform_validation_incomplete_slot_desc()
		});
		return;
	}

	// Validation : tâche en cours de création/modification
	if (newTaskName.trim()) {
		validationErrors.taskInProgress = true;
		toast.error(msg.planform_validation_task_in_progress(), {
			description:
				isEditingTask && editingTaskId
					? msg.planform_validation_task_edit_desc()
					: msg.planform_validation_task_create_desc()
		});
		return;
	}

	// Validation : session d'édition de slot ouverte (modal non appliqué)
	if (slotModal.open) {
		toast.error(msg.planform_validation_slot_editing(), {
			description: msg.planform_validation_slot_editing_desc()
		});
		return;
	}

	// Validation : au moins une tâche OU allowResponses activé
	const hasTasks = tasks.length > 0;
	const hasResponsesEnabled = allowResponses;

	if (!hasTasks && !hasResponsesEnabled) {
		validationErrors.tasks = true;
		validationErrors.responses = true;
		toast.error(msg.planform_validation_incomplete_config(), {
			description: msg.planform_validation_incomplete_config_desc()
		});
		return;
	}

	// Validation : au moins une réponse possible si allowResponses = true
	if (allowResponses && availableResponseTypes.length === 0) {
		validationErrors.responses = true;
		toast.error(msg.planform_validation_no_responses(), {
			description: msg.planform_validation_no_responses_desc()
		});
		return;
	}

	// Validation : au moins un DateSlot futur actif (unifie CUSTOM et récurrent).
	// En mono-slot cela équivaut à « au moins une date future sélectionnée ».
	const hasFutureActiveDateSlot = views.activeDateSlots.some((ds) => ds.date >= todayStr);
	if (views.activeDateSlots.length === 0) {
		validationErrors.dates = true;
		toast.error(msg.planform_validation_no_dates(), {
			description: msg.planform_validation_no_dates_desc()
		});
		return;
	}
	if (!hasFutureActiveDateSlot) {
		validationErrors.dates = true;
		toast.error(msg.planform_validation_past_dates(), {
			description: msg.planform_validation_past_dates_desc()
		});
		return;
	}
	if (recurrenceType !== "CUSTOM" && (!firstDate || !lastDate)) {
		toast.error(msg.planform_validation_dates_required());
		return;
	}

	// Pas de porte globale au submit : les 6 ConfirmModal just-in-time
	// couvrent déjà tous les chemins destructeurs. Une seconde porte serait
	// une double confirmation UX.

	// recurrence : seed déclaratif (type + bornes + monthlyByDay). La source
	// unique des occurrences est occurrenceTargets ci-dessous.
	const recurrence: RecurrenceConfig = {
		type: recurrenceType,
		...(recurrenceType !== "CUSTOM" && {
			firstDate,
			lastDate
		}),
		monthlyByDayOccurrences:
			recurrenceType === "MONTHLY_BY_DAY" ? monthlyByDayOccurrences : undefined,
		// effectiveMonthlyByDateMode est undefined quand le toggle est caché :
		// on ne persisted pas le mode inactif (inertie implicite).
		monthlyByDateMode: recurrenceType === "MONTHLY_BY_DATE" ? effectiveMonthlyByDateMode : undefined
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
		occurrenceTargets: views.occurrenceTargets.map((t) => ({ ...t })),
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
	if (recurrenceType === "CUSTOM") {
		return manualDates.length === 0
			? msg.planform_custom_label()
			: msg.planform_custom_count_definies({ count: manualDates.length });
	}

	// Pas de date de début définie
	if (!firstDate || !recurrenceType) return "";

	// Label de base de la récurrence
	const baseLabel = getRecurrenceLabel({
		type: recurrenceType,
		firstDate,
		lastDate,
		monthlyByDayOccurrences:
			recurrenceType === "MONTHLY_BY_DAY" ? monthlyByDayOccurrences : undefined,
		monthlyByDateMode: recurrenceType === "MONTHLY_BY_DATE" ? effectiveMonthlyByDateMode : undefined
	});

	// Ajouter les dates arbitraires si présentes
	const arbitraryCount = views.arbitraryDates.length;
	if (arbitraryCount > 0) {
		return `${baseLabel} ${arbitraryCount === 1 ? msg.planform_arbitrary_suffix_one({ count: arbitraryCount }) : msg.planform_arbitrary_suffix_other({ count: arbitraryCount })}`;
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
	<NetworkAlert message={msg.planform_network_offline()} />

	<!-- Informations principales -->
	<fieldset
		class="card card-xs sm:card-md bg-base-100 border-base-200 border shadow-sm"
		disabled={isSubmitting || isNetworkUnavailable}
	>
		<div class="card-body gap-4 sm:gap-6">
				<h3 class="card-title flex items-center gap-2 text-xl max-sm:p-2">
					<AlignLeft class="text-primary" />
					{msg.planform_general_info()}
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
							<span class="text-base">{msg.planform_confirm_event()}</span>
							<p class="text-sm text-wrap opacity-80">
								{msg.planform_confirm_description()}
							</p>
						</div>
					</label>
				</fieldset>

				<fieldset class="fieldset col-span-full">
					<legend class="fieldset-legend">{msg.planform_title_label()}</legend>
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
					<legend class="fieldset-legend">{msg.planform_description_label()}</legend>
					<RichTextEditor
						bind:value={description}
						disabled={isSubmitting}
						placeholder={msg.planform_description_placeholder()}
					/>
				</fieldset>

				<fieldset class="fieldset col-span-full">
					<label class="input w-full">
						<span class="label"><MapPin size={16} />{msg.planform_place_label()}</span>
						<input
							type="text"
							bind:value={place}
							class="w-full"
							placeholder={msg.planform_place_label()}
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
				{msg.planform_recurrence_section()}
			</h3>

			<div class="flex flex-col gap-4 sm:gap-6">
				<fieldset class="fieldset md:max-w-1/2">
					<legend class="fieldset-legend">{msg.planform_recurrence_type_label()}</legend>
					<select
						value={recurrenceType}
						class="select w-full"
						disabled={isSubmitting}
						onchange={(e) => requestRecurrenceTypeChange(e.currentTarget.value)}
					>
						<option value="DAILY">{msg.recurrence_type_daily()}</option>
						<option value="WEEKLY">{msg.recurrence_type_weekly()}</option>
						<option value="BIWEEKLY">{msg.planform_recurrence_option_biweekly()}</option>
						<option value="MONTHLY_BY_DATE">{msg.planform_recurrence_option_monthly_date()}</option>
						<option value="MONTHLY_BY_DAY">{msg.planform_recurrence_option_monthly_day()}</option>
						<option value="CUSTOM">{msg.recurrence_type_custom()}</option>
					</select>
				</fieldset>

				{#if recurrenceType === 'MONTHLY_BY_DAY'}
					<fieldset class="fieldset">
						<legend class="fieldset-legend">{msg.planform_occurrences_label()}</legend>
						<MultiSelect
							bind:selectedValues={monthlyByDayOccurrences}
							options={[
								{ value: 1, label: msg.recurrence_ordinal_1() },
								{ value: 2, label: msg.recurrence_ordinal_2() },
								{ value: 3, label: msg.recurrence_ordinal_3() },
								{ value: 4, label: msg.recurrence_ordinal_4() },
								{ value: 5, label: msg.recurrence_ordinal_5() }
							]}
							placeholder={msg.planform_occurrences_placeholder()}
						/>
					</fieldset>
				{/if}

				{#if recurrenceType !== 'CUSTOM'}
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<fieldset class="fieldset">
							<legend class="fieldset-legend">{msg.planform_date_from()}</legend>
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
							<legend class="fieldset-legend">{msg.planform_date_to()}</legend>
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

				{#if showMonthlyByDateMode}
					{@const dayNumber = parse(firstDate, 'yyyy-MM-dd', new Date()).getDate()}
					{@const monthName = formatDate(parse(firstDate, 'yyyy-MM-dd', new Date()), 'MMMM')}
					<div class="alert alert-info alert-soft">
						<fieldset class="fieldset flex flex-wrap gap-3">
							<legend class="text-sm font-medium">
								{msg.planform_monthly_date_prompt({ monthName })}
							</legend>
							<label class="label cursor-pointer justify-start gap-2 text-sm">
								<input
									type="radio"
									name="monthly-by-date-mode"
									class="radio"
									checked={monthlyByDateMode !== 'last-day'}
									onchange={() => (monthlyByDateMode = 'fixed-day')}
								/>
								<span>{msg.planform_monthly_date_fixed({ dayNumber })}</span>
							</label>
							<label class="label cursor-pointer justify-start gap-2 text-sm">
								<input
									type="radio"
									name="monthly-by-date-mode"
									class="radio"
									checked={monthlyByDateMode === 'last-day'}
									onchange={() => (monthlyByDateMode = 'last-day')}
								/>
								<span>{msg.planform_monthly_date_last()}</span>
							</label>
						</fieldset>
					</div>
				{/if}
			</div>

			{#snippet dateSlotBadge(ds: DateSlot)}
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
							? msg.planform_slot_data_warning()
							: msg.planform_slot_click_hint()}
					>
						{#if willBeDeleted}
							<Trash2 class="mr-1" />
						{/if}
						{formatDate(parse(ds.date, 'yyyy-MM-dd', new Date()), 'EEE d MMM')}
						{#if showSlot}
							<span class="opacity-80"
								>· {displayTimes(ds).startTime}-{displayTimes(ds).endTime}</span
							>
						{/if}
					</button>
					{#if activePopoverKey === formatSlotKey(ds.date, ds.slotId)}
						<div
							data-slot-ui
							class="bg-base-100 ring-base-300 fixed z-50 mt-1 w-56 rounded-xl p-3 shadow-lg ring-1"
							style="top:{popoverPos.top}px; left:{popoverPos.left}px;"
						>
							<div class="text-base-content/70 mb-1 text-xs">
							{formatDate(parse(ds.date, 'yyyy-MM-dd', new Date()), 'EEE d MMM')}
							</div>
							{#if master && isSelected}
								<div class="mb-2">
									<div class="mb-1 text-xs font-medium opacity-70">{msg.planform_slot_hours()}</div>
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
											<Check size={14} /> {msg.common_apply()}
										</button>
										{#if isOverriddenDateSlot(ds)}
											<button
												type="button"
												class="btn btn-ghost btn-sm btn-square"
												title={msg.planform_slot_reset_title()}
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
										<Trash2 size={14} /> {msg.common_delete()}
									</button>
								{:else if isSelected}
									<button
										type="button"
										class="btn btn-error btn-sm"
										onclick={() => requestDisableSlot(ds)}
									>
										<Trash2 size={14} /> {msg.common_disable()}
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
										{msg.common_reactivate()}
									</button>
								{/if}
								<button type="button" class="btn btn-ghost btn-sm" onclick={closePopover}
									>{msg.common_close()}</button
								>
							</div>
						</div>
					{/if}
				</div>
			{/snippet}

			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<Clock class="text-primary" size={18} />
					<span class="font-medium">{msg.planform_slot_section()}</span>
				</div>

				{#each timeSlots as slot (slot.id)}
					<div class="bg-base-200/50 flex items-center justify-between gap-2 rounded-lg px-3 py-2">
						<div class="flex items-center gap-2">
							<Clock size={16} class="text-primary" />
							<span class="font-medium tabular-nums">{slot.startTime} – {slot.endTime}</span>
						</div>
						<div class="flex gap-1">
							<button
								type="button"
								class="btn btn-ghost btn-sm btn-square"
								onclick={() => startSlotEdit(slot.id)}
								disabled={isSubmitting || slotModal.open}
								aria-label={msg.planform_slot_edit_aria()}
								title={msg.planform_slot_edit_title()}
							>
								<Pencil size={16} />
							</button>
							{#if timeSlots.length > 1}
								<button
									type="button"
									class="btn btn-ghost btn-sm btn-square text-error"
									onclick={() => removeTimeSlot(slot.id)}
									disabled={isSubmitting || slotModal.open}
									aria-label={msg.planform_slot_delete_aria()}
								>
									<Trash2 size={16} />
								</button>
							{/if}
						</div>
					</div>
				{/each}

				<button
					type="button"
					class="btn btn-ghost btn-sm w-fit"
					onclick={addTimeSlot}
					disabled={isSubmitting || slotModal.open}
				>
					<Plus size={16} /> {msg.planform_slot_add()}
				</button>
			</div>

			{#if recurrenceType !== 'CUSTOM' && views.allGeneratedDates.length > 0}
				<div
					class="mt-4 space-y-3 {validationErrors.dates
						? 'ring-error rounded-xl p-2 ring-2 ring-offset-2'
						: ''}"
				>
					<div class="flex items-end justify-between">
					<div class="font-bold">
						{#if showSlot}
							{msg.planform_selection_title_multi({ activeCount: views.activeDateSlots.length, totalCount: views.allDateSlots.length })}
						{:else}
							{msg.planform_selection_title_single({ activeCount: views.activeDateSlots.length, totalCount: views.allDateSlots.length })}
						{/if}
					</div>
						<div class="text-base-content/60 font-medium italic">{recurrenceLabel}</div>
					</div>
					<div class="bg-base-200/50 flex max-h-64 flex-wrap gap-2 overflow-y-auto rounded-xl p-4">
						{#each views.displayedDateSlots as ds (formatSlotKey(ds.date, ds.slotId))}
							{@render dateSlotBadge(ds)}
						{/each}
					</div>
					{#if views.hiddenPastDateCount > 0}
						<p class="text-base-content/60 mt-2 text-xs italic">{hiddenPastLabel}</p>
					{/if}

					{#if views.activeDateSlots.filter((ds) => ds.date >= todayStr).length > 100}
						<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
							<span class="flex-1">
								{#if showSlot}
									{msg.planform_limit_warning_multi()}
								{:else}
									{msg.planform_limit_warning_single()}
								{/if}
							</span>
							{#if maxAdjustDate}
								<button
									type="button"
									class="btn btn-warning btn-sm"
									onclick={() => {
										lastDate = maxAdjustDate;
										lastDateWasManuallySet = true;
									}}
								>
									{msg.planform_adjust_to({ date: maxAdjustDateLabel })}
								</button>
							{/if}
						</div>
					{/if}

					{#if datesWithData.some((d) => !views.activeDates.has(d))}
						<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
							<Trash2 size={16} />
							<span>{msg.planform_deleted_dates_warning()}</span>
						</div>
					{/if}

					<!-- Bouton pour ajouter des dates arbitraires -->
					{#if showArbitraryDatePicker}
						<div class="border-base-300 mt-4 space-y-3 border-t pt-4">
							<div class="flex items-center justify-between">
								<h4 class="text-sm font-medium">{msg.planform_arbitrary_title()}</h4>
								<button
									type="button"
									class="btn btn-ghost sm:btn-sm"
									onclick={() => (showArbitraryDatePicker = false)}
								>
									{msg.common_close()}
								</button>
							</div>
							<MultiDatePicker
								selectedDates={manualDates}
								excludeDates={views.allGeneratedDates}
								maxSelection={views.maxManualDatesForLimit}
								onChange={setManualDates}
								minDate={todayStr}
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
								{msg.planform_arbitrary_link()}
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
							{msg.planform_custom_dates_title({ activeCount: views.activeDateSlots.length, totalCount: views.allDateSlots.length })}
						{:else}
							{msg.planform_custom_dates_title_noslot({ count: manualDates.length })}
						{/if}
					</div>
					<div class="flex items-center">
						<Calendar size={16} />
						<span>{msg.planform_custom_dates_count({ count: manualDates.length })}</span>
					</div>
					</div>

					<MultiDatePicker
						selectedDates={manualDates}
						excludeDates={[]}
						maxSelection={views.maxManualDatesForLimit}
						onChange={setManualDates}
						minDate={todayStr}
					/>

					{#if manualDates.length > 0}
						<div
							class="bg-base-200/50 mt-4 flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-xl p-4"
						>
							{#each views.displayedDateSlots as ds (formatSlotKey(ds.date, ds.slotId))}
								{@render dateSlotBadge(ds)}
							{/each}
						</div>
						{#if views.hiddenPastDateCount > 0}
							<p class="text-base-content/60 mt-2 text-xs italic">{hiddenPastLabel}</p>
						{/if}
					{/if}

					{#if manualDates.length > 0}
						{@const futureActiveDateSlotCount = views.activeDateSlots.filter(
							(ds) => ds.date >= todayStr
						).length}
						{#if futureActiveDateSlotCount > 100}
							<div class="alert alert-warning rounded-xl py-2 text-sm shadow-sm">
							<span>
								{#if showSlot}
									{msg.planform_limit_warning_multi()}
								{:else}
									{msg.planform_limit_warning_single()}
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
				{msg.planform_responses_section()}
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
							<span class="label-text text-base">{msg.planform_allow_responses()}</span>
							<p class="text-sm text-wrap opacity-80">
								{msg.planform_allow_responses_desc()}
							</p>
						</div>
					</label>
				</fieldset>

				<!-- Sélection des ResponseType -->
				{#if allowResponses}
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-medium">{msg.planform_min_present_label()}</legend>
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
							{msg.planform_min_present_hint()}
						</p>
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-medium">{msg.planform_response_types_label()}</legend>
						<p class="text-base-content/50 mb-3 text-sm">
							{msg.planform_response_types_hint()}
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
										{RESPONSE_TYPE_LABELS[responseType]()}
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
					{msg.planform_task_list()}
				</h4>
				{#if master && datesWithSpecificTasks.length > 0}
					<div class="alert alert-info max-sm:alert-vertical rounded-2xl shadow-sm">
						<AlignLeft size={20} />
						<div class="flex-1">
							<h4 class="font-semibold">{msg.planform_task_custom_detected()}</h4>
							<p class="text-sm opacity-70">
								{msg.planform_task_custom_desc({ count: datesWithSpecificTasks.length })}
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
							<span class="label-text text-sm font-medium">{msg.planform_task_replace_all()}</span>
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
							title={msg.planform_task_delete_tooltip()}
						>
							<Trash2 size={14} />
						</button>
						<div class="badge badge-outline">{msg.planform_task_volunteers({ count: task.requiredVolunteers })}</div>

						<div class="flex gap-1">
							<!-- Bouton édition -->
							<button
								type="button"
								class="btn btn-ghost btn-circle"
								onclick={() => editTask(task.id)}
								disabled={isSubmitting}
								title={msg.planform_task_edit_tooltip()}
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
									<span>{msg.planform_task_editing_banner()}</span>
								</div>
							{/if}
							<fieldset class="fieldset">
								<label class="input w-full {validationErrors.taskInProgress ? 'input-error' : ''}">
									<input
										type="text"
										bind:value={newTaskName}
										bind:this={taskNameInput}
										placeholder={msg.planform_task_name_placeholder()}
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
										title={msg.planform_task_add_title()}
									>
										<Plus size={16} />
									</button>
								</label>
							</fieldset>
							<div class="grid grid-cols-2 gap-3">
								<fieldset class="fieldset">
									<legend class="fieldset-legend">{msg.planform_task_header_label()}</legend>
									<input
										type="number"
										bind:value={newTaskVolunteers}
										class="input w-full"
										min="1"
										placeholder={msg.planform_task_header_count()}
										disabled={isSubmitting}
										max="1000"
									/>
								</fieldset>
								<fieldset class="fieldset">
									<legend class="fieldset-legend">{msg.planform_task_moment_label()}</legend>
									<select bind:value={newTaskType} class="select w-full" disabled={isSubmitting}>
										<option value="beforeEvent">{msg.task_type_before()}</option>
										<option value="onEvent">{msg.task_type_during()}</option>
										<option value="afterEvent">{msg.task_type_after()}</option>
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
									{msg.common_cancel()}
								</button>
							{/if}
							{#if isEditingTask}
								<button type="button" class="btn sm:btn-sm btn-ghost" onclick={cancelTaskEdit}
									>{msg.common_cancel()}</button
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
								{isEditingTask ? msg.planform_task_edit_confirm() : msg.planform_task_add_confirm()}
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
			{msg.common_cancel()}
		</button>
		<button type="submit" class="btn btn-primary px-8" disabled={isSubmitting}>
			{#if isSubmitting}
				<span class="loading loading-spinner loading-sm"></span>
			{/if}

			<span class="hidden md:block">
				{master ? msg.planform_submit_edit() : msg.planform_submit_create()}</span
			>

			<span class="md:hidden"> {master ? msg.planform_submit_edit_mobile() : msg.planform_submit_create_mobile()}</span>
		</button>
	</div>
</form>

<Modal
	open={slotModal.open}
	onClose={closeSlotModal}
	title={slotModal.state?.mode === 'edit' ? msg.planform_slot_modal_title_edit() : msg.planform_slot_modal_title_add()}
	size="sm"
>
	{#if slotModal.state}
		<div class="space-y-4">
			<div class="grid grid-cols-2 gap-3">
				<fieldset class="fieldset">
					<legend class="fieldset-legend flex items-center gap-2">
						<Clock size={16} /> {msg.planform_slot_modal_start()}
					</legend>
					<input
						type="time"
						bind:this={slotStartInput}
						bind:value={slotModal.state.draft.startTime}
						class="input w-full"
						required
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend flex items-center gap-2">
						<Clock size={16} /> {msg.planform_slot_modal_end()}
					</legend>
					<input
						type="time"
						bind:value={slotModal.state.draft.endTime}
						class="input w-full"
						required
					/>
				</fieldset>
			</div>

			<div class="space-y-2">
				<p class="text-base-content/70 text-xs font-medium">{msg.planform_slot_modal_presets()}</p>
				<div class="grid grid-cols-2 gap-2">
					<button
						type="button"
						class="btn btn-ghost btn-xs bg-base-200 h-auto flex-col"
						onclick={() => applyTimePreset('08:00', '12:00')}
					>
						<span>{msg.planform_slot_modal_preset_morning()}</span>
						<span class="opacity-70">8h–12h</span>
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-xs bg-base-200 h-auto flex-col"
						onclick={() => applyTimePreset('13:00', '18:00')}
					>
						<span>{msg.planform_slot_modal_preset_afternoon()}</span>
						<span class="opacity-70">13h–18h</span>
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-xs bg-base-200 h-auto flex-col"
						onclick={() => applyTimePreset('19:00', '23:00')}
					>
						<span>{msg.planform_slot_modal_preset_evening()}</span>
						<span class="opacity-70">19h–23h</span>
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-xs bg-base-200 h-auto flex-col"
						onclick={() => applyTimePreset('08:00', '23:00')}
					>
						<span>{msg.planform_slot_modal_preset_full_day()}</span>
						<span class="opacity-70">8h–23h</span>
					</button>
				</div>
			</div>
		</div>
	{/if}
	{#snippet actions()}
		<button type="button" class="btn btn-ghost" onclick={closeSlotModal}>{msg.common_cancel()}</button>
		<button
			type="button"
			class="btn btn-primary"
			onclick={applySlotEdit}
			disabled={!slotModal.state?.draft.startTime || !slotModal.state?.draft.endTime}
		>
			{msg.common_apply()}
		</button>
	{/snippet}
</Modal>

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
