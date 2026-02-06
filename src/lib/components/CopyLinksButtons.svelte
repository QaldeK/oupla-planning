<script lang="ts">
	import { goto } from '$app/navigation';
	import { Copy, Check, Settings } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		adminToken?: string;
		participantToken?: string;
		size?: 'sm' | 'md' | 'lg' | 'wide' | 'block';
	}

	let { adminToken, participantToken, size = 'block' }: Props = $props();

	let copiedAdmin = $state(false);
	let copiedParticipant = $state(false);

	function getAdminUrl() {
		return `${window.location.origin}/admin/${adminToken}`;
	}

	function getParticipantUrl() {
		return `${window.location.origin}/p/${participantToken}`;
	}

	async function copyAdminLink() {
		try {
			await navigator.clipboard.writeText(getAdminUrl());
			copiedAdmin = true;
			toast.success('Lien admin copié !');
			setTimeout(() => (copiedAdmin = false), 2000);
		} catch (error) {
			toast.error('Erreur lors de la copie');
		}
	}

	async function copyParticipantLink() {
		try {
			await navigator.clipboard.writeText(getParticipantUrl());
			copiedParticipant = true;
			toast.success('Lien participant copié !');
			setTimeout(() => (copiedParticipant = false), 2000);
		} catch (error) {
			toast.error('Erreur lors de la copie');
		}
	}
</script>

<div class="flex justify-around gap-2">
	{#if adminToken}
		<button class="btn btn-warning min-w-1/3 gap-2" onclick={copyAdminLink}>
			{#if copiedAdmin}
				<Check size={18} />
			{:else}
				<Copy size={18} />
			{/if}
			Lien Admin
		</button>
		<button class="btn btn-primary min-w-1/3 gap-2" onclick={() => goto(`/admin/${adminToken}`)}
			><Settings size={18} /> Configuration</button
		>
	{/if}

	{#if participantToken}
		<button class="btn btn-info min-w-1/3 gap-2" onclick={copyParticipantLink}>
			{#if copiedParticipant}
				<Check size={18} />
			{:else}
				<Copy size={18} />
			{/if}
			Lien Public
		</button>
	{/if}
</div>
