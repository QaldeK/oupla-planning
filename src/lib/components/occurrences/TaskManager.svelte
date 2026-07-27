<script lang="ts">
import { CircleAlert, ClipboardCheck, Pencil, Plus, RefreshCcw, Trash2 } from "@lucide/svelte";
import { fade, slide } from "svelte/transition";
import type { Task, TaskType } from "$lib/types/planning.types";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	tasks: Task[];
	masterTasks: Task[];
	isTasksModified: boolean;
	disabled: boolean;
	children?: import("svelte").Snippet<[task: Task]>;
}

let {
	tasks = $bindable(),
	masterTasks = [],
	isTasksModified = $bindable(false),
	disabled = false,
	children
}: Props = $props();

// Internal edit state
let newTaskName = $state("");
let newTaskDescription = $state("");
let newTaskVolunteers = $state(1);
let newTaskType = $state<TaskType>("onEvent");
let editingTaskId = $state<string | null>(null);
// L'input reçoit le focus dès l'entrée en mode édition pour fluidifier
// le flux de saisie clavier (pas de clic supplémentaire nécessaire).
function focusOnEdit(node: HTMLInputElement) {
	$effect(() => {
		if (editingTaskId) {
			node.focus();
			node.select();
		}
	});
	return {};
}

// Detect if the edit form has unsaved changes
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

function ensureSpecificTasks() {
	if (!isTasksModified) {
		isTasksModified = true;
		tasks = [...masterTasks];
	}
}

function resetToMasterTasks() {
	isTasksModified = false;
	tasks = [...masterTasks];
	newTaskName = "";
	newTaskDescription = "";
	editingTaskId = null;
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
	newTaskName = "";
	newTaskDescription = "";
	newTaskVolunteers = 1;
	newTaskType = "onEvent";
}

function removeTask(id: string) {
	ensureSpecificTasks();
	tasks = tasks.filter((t) => t.id !== id);
}

function editTask(task: Task) {
	newTaskName = task.name;
	newTaskDescription = task.description || "";
	newTaskVolunteers = task.requiredVolunteers;
	newTaskType = task.type;
	editingTaskId = task.id;
}

function cancelEdit() {
	editingTaskId = null;
	newTaskName = "";
	newTaskDescription = "";
	newTaskVolunteers = 1;
}

function cancelTaskInput() {
	newTaskName = "";
	newTaskDescription = "";
	newTaskVolunteers = 1;
	newTaskType = "onEvent";
}

function getTypeLabel(type: TaskType): string {
	switch (type) {
		case "beforeEvent":
			return m.task_type_before();
		case "onEvent":
			return m.task_type_during();
		case "afterEvent":
			return m.task_type_after();
	}
}
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h4 class="flex items-center gap-2 font-medium">
      <ClipboardCheck size={18} class="text-primary" />
      {m.task_list_title()}
    </h4>
    <div class="flex flex-wrap items-center gap-2">
      {#if isTasksModified}
        <span class="badge badge-warning h-auto font-medium"
          ><CircleAlert class="size-4" /> {m.task_specific_to_date()}</span
        >
        <button
          type="button"
          class="btn btn-soft btn-error btn-sm sm:btn-xs"
          onclick={resetToMasterTasks}
        >
          <RefreshCcw class="size-3" />
          {m.task_reset_to_common({count: masterTasks?.length ?? 0})}
        </button>
      {:else if !isTasksModified && masterTasks?.length > 0}
        <span class="badge badge-info badge-soft h-auto font-medium"
          ><CircleAlert class="size-4" /> {m.task_common_to_all_dates()}</span
        >
      {/if}
    </div>
  </div>

  <div class="space-y-2">
    {#each tasks as task (task.id)}
      <div
        class="bg-base-200 flex gap-3 rounded-lg p-3 {editingTaskId === task.id
          ? 'ring-primary ring-2 ring-offset-2'
          : ''}"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div class="text-sm font-medium">{task.name}</div>
            <div class="text-sm opacity-60">
              {task.requiredVolunteers} {m.task_persons_abbrev()} {getTypeLabel(task.type)}
            </div>
          </div>

          <!-- Zone des badges volontaires injectée par le parent -->
          {#if children}
            {@render children(task)}
          {/if}
        </div>
        <!-- Boutons d'action alignés à droite -->
        <div class="flex shrink-0 flex-col justify-between">
          <button
            type="button"
            class="btn btn-ghost sm:btn-sm btn-circle"
            title={m.task_edit()}
            onclick={() => editTask(task)}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            class="btn btn-ghost sm:btn-sm btn-circle text-error"
            title={m.task_delete_for_event()}
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
          <div class="h-4 flex gap-2 col-span-full items-center" in:fade>
            <Pencil size={20} />
            <span>{m.task_editing_selected()}</span>
          </div>
        {:else}
          <div class="h-4 flex gap-2 col-span-full items-center" in:fade>
            <Plus size={20} />
            <span>{m.task_add_new()}</span>
          </div>
        {/if}
        <fieldset class="fieldset">
          <label class="input w-full">
            <input
              type="text"
              bind:value={newTaskName}
              use:focusOnEdit
              placeholder={m.task_name_placeholder()}
              onkeydown={(e) => {
                if (e.key === "Enter") {
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
              title={m.task_add_occurrence()}
            >
              <Plus size={16} />
            </button>
          </label>
        </fieldset>
        <div class="grid grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">{m.task_required_volunteers()}</legend>
            <input
              type="number"
              bind:value={newTaskVolunteers}
              class="input w-full"
              min="1"
              placeholder={m.task_number_abbrev()}
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">{m.task_moment()}</legend>
            <select bind:value={newTaskType} class="select w-full">
              <option value="beforeEvent">{m.task_type_before()}</option>
              <option value="onEvent">{m.task_type_during()}</option>
              <option value="afterEvent">{m.task_type_after()}</option>
            </select>
          </fieldset>
        </div>
      </div>
      <div class="flex gap-2">
        {#if !editingTaskId && newTaskName.trim().length > 0}
          <button
            type="button"
            class="btn sm:btn-sm btn-ghost"
            onclick={cancelTaskInput}
            {disabled}
          >
            {m.common_cancel()}
          </button>
        {/if}
        {#if editingTaskId}
          <button
            type="button"
            class="btn sm:btn-sm btn-ghost"
            onclick={cancelEdit}>{m.common_cancel()}</button
          >
        {/if}
        <button
          type="button"
          class="btn sm:btn-sm btn-primary grow"
          onclick={addTask}
          disabled={newTaskName.trim().length === 0 ||
            (editingTaskId !== null && !taskHasChanges)}
        >
          {editingTaskId ? m.task_edit_submit() : m.task_add_submit()}
        </button>
      </div>
    </div>
  </div>
</div>
