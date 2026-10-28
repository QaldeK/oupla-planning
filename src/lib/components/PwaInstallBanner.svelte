<!-- src/lib/components/PwaInstallBanner.svelte -->
<script lang="ts">
	import { Bell, CalendarX, Download, Share, Users } from "@lucide/svelte";
	import * as m from "$lib/paraglide/messages.js";
	import { mediaQuery } from "$lib/stores/mediaQuery.svelte";
	import { installStore } from "$lib/stores/installStore.svelte";
	import PwaManualInstallModal from "./PwaManualInstallModal.svelte";
	import { isIosClient } from "$lib/utils/platform";

	interface Props {
		/** Mode compact : banner une ligne, pour les pages de planning */
		compact?: boolean;
	}

	let { compact = false }: Props = $props();
	let showInstallModal = $state(false);

	// Détection iOS pour la variante compacte (instructions Safari)
	let isIos = $derived(isIosClient());

	// Afficher si le gate d'installation est levé (check terminal fait, app
	// absente) et :
	// - Chromium (canInstall) → bouton d'install natif
	// - Non-Chrome mobile (needsManualInstructions + isMobile) → instructions manuelles
	let showCard = $derived(
		installStore.promptGateClear &&
			(installStore.canInstall || (mediaQuery.isMobile && installStore.needsManualInstructions)),
	);

	async function handleInstall() {
		await installStore.install();
	}
</script>

{#snippet installBenefits()}
	<ul class="space-y-1 text-sm">
		<li class="flex items-center gap-2">
			<Bell size={14} class="text-success/70" />
			<span class="opacity-70">{m.pwa_benefit_alerts()}</span>
		</li>
		<li class="flex items-center gap-2">
			<Users size={14} class="text-success/70" />
			<span class="opacity-70">{m.pwa_benefit_messages()}</span>
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

{#if showCard}
	{#if installStore.canInstall}
		<!-- Chromium : prompt natif disponible -->
		{#if compact}
			<div class="alert alert-success alert-soft alert-vertical">
				<span class="flex items-center gap-2 text-sm">
					<Download size={16} class="shrink-0" />
					{m.pwa_benefit_alerts()}</span
				>
				<button class="btn btn-success btn-sm" onclick={handleInstall}>
					{m.common_install_app()}
				</button>
			</div>
		{:else}
			<div class="alert alert-success alert-soft alert-vertical shadow-md">
				<!-- Empilé sur mobile, rangée à partir de sm -->
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
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

					<button class="btn btn-success shrink-0 gap-2" onclick={handleInstall}>
						<Download size={16} />
						{m.common_install_app()}
					</button>
				</div>
			</div>
		{/if}
	{:else}
		<!-- Non-Chromium mobile : instructions manuelles -->
		{#if compact}
			<div class="alert alert-info alert-soft border-info/60 alert-vertical py-2">
				{#if isIos}
					<span class="flex items-center gap-2 text-sm">
						<Share size={16} class="shrink-0" />
						{m.pwa_howto_ios_step_1()}
					</span>
				{:else}
					<span class="text-sm">{m.pwa_howto_android_short()}</span>
				{/if}

				<button class="btn btn-info btn-sm" onclick={() => (showInstallModal = true)}>
					{m.pwa_howto_install()}
				</button>
			</div>
		{:else}
			<div class="alert alert-info alert-soft alert-vertical shadow-md">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
					<div class="bg-info/20 shrink-0 rounded-full p-3">
						<Download size={mediaQuery.isMobile ? 20 : 24} class="text-info" />
					</div>

					<div class="flex-1 space-y-2">
						<h3 class="text-base font-bold">{m.pwa_manual_title()}</h3>

						<p class="text-sm leading-relaxed opacity-80">
							{m.pwa_install_description()}
						</p>

						<PwaManualInstructions />
					</div>
				</div>
			</div>
		{/if}
	{/if}
{/if}

<PwaManualInstallModal open={showInstallModal} onClose={() => (showInstallModal = false)} />
