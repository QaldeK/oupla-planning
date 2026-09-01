<!-- src/lib/components/PwaInstallCard.svelte -->
<script lang="ts">
	import { Bell, CalendarX, Download, EllipsisVerticalIcon, Share, Users } from "@lucide/svelte";
	import Modal from "$lib/components/ui/Modal.svelte";
	import * as m from "$lib/paraglide/messages.js";
	import { mediaQuery } from "$lib/stores/mediaQuery.svelte";
	import { pwaStore } from "$lib/stores/pwaStore.svelte";

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
		typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent),
	);

	// Afficher si :
	// - Chromium (canInstall) → bouton d'install natif
	// - Non-Chrome mobile (showNativeHint + isMobile) → instructions manuelles
	let showCard = $derived(
		!pwaStore.isInstalled &&
			!dismissed &&
			(pwaStore.canInstall || (mediaQuery.isMobile && pwaStore.showNativeHint)),
	);

	const whyInstall = m.pwa_why_install();
	async function handleInstall() {
		await pwaStore.install();
	}
</script>

{#snippet installBenefits()}
	<ul class="space-y-1 text-sm">
		<li class="flex items-center gap-2">
			<Bell size={14} class="text-success/70" />
			<span class="opacity-70">{m.pwa_benefit_messages()}</span>
		</li>
		<li class="flex items-center gap-2">
			<Users size={14} class="text-success/70" />
			<span class="opacity-70">{m.pwa_benefit_alerts()}</span>
		</li>
		<li class="flex items-center gap-2">
			<CalendarX size={14} class="text-success/70" />
			<span class="opacity-70">{m.pwa_benefit_cancellations()}</span>
		</li>
	</ul>
	<p class="text-xs opacity-60">
		{m.pwa_prefs_description()}
	</p>
{/snippet}

{#snippet manualInstallInstructions()}
	{#if isIos}
		<ol class="space-y-1 text-sm">
			<li class="flex items-center gap-2">
				<span class="badge badge-info badge-sm">1</span>
				{m.pwa_ios_press_button()}
				<Share size={14} class="text-info bg-base-300 mx-1 inline size-4 rounded-full" />
				{m.pwa_ios_share()}
			</li>
			<li class="flex items-center gap-2">
				<span class="badge badge-info badge-sm">2</span>
				{m.pwa_ios_step_2()}
			</li>
		</ol>
	{:else}
		<p class="text-sm opacity-80">
			{m.pwa_ios_press_menu()}
			<EllipsisVerticalIcon class="bg-base-300 mx-1 inline size-4 rounded-full" />
			{m.pwa_ios_browser_continue()}
			<strong>{m.pwa_install_action()}</strong>
			{m.pwa_ios_or()}
			<strong>{m.pwa_add_home_action()}</strong>.
		</p>
	{/if}
{/snippet}

{#if showCard}
	{#if pwaStore.canInstall}
		<!-- Chromium : prompt natif disponible -->
		{#if compact}
			<div class="alert alert-success alert-soft alert-vertical">
				<span class="text-sm">
					<Download size={16} class="text-success me-2 inline shrink-0" />{whyInstall}</span
				>
				<button class="btn btn-success btn-sm" onclick={handleInstall}>{m.pwa_install()}</button>
				<!-- {#if isDismissible}
					<button class="btn btn-ghost btn-xs" onclick={() => (dismissed = true)}>
						<X size={14} />
					</button>
				{/if} -->
			</div>
		{:else}
			<div class="alert alert-success alert-soft shadow-md alert-vertical">
				<div class="flex items-start gap-4">
					<div class="bg-success/20 shrink-0 rounded-full p-3">
						<Download size={mediaQuery.isMobile ? 20 : 24} class="text-success" />
					</div>

					<div class="flex-1 space-y-2">
						<h3 class="text-base font-bold">{m.pwa_install_title()}</h3>

						<p class="text-sm leading-relaxed opacity-80">
							{m.pwa_install_description()}
						</p>

						{@render installBenefits()}
					</div>

					<div class="flex shrink-0 flex-col gap-2">
						<button class="btn btn-success btn-block sm:btn-sm gap-2" onclick={handleInstall}>
							<Download size={16} />
							{m.pwa_install()}
						</button>

						{#if isDismissible}
							<button class="btn btn-ghost btn-xs" onclick={() => (dismissed = true)}>
								{m.pwa_later()}
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
				{#if isIos}
					<span class="text-sm">
						<Download size={16} class="text-info me-2 inline shrink-0" />
						{m.pwa_ios_press()}
						<Share size={14} class="inline" />
						{m.pwa_ios_step_guide()}</span
					>
				{:else}
					<span class="text-sm"
						><Download size={16} class="text-info me-2 inline shrink-0" />
						{m.pwa_ios_install_desktop()}
						<br />
						<button class="btn btn-link btn-xs" onclick={() => (showInstallModal = true)}>
							{m.pwa_how()}
						</button></span
					>
				{/if}

				<!-- {#if isDismissible}
					<button class="btn btn-ghost btn-xs btn-circle" onclick={() => (dismissed = true)}>
						<X size={14} />
					</button>
				{/if} -->
			</div>
		{:else}
			<div class="alert alert-info alert-soft max-md:alert-vertical shadow-md">
				<div class="flex items-start gap-4">
					<div class="bg-info/20 shrink-0 rounded-full p-3">
						<Download size={mediaQuery.isMobile ? 20 : 24} class="text-info" />
					</div>

					<div class="flex-1 space-y-2">
						<h3 class="text-base font-bold">{m.pwa_install_subtitle()}</h3>

						<p class="text-sm leading-relaxed opacity-80">
							{m.pwa_install_description()}
						</p>

						{@render manualInstallInstructions()}
					</div>

					{#if isDismissible}
						<div class="shrink-0">
							<button class="btn btn-ghost btn-xs" onclick={() => (dismissed = true)}>
								{m.pwa_later()}
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
	title={m.pwa_install_modal_title()}
	size="sm"
>
	<div class="space-y-3">
		<p class="text-sm opacity-80">
			{whyInstall}
		</p>
		{@render manualInstallInstructions()}
	</div>
</Modal>
