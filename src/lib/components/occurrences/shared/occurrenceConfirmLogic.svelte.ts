import { toast } from "svelte-sonner";
import * as m from "$lib/paraglide/messages.js";
import { updateOccurrence } from "$lib/services/planningActions";
import type { PlanningOccurrence, ResponseType, Task } from "$lib/types/planning.types";
import { formatDateShort } from "$lib/utils/date";

interface ConfirmLogicOptions {
	occurrence: PlanningOccurrence;
	token: string | undefined;
	toConfirm: boolean;
	occState: {
		masterConfig: { allowResponses: boolean; availableResponseTypes: ResponseType[] };
		inherited: { tasks: Task[]; minPresentRequired: number | undefined };
		stats: { present: number };
		pendingResponseChange: { targetResponse: ResponseType; onEventTaskIds: string[] } | null;
	};
}

export interface ConfirmLogic {
	readonly confirmModalState: {
		open: boolean;
		title: string;
		message: string;
		description: string;
		confirmLabel: string;
		variant: "danger" | "warning" | "info" | "success";
		onConfirm: () => void;
	};
	readonly missingPresences: number;
	readonly incompleteTasks: Task[];
	readonly needsConfirmationWarning: boolean;
	readonly responseChangeModal: { message: string } | null;
	openRestoreModal: () => void;
	toggleConfirm: () => void;
}

export function createConfirmLogic(getOptions: () => ConfirmLogicOptions): ConfirmLogic {
	const options = $derived(getOptions());

	let confirmModalState = $state({
		open: false,
		title: "",
		message: "",
		description: "",
		confirmLabel: "",
		variant: "info" as "danger" | "warning" | "info" | "success",
		onConfirm: () => {}
	});

	const missingPresences = $derived(
		options.occState.masterConfig.allowResponses &&
			options.occState.inherited.minPresentRequired &&
			options.occState.stats.present < options.occState.inherited.minPresentRequired
			? options.occState.inherited.minPresentRequired - options.occState.stats.present
			: 0
	);

	const incompleteTasks = $derived.by(() => {
		return options.occState.inherited.tasks.filter((task) => {
			const volunteers = options.occurrence.responses.filter((r) =>
				r.tasks?.includes(task.id)
			).length;
			return volunteers < task.requiredVolunteers;
		});
	});

	const needsConfirmationWarning = $derived(missingPresences > 0 || incompleteTasks.length > 0);

	const responseChangeModal = $derived.by(() => {
		const pending = options.occState.pendingResponseChange;
		if (!pending) return null;
		const taskNames = pending.onEventTaskIds
			.map((id) => options.occState.inherited.tasks.find((t) => t.id === id)?.name)
			.filter((n): n is string => Boolean(n));
		if (taskNames.length === 0) return null;
		const isPlural = taskNames.length > 1;
		return {
			message: isPlural
				? m.occurrence_response_change_subscribed_multi({
						count: taskNames.length,
						tasks: taskNames.join(", ")
					})
				: m.occurrence_response_change_subscribed_single({ task: taskNames[0] })
		};
	});

	function openRestoreModal() {
		if (!options.token) return;

		confirmModalState = {
			open: true,
			title: "Rétablir l'événement ?",
			message: `L'événement du ${formatDateShort(options.occurrence.date)} sera rétabli.`,
			description:
				"Les participants ayant activé les notifications seront informés du rétablissement.",
			confirmLabel: "Rétablir",
			variant: "warning",
			onConfirm: executeRestore
		};
	}

	async function executeRestore() {
		confirmModalState.open = false;
		const token = options.token;
		if (!token) return;
		try {
			await updateOccurrence(
				options.occurrence.id,
				{ isCanceled: false, isConfirmed: !options.toConfirm },
				token
			);
			toast.success(m.occurrence_restored());
		} catch (_error) {
			toast.error(m.occurrence_restore_error());
			console.error(_error);
		}
	}

	function toggleConfirm() {
		if (!options.token) return;

		const isCurrentlyConfirmed = options.occurrence.isConfirmed;
		const warnings: string[] = [];

		if (needsConfirmationWarning && !isCurrentlyConfirmed) {
			if (missingPresences > 0) warnings.push(`${missingPresences} participant(s) manquant(s)`);
			if (incompleteTasks.length > 0)
				warnings.push(`${incompleteTasks.length} tâche(s) non remplie(s)`);
		}

		const warningDetail = warnings.length > 0 ? ` Détails : ${warnings.join(" et ")}.` : "";

		confirmModalState = {
			open: true,
			title: isCurrentlyConfirmed ? "Annuler la confirmation ?" : "Confirmer l'événement ?",
			message: isCurrentlyConfirmed
				? `La confirmation du ${formatDateShort(options.occurrence.date)} sera annulée.`
				: warnings.length > 0
					? "Le quorum ou les besoins en tâches ne sont pas atteints."
					: `Confirmer la tenue de l'événement du ${formatDateShort(options.occurrence.date)} ?`,
			description: `Les participants ayant activé les notifications seront informés.${warningDetail}`,
			confirmLabel: isCurrentlyConfirmed
				? "Annuler la confirmation"
				: warnings.length > 0
					? "Confirmer quand même"
					: "Confirmer",
			variant: isCurrentlyConfirmed ? "warning" : warnings.length > 0 ? "warning" : "success",
			onConfirm: executeConfirm
		};
	}

	async function executeConfirm() {
		confirmModalState.open = false;
		const token = options.token;
		if (!token) return;
		try {
			const updated = await updateOccurrence(
				options.occurrence.id,
				{ isConfirmed: !options.occurrence.isConfirmed, isCanceled: false },
				token
			);
			toast.success(updated.isConfirmed ? m.occurrence_confirmed() : m.occurrence_cancelled());
		} catch (_error) {
			toast.error(m.occurrence_confirm_error());
			console.error(_error);
		}
	}

	return {
		get confirmModalState() {
			return confirmModalState;
		},
		get missingPresences() {
			return missingPresences;
		},
		get incompleteTasks() {
			return incompleteTasks;
		},
		get needsConfirmationWarning() {
			return needsConfirmationWarning;
		},
		get responseChangeModal() {
			return responseChangeModal;
		},
		openRestoreModal,
		toggleConfirm
	};
}
