<script lang="ts">
	import Modal from "$lib/components/ui/Modal.svelte";
	import * as m from "$lib/paraglide/messages.js";
	import { userStore } from "$lib/stores/userStore.svelte";
	import AuthPanel from "./AuthPanel.svelte";

	interface Props {
		open: boolean;
		onClose: () => void;
		onSuccess?: () => void;
		defaultMode?: "register" | "login";
	}

	let { open = $bindable(false), onClose, onSuccess, defaultMode = "login" }: Props = $props();

	// Nom par défaut depuis le profil PocketBase
	let defaultName = $derived(userStore.pbUser?.name || "");

	let currentMode = $state<"register" | "login">("login");

	// Remettre à jour le mode par défaut si on ouvre à nouveau la modale
	$effect(() => {
		if (open) {
			currentMode = defaultMode;
		}
	});

	function handleSuccess() {
		if (onSuccess) onSuccess();
		onClose();
	}
</script>

<Modal
	{open}
	{onClose}
	title={currentMode === "register" ? m.auth_register_title() : m.auth_login_title()}
	size="sm"
>
	<div class="space-y-6">
		<AuthPanel bind:mode={currentMode} name={defaultName} onSuccess={handleSuccess} />
	</div>
</Modal>
