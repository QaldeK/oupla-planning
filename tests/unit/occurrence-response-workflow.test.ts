/**
 * Tests unitaires — occurrenceResponseWorkflow : la maison unique du workflow
 * de réponse aux occurrences.
 *
 * Couvre la règle « tâche onEvent ⟹ présent » (garde de changement de réponse,
 * matrice de toggle, construction de ParticipantResponse) et l'orchestration
 * pending → confirmation → soumission, paramétrée par l'acteur (self | admin).
 *
 * Environnement : node pur — la factory ne connaît ni réseau ni notification
 * (`submitChange` injecté) ; la locale paraglide est épinglée sur la base
 * locale (en) par le setup global.
 */
import { describe, expect, it, vi } from "vitest";
import {
	buildParticipantResponse,
	createOccurrenceResponseWorkflow,
	deriveConfirmationMessage,
	onEventInscribedIds,
	resolveTaskToggleOutcome
} from "$lib/components/occurrences/shared/occurrenceResponseWorkflow.svelte";
import type { Task } from "$lib/types/planning.types";

const onEventTask: Task = { id: "t1", name: "Accueil", type: "onEvent", requiredVolunteers: 1 };
const secondOnEventTask: Task = {
	id: "t4",
	name: "Caisse",
	type: "onEvent",
	requiredVolunteers: 1
};
const beforeTask: Task = { id: "t2", name: "Installation", type: "beforeEvent", requiredVolunteers: 1 };
const afterTask: Task = { id: "t3", name: "Rangement", type: "afterEvent", requiredVolunteers: 1 };

describe("onEventInscribedIds", () => {
	it("ne retient que les tâches onEvent parmi les inscriptions", () => {
		const tasks = [onEventTask, beforeTask, afterTask, secondOnEventTask];
		expect(onEventInscribedIds(tasks, ["t1", "t2", "t3"])).toEqual(["t1"]);
	});

	it("retourne vide sans inscription onEvent", () => {
		expect(onEventInscribedIds([onEventTask], ["t2"])).toEqual([]);
		expect(onEventInscribedIds([], ["t1"])).toEqual([]);
	});
});

describe("buildParticipantResponse", () => {
	it("construit la forme complète, sans champ legacy comment", () => {
		const response = buildParticipantResponse({
			participantId: "p1",
			response: "maybe",
			tasks: ["t1"]
		});

		expect(response).toEqual({
			participantId: "p1",
			response: "maybe",
			tasks: ["t1"],
			respondedAt: expect.any(String)
		});
		expect("comment" in response).toBe(false);
	});

	it("horodate respondedAt en ISO", () => {
		const response = buildParticipantResponse({ participantId: "p1", response: "present", tasks: [] });
		expect(Number.isNaN(Date.parse(response.respondedAt))).toBe(false);
	});
});

