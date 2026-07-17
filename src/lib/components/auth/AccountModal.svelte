<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import AuthForm from './AuthForm.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { ShieldCheck, MonitorSmartphone } from '@lucide/svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onSuccess?: () => void;
		defaultMode?: 'register' | 'login';
		welcomeMode?: boolean;
	}

	let {
		open = $bindable(false),
		onClose,
		onSuccess,
		defaultMode = 'login',
		welcomeMode = false
	}: Props = $props();

	// Nom par défaut depuis le profil PocketBase
	let defaultName = $derived(userStore.pbUser?.name || '');

	let currentMode = $state<'register' | 'login'>('login');

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
	title={currentMode === 'register' ? 'Créer un compte' : 'Se connecter'}
	size="sm"
>
	<div class="space-y-6">
		{#if welcomeMode}
			<div class="alert alert-success alert-soft text-sm">
				<div class="flex items-start gap-3">
					<ShieldCheck size={20} class="text-success mt-0.5 shrink-0" />
					<p class="font-medium">Ne perdez pas vos plannings</p>
					<div class="flex items-center gap-1.5">
						<MonitorSmartphone size={12} />
						<span>Retrouvez vos plannings depuis votre PC, tablette ou téléphone</span>
					</div>
				</div>
			</div>
		{/if}

		<AuthForm mode={currentMode} onSuccess={handleSuccess} compact={false} name={defaultName} />

		<div class="divider text-[10px] tracking-widest uppercase opacity-50">Ou</div>

		<div class="text-center text-sm">
			{#if currentMode === 'register'}
				Vous avez déjà un compte ?
				<button
					type="button"
					class="link link-primary font-medium"
					onclick={() => (currentMode = 'login')}
				>
					Connectez-vous
				</button>
			{:else}
				Pas encore de compte ?
				<button
					type="button"
					class="link link-primary font-medium"
					onclick={() => (currentMode = 'register')}
				>
					Inscrivez-vous
				</button>
			{/if}
		</div>

		{#if welcomeMode}
			<button type="button" class="btn btn-ghost btn-sm btn-block" onclick={onClose}>
				Plus tard
			</button>
		{/if}
	</div>
</Modal>
