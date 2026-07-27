<script lang="ts">
import { AlertTriangle, RefreshCw, Trash2 } from "@lucide/svelte";
import { page } from "$app/state";
import { recoverAllData } from "$lib/utils/recover";
import * as m from "$lib/paraglide/messages.js";

let isRecovering = $state(false);

const isInternalServerError = $derived(page.status >= 500);
const isNotFound = $derived(page.status === 404);

async function handleRecover() {
	if (isRecovering) return;
	isRecovering = true;
	try {
		await recoverAllData();
	} catch (err) {
		console.error("[error] recoverAllData failed:", err);
		isRecovering = false;
	}
}

function reloadPage() {
	window.location.reload();
}
</script>

<svelte:head>
	<title>{isNotFound ? m.error_page_title_404() : m.error_page_title_other()} · Oupla Planning</title>
</svelte:head>

<div class="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-6 text-center">
	<div
		class="flex size-20 items-center justify-center rounded-full {isInternalServerError
			? 'bg-error/10'
			: 'bg-warning/10'}"
	>
		<AlertTriangle class="size-10 {isInternalServerError ? 'text-error' : 'text-warning'}" />
	</div>

	<div class="max-w-md space-y-2">
		<h1 class="text-3xl font-bold">
			{isNotFound ? m.error_heading_404() : isInternalServerError ? m.error_heading_500() : m.error_heading_unknown()}
		</h1>
		<p class="text-base-content/70">
			{#if isNotFound}
				{m.error_description_404()}
			{:else if isInternalServerError}
				{m.error_description_500()}
			{:else}
				{page.error?.message ?? m.error_description_unknown()}
			{/if}
		</p>
		{#if isInternalServerError && import.meta.env.DEV && page.error?.message}
			<details class="text-left">
				<summary class="text-base-content/50 cursor-pointer text-sm">{m.error_technical_details()}</summary>
				<pre class="bg-base-300 mt-2 overflow-x-auto rounded p-3 text-xs">{page.error.message}</pre>
			</details>
		{/if}
	</div>

	<div class="flex flex-wrap items-center justify-center gap-3">
		<a href="/" class="btn btn-primary">
			<RefreshCw size={18} />
			{m.error_go_home()}
		</a>
		{#if isInternalServerError}
			<button class="btn btn-outline btn-error" onclick={handleRecover} disabled={isRecovering}>
				<Trash2 size={18} />
				{isRecovering ? m.error_cleaning() : m.error_clear_local_data()}
			</button>
		{/if}
		<button class="btn btn-ghost" onclick={reloadPage}>
			<RefreshCw size={16} />
			{m.error_retry()}
		</button>
	</div>

	{#if isInternalServerError}
		<p class="text-base-content/50 max-w-sm text-xs">
			{m.error_clear_data_explanation()}
		</p>
	{/if}
</div>
