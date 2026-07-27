<script lang="ts">
import { MessageSquareWarning, Plus, Trash2 } from "@lucide/svelte";
import { goto } from "$app/navigation";
import AuthSection from "$lib/components/homepage/AuthSection.svelte";
import BenefitsBanner from "$lib/components/homepage/BenefitsBanner.svelte";
import FeaturesGrid from "$lib/components/homepage/FeaturesGrid.svelte";
import HowItWorks from "$lib/components/homepage/HowItWorks.svelte";
import PwaInstallCard from "$lib/components/PwaInstallCard.svelte";
import { getLocale } from "$lib/paraglide/runtime.js";
import { commentStateStore } from "$lib/stores/commentStateStore.svelte";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { pwaStore } from "$lib/stores/pwaStore.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import { version } from "../../package.json" with { type: "json" };

function navigateToPlanning(participantToken: string) {
	goto(`/p/${participantToken}`);
}

// JSON-LD structured data — construit dans le script pour éviter les problèmes de parsing HTML
const jsonLdScript =
	`<script type="application/ld+json">${JSON.stringify({
		"@context": "https://schema.org",
		"@type": "WebApplication",
		name: "Oupla Planning",
		url: "https://planning.oupla.net/",
		description:
			"Organisez vos événements récurrents, suivez les présences et les tâches de vos participants. Simple, gratuit, sans inscription requise.",
		applicationCategory: "LifestyleApplication",
		operatingSystem: "Web",
		inLanguage: "fr",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "EUR"
		}
	})}</` + "script>";
</script>

<svelte:head>
	<title>Oupla - Planifiez et suivez vos activités récurrentes</title>
	<meta
		name="description"
		content="Organisez vos événements récurrents, suivez les présences et les tâches de vos participants. Simple, gratuit, sans inscription requise."
	/>

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Oupla - Planifiez et suivez vos activités récurrentes" />
	<meta
		property="og:description"
		content="Organisez vos événements récurrents, suivez les présences et les tâches de vos participants. Simple, gratuit, sans inscription requise."
	/>
	<meta property="og:image" content="/icon-512.png" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="Oupla - Planifiez et suivez vos activités récurrentes" />
	<meta
		name="twitter:description"
		content="Organisez vos événements récurrents, suivez les présences et les tâches de vos participants. Simple, gratuit, sans inscription requise."
	/>

	<!-- Structured Data (JSON-LD) -->
	{@html jsonLdScript}
</svelte:head>

<div class="mx-auto max-w-4xl pb-10">
	<!-- Branding (always visible) -->
	<div class="mb-8 flex min-h-[30vh] flex-col items-center justify-center space-y-6 text-center">
		<div class="space-y-4">
			<img src="/logo.svg" class="mx-auto size-48 sm:size-54" alt="Oupla planning" />
			<h1 class="text-6xl font-black max-sm:hidden">Oupla planning</h1>
			<p class="text-base-content/70 max-w-md text-lg">
				Gérez les présences et les tâches de vos activités récurrentes.
			</p>
			<p class="text-base-content/70 text-sm">v{version}</p>
		</div>
	</div>

	<!-- Actions rapides -->
	<div class="mb-8 flex justify-center">
		<button onclick={() => goto('/new')} class="btn btn-primary btn-lg gap-3 shadow-lg">
			<Plus size={24} />
			Créer un nouveau planning
		</button>
	</div>

	<!-- Saved Plannings List - UNIQUEMENT si connecté (en haut car concerne les user·es connecté·es) -->
	{#if userStore.isLoggedIn && planningStore.activeMasters.length > 0}
		<div class="mb-8">
			<h2 class="mb-4 text-xl font-semibold">Vos plannings</h2>
			<div class="space-y-3">
				{#each planningStore.activeMasters.filter((m) => !m.participants.some((p) => p.userId === userStore.pbUser?.id && p.hasQuit)) as master (master.id)}
					<button
						class="card bg-base-100 w-full shadow-md transition hover:cursor-pointer hover:shadow-lg"
						onclick={() => navigateToPlanning(master.participantToken!)}
					>
						<div class="card-body">
							<div class="flex items-center justify-between">
								<div class="flex-1 text-left">
									<h3 class="card-title">{master.title}</h3>
									<p class="text-base-content/60 text-sm">
										Dernière modif : {new Date(master.updated).toLocaleDateString(getLocale())}
									</p>
								</div>
								<div class="flex items-center gap-2">
									{#if commentStateStore.getUnreadCount(master.id) > 0}
										<div class="bg-info/20 rounded-full">
											<MessageSquareWarning size={20} class="p-1 opacity-70" />
										</div>
									{/if}
									{#if master.adminToken}
										<span class="badge badge-primary">Admin</span>
									{:else}
										<span class="badge badge-secondary">Participant</span>
									{/if}
								</div>
							</div>
						</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}
	{#if userStore.isLoggedIn && planningStore.deletedMasters.length > 0}
		<div class="mb-8 opacity-70">
			<h2 class="mb-4 font-semibold">Plannings supprimés</h2>
			<div class="space-y-1">
				{#each planningStore.deletedMasters as master (master.id)}
					<div class="card card-sm bg-base-200 w-full border border-dashed">
						<div class="card-body">
							<div class="flex items-center justify-between">
								<div class="flex-1 text-left">
									<h3 class="card-title line-through opacity-60">{master.title}</h3>
								</div>
								<span class="badge badge-error badge-sm">Supprimé</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
			<button
				class="btn btn-ghost btn-sm mt-2 w-full text-xs"
				onclick={() => planningStore.cleanDeletedPlannings()}
			>
				<Trash2 size={14} />
				Nettoyer les plannings supprimés
			</button>
		</div>
	{/if}

	<!-- PWA Installation Card (always visible, handles own display logic) -->
	<div class="mb-8"><PwaInstallCard /></div>

	<!-- Auth Section en haut pour PWA + guest -->
	{#if pwaStore.isInstalled && !userStore.isLoggedIn}
		<div class="mb-8"><AuthSection /></div>
	{/if}

	<!-- SEO Content Sections -->
	<HowItWorks />
	<FeaturesGrid />
	<!-- <UseCases /> -->
	<BenefitsBanner />

	<!-- Auth Section en bas uniquement pour web non-PWA -->
	{#if !userStore.isLoggedIn && !pwaStore.isInstalled}
		<AuthSection />
	{/if}
</div>
