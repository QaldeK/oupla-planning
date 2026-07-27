<script lang="ts">
import { RefreshCw, Trash2, WifiOff } from "@lucide/svelte";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	errorType: "network" | "deleted" | "not-found" | null;
	isOffline: boolean;
}

let { errorType, isOffline }: Props = $props();
</script>

{#if errorType === 'network' || isOffline}
	{@const errorMessage = !isOffline
		? m.error_server_unavailable()
		: m.error_offline()}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="max-w-md text-center">
			<div class="alert alert-error alert-soft">
				<WifiOff size={24} />
				<div>
					<h3 class="font-bold">{m.error_connection_failed()}</h3>
					<div class="text-xs">
						<p>{errorMessage}</p>
					</div>
				</div>
			</div>
			<button class="btn btn-outline mt-4 gap-2" onclick={() => window.location.reload()}>
				<RefreshCw size={16} />
				{m.common_retry()}
			</button>
		</div>
	</div>
{:else if errorType === 'deleted'}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="max-w-md text-center">
			<div
				class="bg-warning/10 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full p-4"
			>
				<Trash2 size={40} class="text-warning" />
			</div>
			<h2 class="mb-2 text-2xl font-bold">{m.error_planning_deleted()}</h2>
			<p class="text-base-content/70 mb-6">
				{m.error_planning_deleted_desc()}
			</p>
			<a href="/" class="btn btn-primary">{m.common_back_home()}</a>
		</div>
	</div>
{:else if errorType === 'not-found'}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="max-w-md text-center">
			<h2 class="mb-2 text-2xl font-bold">{m.error_not_found()}</h2>
			<p class="text-base-content/70">{m.error_invalid_link()}</p>
			<a href="/" class="btn btn-primary mt-4">{m.common_back_home()}</a>
		</div>
	</div>
{/if}
