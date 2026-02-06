<script lang="ts">
	interface Task {
		name: string;
		description?: string;
		type?: TaskType;
	}

	type TaskType = 'beforeEvent' | 'afterEvent' | 'onEvent' | 'default';

	interface Props {
		/** Liste des tâches non attribuées */
		className: '';
		unassignedTasks: Task[];
	}

	let { unassignedTasks = [], className = '' }: Props = $props();
</script>

{#if unassignedTasks.length > 0}
	<div class="text-base-content/60 flex flex-wrap gap-1 {className}">
		<div class="text-fluid-sm me-2 font-medium">Tâches non attribuées:</div>
		<div class="flex flex-wrap gap-1">
			{#each unassignedTasks as task, index (task.name + index)}
				<span title={task.description} class="badge badge-dash badge-sm font-medium"
					>{task.name}</span
				>
			{/each}
		</div>
	</div>
{:else}
	<div class="text-fluid-sm text-base-content/60 text-right italic {className}">
		Toutes les tâches sont attribuées
	</div>
{/if}