describe("resolveTaskToggleOutcome — matrice « onEvent ⟹ présent »", () => {
	const cases: Array<{
		name: string;
		task: Task;
		currentResponse: Parameters<typeof resolveTaskToggleOutcome>[0]["currentResponse"];
		allowResponses: boolean;
		isAdding: boolean;
		expected: string;
	}> = [
		// Ajout sans réponse : present posé d'office (self ET admin).
		{ name: "ajout onEvent sans réponse", task: onEventTask, currentResponse: undefined, allowResponses: true, isAdding: true, expected: "autoPresent" },
		// Ajout en conflit : refus, quelle que soit la réponse ≠ present.
		{ name: "ajout onEvent avec maybe", task: onEventTask, currentResponse: "maybe", allowResponses: true, isAdding: true, expected: "refuse" },
		{ name: "ajout onEvent avec absent", task: onEventTask, currentResponse: "absent", allowResponses: true, isAdding: true, expected: "refuse" },
		{ name: "ajout onEvent avec if_needed", task: onEventTask, currentResponse: "if_needed", allowResponses: true, isAdding: true, expected: "refuse" },
		// Déjà present : rien à faire.
		{ name: "ajout onEvent déjà present", task: onEventTask, currentResponse: "present", allowResponses: true, isAdding: true, expected: "none" },
		// Retrait : la réponse n'est jamais touchée, même ≠ present.
		{ name: "retrait onEvent avec maybe", task: onEventTask, currentResponse: "maybe", allowResponses: true, isAdding: false, expected: "none" },
		{ name: "retrait onEvent sans réponse", task: onEventTask, currentResponse: undefined, allowResponses: true, isAdding: false, expected: "none" },
		// beforeEvent/afterEvent : aucune incidence sur la réponse.
		{ name: "ajout beforeEvent avec maybe", task: beforeTask, currentResponse: "maybe", allowResponses: true, isAdding: true, expected: "none" },
		{ name: "ajout afterEvent sans réponse", task: afterTask, currentResponse: undefined, allowResponses: true, isAdding: true, expected: "none" },
		// Réponses désactivées sur le planning : pas de règle de présence.
		{ name: "onEvent sans allowResponses", task: onEventTask, currentResponse: "maybe", allowResponses: false, isAdding: true, expected: "none" }
	];

	for (const c of cases) {
		it(c.name, () => {
			const outcome = resolveTaskToggleOutcome({
				task: c.task,
				currentResponse: c.currentResponse,
				allowResponses: c.allowResponses,
				isAdding: c.isAdding
			});
			expect(outcome.kind).toBe(c.expected);
		});
	}
});

describe("deriveConfirmationMessage", () => {
	it("self — singulier, à la 2e personne", () => {
		const message = deriveConfirmationMessage("self", ["Accueil"]);
		expect(message).toContain("You are subscribed to task");
		expect(message).toContain("Accueil");
		expect(message).not.toContain("Alice");
	});

	it("self — pluriel avec les deux tâches", () => {
		const message = deriveConfirmationMessage("self", ["Accueil", "Caisse"]);
		expect(message).toContain("2 tasks");
		expect(message).toContain("Accueil");
		expect(message).toContain("Caisse");
	});

	it("admin — singulier, nommé à la 3e personne", () => {
		const message = deriveConfirmationMessage("admin", ["Accueil"], "Alice");
		expect(message).toContain("Alice");
		expect(message).toContain("Accueil");
		expect(message).not.toContain("You are subscribed");
	});

	it("admin — pluriel nommé", () => {
		const message = deriveConfirmationMessage("admin", ["Accueil", "Caisse"], "Alice");
		expect(message).toContain("Alice");
		expect(message).toContain("2 tasks");
	});
});

function makeWorkflow(overrides: {
	actor?: "self" | "admin";
	tasks?: Task[];
	getDisplayName?: (participantId: string) => string;
} = {}) {
	const submitChange = vi.fn().mockResolvedValue(undefined);
	let catalog: Task[] = overrides.tasks ?? [onEventTask, beforeTask, secondOnEventTask];
	let inscribed: string[] = ["t1"];

	const workflow = createOccurrenceResponseWorkflow(() => ({
		actor: overrides.actor ?? "self",
		tasks: () => catalog,
		getInscribedTaskIds: () => inscribed,
		getDisplayName: overrides.getDisplayName,
		submitChange
	}));

	return {
		workflow,
		submitChange,
		setInscribed: (ids: string[]) => {
			inscribed = ids;
		},
		setTasks: (tasks: Task[]) => {
			catalog = tasks;
		}
	};
}

