<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import AuthForm from './AuthForm.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onSuccess?: () => void;
		defaultMode?: 'register' | 'login';
	}

	let { open = $bindable(false), onClose, onSuccess, defaultMode = 'login' }: Props = $props();

	// Nom par défaut depuis le localStorage
	let defaultName = $derived(userStore.globalProfile?.defaultName || '');

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
	</div>
</Modal>
