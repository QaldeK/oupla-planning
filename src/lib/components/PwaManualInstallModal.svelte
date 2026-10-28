<!-- src/lib/components/PwaManualInstallModal.svelte -->
<script lang="ts">
	import Modal from "$lib/components/ui/Modal.svelte";
	import * as m from "$lib/paraglide/messages.js";
	import PwaManualInstructions from "./PwaManualInstructions.svelte";

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();
</script>

<Modal {open} onClose={onClose} title={m.pwa_install_title()} size="sm">
	<div class="space-y-3">
		<p class="text-sm opacity-80">
			{m.pwa_why_install()}
		</p>
		<PwaManualInstructions />
	</div>
</Modal>
