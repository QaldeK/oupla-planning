<script lang="ts">
	import { goto } from "$app/navigation";
	import Modal from "$lib/components/ui/Modal.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { modalStore } from "$lib/stores/modalStore.svelte";
	import { resolvePlanningLink } from "$lib/utils/planningUrl";

	const open = $derived(modalStore.joinPlanningOpen);
	let url = $state("");
	let invalid = $state(false);

	function close() {
		modalStore.closeJoinPlanning();
		url = "";
		invalid = false;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const route = resolvePlanningLink(url);
		if (!route) {
			invalid = true;
			return;
		}
		close();
		goto(route);
	}
</script>

<Modal {open} onClose={close} title={m.join_planning_title()} size="sm">
	<form onsubmit={submit} class="space-y-4">
		<fieldset class="fieldset">
			<legend class="fieldset-legend">{m.join_planning_url_label()}</legend>
			<label class="input w-full {invalid ? 'input-error' : ''}">
				<input
					type="text"
					class="grow"
					placeholder={m.join_planning_url_placeholder()}
					bind:value={url}
					oninput={() => (invalid = false)}
				/>
			</label>
			<p class="label">{m.join_planning_url_help()}</p>
			{#if invalid}
				<p class="text-error text-sm">{m.join_planning_invalid_url()}</p>
			{/if}
		</fieldset>
		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={close}>
				{m.common_cancel()}
			</button>
			<button type="submit" class="btn btn-primary">
				{m.join_planning_submit()}
			</button>
		</div>
	</form>
</Modal>
