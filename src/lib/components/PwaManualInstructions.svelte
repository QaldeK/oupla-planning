<!-- src/lib/components/PwaManualInstructions.svelte -->
<script lang="ts">
	import { EllipsisVerticalIcon, Share } from "@lucide/svelte";
	import * as m from "$lib/paraglide/messages.js";
	import { isIosDevice } from "$lib/utils/platform";

	// Détection iOS pour les instructions spécifiques (Safari = Partage → Écran
	// d'accueil) ; Android non-Chromium = menu ⋮ → Installer.
	let isIos = $derived(typeof navigator !== "undefined" && isIosDevice(navigator));
</script>

{#if isIos}
	<ol class="space-y-1 text-sm">
		<li class="flex items-center gap-2">
			<span class="badge badge-info badge-sm">1</span>
			{m.pwa_howto_ios_step_1()}
			<Share size={14} class="bg-base-300 mx-1 inline size-4 rounded-full" />
			{m.pwa_howto_ios_share()}
		</li>
		<li class="flex items-center gap-2">
			<span class="badge badge-info badge-sm">2</span>
			{m.pwa_howto_ios_step_2()}
		</li>
	</ol>
{:else}
	<ol class="space-y-1 text-sm">
		<li class="flex items-center gap-2">
			<span class="badge badge-info badge-sm">1</span>
			{m.pwa_howto_android_step_1()}
			<EllipsisVerticalIcon class="bg-base-300 mx-1 inline size-4 rounded-full" />
		</li>
		<li class="flex items-center gap-2">
			<span class="badge badge-info badge-sm">2</span>
			{m.pwa_howto_android_step_2()}
		</li>
	</ol>
{/if}
