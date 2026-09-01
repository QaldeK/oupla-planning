<script lang="ts">
	import { MonitorSmartphone, ShieldCheck } from "@lucide/svelte";
	import Modal from "$lib/components/ui/Modal.svelte";
	import * as m from "$lib/paraglide/messages.js";
	import { userStore } from "$lib/stores/userStore.svelte";
	import AuthForm from "./AuthForm.svelte";

	interface Props {
		open: boolean;
		onClose: () => void;
		onSuccess?: () => void;
		defaultMode?: "register" | "login";
		welcomeMode?: boolean;
	}

	let {
		open = $bindable(false),
		onClose,
		onSuccess,
		defaultMode = "login",
		welcomeMode = false,
	}: Props = $props();

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
		{#if welcomeMode}
			<div class="alert alert-success alert-soft text-sm">
				<div class="flex items-start gap-3">
					<ShieldCheck size={20} class="text-success mt-0.5 shrink-0" />
					<p class="font-medium">{m.auth_keep_your_plannings()}</p>
					<div class="flex items-center gap-1.5">
						<MonitorSmartphone size={12} />
						<span>{m.auth_sync_across_devices()}</span>
					</div>
				</div>
			</div>
		{/if}

		<AuthForm mode={currentMode} onSuccess={handleSuccess} compact={false} name={defaultName} />

		<div class="divider text-[10px] tracking-widest uppercase opacity-50">
			{m.auth_or_divider()}
		</div>

		<div class="text-center text-sm">
			{#if currentMode === "register"}
				{m.auth_already_have_account()}
				<button
					type="button"
					class="link link-primary font-medium"
					onclick={() => (currentMode = "login")}
				>
					{m.auth_login_link()}
				</button>
			{:else}
				{m.auth_no_account_yet()}
				<button
					type="button"
					class="link link-primary font-medium"
					onclick={() => (currentMode = "register")}
				>
					{m.auth_register_link()}
				</button>
			{/if}
		</div>

		{#if welcomeMode}
			<button type="button" class="btn btn-ghost btn-sm btn-block" onclick={onClose}>
				{m.common_cancel()}
			</button>
		{/if}
	</div>
</Modal>
