<!-- src/lib/components/PwaInstallCard.svelte -->
<script lang="ts">
	import { pwaStore } from '$lib/stores/pwaStore.svelte';
	import { Download, Bell, Users, CalendarX, Share, X } from 'lucide-svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';

	interface Props {
		isDismissible?: boolean;
		/** Mode compact : banner une ligne, pour les pages de planning */
		compact?: boolean;
	}

	let { isDismissible = true, compact = false }: Props = $props();
	let dismissed = $state(false);
	let showInstallModal = $state(false);

	// Détection iOS pour les instructions spécifiques (Safari = Partage → Écran d'accueil)
	let isIos = $derived(
		typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
	);

	// Afficher si :
	// - Chromium (canInstall) → bouton d'install natif
	// - Non-Chrome mobile (showNativeHint + isMobile) → instructions manuelles
	let showCard = $derived(
		!pwaStore.isInstalled &&
			!dismissed &&
			(pwaStore.canInstall || (mediaQuery.isMobile && pwaStore.showNativeHint))
	);

	async function handleInstall() {
		await pwaStore.install();
	}
</script>

{#snippet installBenefits()}
	<ul class="space-y-1 text-sm">
		<li class="flex items-center gap-2">
			<Bell size={14} class="text-success/70" />
			<span class="opacity-70">Nouveaux messages et commentaires</span>
		</li>
		<li class="flex items-center gap-2">
			<Users size={14} class="text-success/70" />
			<span class="opacity-70">Alertes participants manquants</span>
		</li>
		<li class="flex items-center gap-2">
			<CalendarX size={14} class="text-success/70" />
			<span class="opacity-70">Annulations et changements</span>
		</li>
	</ul>
	<p class="text-xs opacity-60">
		Personnalisez vos préférences de notification dans les paramètres du planning.
	</p>
{/snippet}

{#snippet manualInstallInstructions()}
	{#if isIos}
		<ol class="space-y-1 text-sm">
			<li class="flex items-center gap-2">
				<span class="badge badge-info badge-sm">1</span>
				Appuyez sur le bouton <Share size={14} class="text-info inline" /> Partage
			</li>
			<li class="flex items-center gap-2">
				<span class="badge badge-info badge-sm">2</span>
				Faites défiler et sélectionnez « Sur l'écran d'accueil »
			</li>
		</ol>
	{:else}
		<p class="text-sm opacity-80">
			Appuyez sur le menu <strong>&#8942;</strong> de votre navigateur puis sur
			<strong>« Installer l'application »</strong> ou
			<strong>« Ajouter à l'écran d'accueil »</strong>.
		</p>
	{/if}
{/snippet}

{#if showCard}
	{#if pwaStore.canInstall}
		<!-- Chromium : prompt natif disponible -->
		{#if compact}
			<div class="alert alert-success alert-soft alert-vertical">
				<Download size={16} class="text-success shrink-0" />
				<span class="text-sm">Activez les notifications sur votre téléphone</span>
				<button class="btn btn-success btn-sm" onclick={handleInstall}>Installer</button>
				{#if isDismissible}
					<button class="btn btn-ghost btn-xs" onclick={() => (dismissed = true)}>
						<X size={14} />
					</button>
				{/if}
			</div>
		{:else}
			<div class="alert alert-success alert-soft shadow-md">
				<div class="flex items-start gap-4">
					<div class="bg-success/20 shrink-0 rounded-full p-3">
						<Download size={mediaQuery.isMobile ? 20 : 24} class="text-success" />
					</div>

					<div class="flex-1 space-y-2">
						<h3 class="text-base font-bold">Installez l'application pour rester informé</h3>

						<p class="text-sm leading-relaxed opacity-80">
							Recevez des notifications push sur votre téléphone pour ne jamais manquer un événement
							important.
						</p>

						{@render installBenefits()}
					</div>

					<div class="flex shrink-0 flex-col gap-2">
						<button class="btn btn-success btn-block sm:btn-sm gap-2" onclick={handleInstall}>
							<Download size={16} />
							Installer
						</button>

						{#if isDismissible}
							<button class="btn btn-ghost btn-xs" onclick={() => (dismissed = true)}>
								Plus tard
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<!-- Non-Chrome mobile : instructions manuelles -->
		{#if compact}
			<div class="alert alert-info alert-soft border-info/60 alert-vertical py-2">
				<Download size={16} class="text-info shrink-0" />
				{#if isIos}
					<span class="text-sm"
						>Appuyez sur <Share size={14} class="inline" /> puis « Sur l'écran d'accueil »</span
					>
				{:else}
					<span class="text-sm">Installez l'app depuis le menu de votre navigateur</span>
				{/if}
				<button class="btn btn-link btn-xs" onclick={() => (showInstallModal = true)}>
					Comment ?
				</button>
				{#if isDismissible}
					<button class="btn btn-ghost btn-xs btn-circle" onclick={() => (dismissed = true)}>
						<X size={14} />
					</button>
				{/if}
			</div>
		{:else}
			<div class="alert alert-info alert-soft shadow-md">
				<div class="flex items-start gap-4">
					<div class="bg-info/20 shrink-0 rounded-full p-3">
						<Download size={mediaQuery.isMobile ? 20 : 24} class="text-info" />
					</div>

					<div class="flex-1 space-y-2">
						<h3 class="text-base font-bold">Installez l'application pour rester informé</h3>

						<p class="text-sm leading-relaxed opacity-80">
							Recevez des notifications push sur votre téléphone pour ne jamais manquer un événement
							important.
						</p>

						{@render manualInstallInstructions()}
					</div>

					{#if isDismissible}
						<div class="shrink-0">
							<button class="btn btn-ghost btn-xs" onclick={() => (dismissed = true)}>
								Plus tard
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
{/if}

<Modal
	open={showInstallModal}
	onClose={() => (showInstallModal = false)}
	title="Installer l'application"
	size="sm"
>
	<div class="space-y-3">
		<p class="text-sm opacity-80">
			Recevez des notifications push sur votre téléphone pour ne jamais manquer un événement
			important.
		</p>
		{@render manualInstallInstructions()}
	</div>
</Modal>