describe("createOccurrenceResponseWorkflow — la garde onEvent", () => {
	it("met en pending quand la cible ≠ present et qu'on est inscrit·e onEvent", () => {
		const { workflow, submitChange } = makeWorkflow();

		workflow.requestResponseChange("p1", "maybe");

		expect(workflow.pendingResponseChange).toEqual({
			participantId: "p1",
			participantName: "",
			targetResponse: "maybe",
			onEventTaskIds: ["t1"]
		});
		expect(submitChange).not.toHaveBeenCalled();
	});

	it("soumet directement quand la cible est present", () => {
		const { workflow, submitChange } = makeWorkflow();

		workflow.requestResponseChange("p1", "present");

		expect(workflow.pendingResponseChange).toBeNull();
		expect(submitChange).toHaveBeenCalledWith({ participantId: "p1", response: "present", tasks: ["t1"] });
	});

	it("soumet directement sans inscription onEvent", () => {
		const { workflow, submitChange, setInscribed } = makeWorkflow();
		setInscribed(["t2"]);

		workflow.requestResponseChange("p1", "absent");

		expect(workflow.pendingResponseChange).toBeNull();
		expect(submitChange).toHaveBeenCalledWith({ participantId: "p1", response: "absent", tasks: ["t2"] });
	});

	it("n'ignore pas une 2e tâche onEvent inscrite (pending multi)", () => {
		const { workflow, setInscribed } = makeWorkflow();
		setInscribed(["t1", "t2", "t4"]);

		workflow.requestResponseChange("p1", "maybe");

		expect(workflow.pendingResponseChange?.onEventTaskIds).toEqual(["t1", "t4"]);
	});
});

describe("createOccurrenceResponseWorkflow — confirmation", () => {
	it("retire les tâches onEvent du pending et soumet la réponse cible", () => {
		const { workflow, submitChange, setInscribed } = makeWorkflow();
		setInscribed(["t1", "t2", "t4"]);
		workflow.requestResponseChange("p1", "maybe");

		workflow.confirmResponseChange();

		expect(submitChange).toHaveBeenCalledTimes(1);
		expect(submitChange).toHaveBeenCalledWith({
			participantId: "p1",
			response: "maybe",
			tasks: ["t2"]
		});
		expect(workflow.pendingResponseChange).toBeNull();
	});

	it("lit les inscriptions au moment de la confirmation, pas de la demande", () => {
		const { workflow, submitChange, setInscribed } = makeWorkflow();
		workflow.requestResponseChange("p1", "maybe");
		setInscribed(["t1", "t3"]);

		workflow.confirmResponseChange();

		expect(submitChange).toHaveBeenCalledWith({
			participantId: "p1",
			response: "maybe",
			tasks: ["t3"]
		});
	});

	it("annulation : pending purgé, aucune soumission", () => {
		const { workflow, submitChange } = makeWorkflow();
		workflow.requestResponseChange("p1", "absent");

		workflow.cancelResponseChange();

		expect(workflow.pendingResponseChange).toBeNull();
		expect(submitChange).not.toHaveBeenCalled();
	});

	it("confirmation sans pending : no-op", () => {
		const { workflow, submitChange } = makeWorkflow();

		workflow.confirmResponseChange();

		expect(submitChange).not.toHaveBeenCalled();
	});
});

describe("createOccurrenceResponseWorkflow — message de confirmation", () => {
	it("self : le message s'adresse au participant", () => {
		const { workflow } = makeWorkflow();
		workflow.requestResponseChange("p1", "maybe");

		expect(workflow.confirmationMessage).toContain("You are subscribed to task");
	});

	it("admin : le message nomme le participant", () => {
		const { workflow } = makeWorkflow({
			actor: "admin",
			getDisplayName: (id) => (id === "p1" ? "Alice" : "Inconnu")
		});
		workflow.requestResponseChange("p1", "maybe");

		expect(workflow.confirmationMessage).toContain("Alice");
		expect(workflow.confirmationMessage).toContain("Accueil");
		expect(workflow.confirmationMessage).not.toContain("You are subscribed");
	});

	it("null tant qu'aucun changement n'est en attente", () => {
		const { workflow } = makeWorkflow();
		expect(workflow.confirmationMessage).toBeNull();
	});

	it("null si les tâches du pending disparaissent du catalogue (sync, édition)", () => {
		const { workflow, setTasks } = makeWorkflow();
		workflow.requestResponseChange("p1", "maybe");
		expect(workflow.confirmationMessage).not.toBeNull();

		setTasks([beforeTask]);

		expect(workflow.confirmationMessage).toBeNull();
	});
});
