<script lang="ts">
import {
	Bell,
	CalendarCheck,
	ClipboardList,
	MessageSquareText,
	Repeat2,
	ShieldCheck
} from "@lucide/svelte";

const features = [
	{
		icon: CalendarCheck,
		title: "Gestion des présences",
		description:
			"Chaque participant·e indique sa disponibilité (présent·e, si besoin, peut-être, absent·e). Suivi du quorum en temps réel."
	},
	{
		icon: ClipboardList,
		title: "Tâches",
		description: "Ajouter des tâches à se répartir (à réaliser avant, pendant, après l'événement)."
	},
	{
		icon: Repeat2,
		title: "Récurrence flexible",
		description: "Quotidien, hebdomadaire, bihebdomadaire, mensuel ou dates libres."
	},
	{
		icon: MessageSquareText,
		title: "Commentaires",
		description:
			"Échangez sur chaque événement via un fil de discussion intégré. Indicateur de messages non lus."
	},
	{
		icon: Bell,
		title: "Notifications",
		description:
			"Alertes push et email pour les changements, annulations, rappels et les nouveaux messages. Configuration par planning."
	},
	{
		icon: ShieldCheck,
		title: "Confirmation d'événements",
		description:
			"Activez le mode de confirmation pour valider chaque événement avant qu'il n'ait lieu."
	}
];
</script>

<section class="py-10">
	<h2 class="mb-8 text-center text-2xl font-bold">Fonctionnalités</h2>

	<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
		{#each features as feature (feature.icon)}
			{@const Icon = feature.icon}
			<div class="card bg-base-100 shadow-md transition hover:shadow-lg">
				<div class="card-body">
					<h3 class="card-title text-base">
						<Icon size={18} class="text-primary  shrink-0 stroke-3" />
						{feature.title}
					</h3>
					<p class="text-base-content/70 text-sm">{feature.description}</p>
				</div>
			</div>
		{/each}
	</div>
</section>
