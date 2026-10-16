import type { Task, TaskType } from "$lib/types/planning.types";

/** Trie les tâches dans l'ordre canonique d'exécution (avant/pendant/après l'événement). */
export function sortTasks(tasks: Task[] | null | undefined): Task[] | null {
	if (!tasks || tasks.length === 0) return null;
	const order: Record<TaskType, number> = { beforeEvent: 1, onEvent: 2, afterEvent: 3 };
	return [...tasks].sort((a, b) => order[a.type] - order[b.type]);
}
