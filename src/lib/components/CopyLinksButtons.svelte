<script lang="ts">
	import { goto } from '$app/navigation';
	import { Copy, Check, Settings, Share2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		adminToken?: string;
		participantToken?: string;
		size?: 'sm' | 'md' | 'lg' | 'wide' | 'block';
	}

	let { adminToken, participantToken, size = 'block' }: Props = $props();

	let copiedAdmin = $state(false);
	let copiedParticipant = $state(false);

	// Détecte si le partage natif est disponible
	const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;

	function getAdminUrl() {
		return `${window.location.origin}/p/${adminToken}`;
	}

	function getParticipantUrl() {
		return `${window.location.origin}/p/${participantToken}`;
	}

	async function shareOrCopy(
		url: string,
		label: string,
		copiedState: () => boolean,
		setCopied: (v: boolean) => void
	) {
		if (canNativeShare) {
			try {
				await navigator.share({
					title: 'Oupla - Planning',
					text: `Participe à ${label}`,
					url
				});
				// L'utilisateur a partagé avec succès (ou annulé, pas de distinction)
			} catch (error) {
				// AbortError = utilisateur a annulé, on ne fait rien
				if ((error as Error).name !== 'AbortError') {
					toast.error('Erreur lors du partage');
				}
			}
		} else {
			// Fallback: copier dans le presse-papiers
			try {
				await navigator.clipboard.writeText(url);
				setCopied(true);
				toast.success(`${label} copié !`);
				setTimeout(() => setCopied(false), 2000);
			} catch (error) {
				toast.error('Erreur lors de la copie');
			}
		}
	}

	async function shareAdminLink() {
		await shareOrCopy(
			getAdminUrl(),
			'Lien admin',
			() => copiedAdmin,
			(v) => (copiedAdmin = v)
		);
	}

	async function shareParticipantLink() {
		await shareOrCopy(
			getParticipantUrl(),
			'Lien public',
			() => copiedParticipant,
			(v) => (copiedParticipant = v)
		);
	}
</script>

<div class="flex flex-wrap justify-around gap-2">
	{#if adminToken}
		<button
			class="btn btn-primary min-w-1/3 gap-2 max-sm:w-2/3"
			onclick={() => goto(`/admin/${adminToken}`)}><Settings size={18} /> Configuration</button
		>
		<button class="btn btn-warning min-w-1/3 gap-2" onclick={shareAdminLink}>
			{#if canNativeShare}
				<Share2 size={18} />
			{:else if copiedAdmin}
				<Check size={18} />
			{:else}
				<Copy size={18} />
			{/if}
			Lien Admin
		</button>
	{/if}

	{#if participantToken}
		<button class="btn btn-info min-w-1/3 gap-2" onclick={shareParticipantLink}>
			{#if canNativeShare}
				<Share2 size={18} />
			{:else if copiedParticipant}
				<Check size={18} />
			{:else}
				<Copy size={18} />
			{/if}
			Lien Public
		</button>
	{/if}
</div>
