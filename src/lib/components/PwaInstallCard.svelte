<!-- src/lib/components/PwaInstallCard.svelte -->
<script lang="ts">
	import { pwaStore } from '$lib/stores/pwaStore.svelte';
	import { Download, Bell, Users, CalendarX } from 'lucide-svelte';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';

	interface Props {
		isDismissible?: boolean;
	}

	let { isDismissible = true }: Props = $props();
	let dismissed = $state(false);

	// Ne pas afficher si déjà installé, pas installable, ou dismissed
	let showCard = $derived(!pwaStore.isInstalled && pwaStore.canInstall && !dismissed);

	async function handleInstall() {
		await pwaStore.install();
	}
</script>

{#if showCard}
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
					💡 Personnalisez vos préférences de notification dans les paramètres du planning.
				</p>
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
