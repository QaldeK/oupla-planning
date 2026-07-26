<script lang="ts">
import { Building2, Music, Trophy, Users } from "@lucide/svelte";

const useCases = [
	{
		icon: Users,
		title: "Associations",
		description:
			"Organisez les créneaux de bénévolat, les permanences et les événements récurrents de votre association."
	},
	{
		icon: Trophy,
		title: "Clubs sportifs",
		description:
			"Planifiez les entraînements, gérez les présences et répartissez les rôles (coach, arbitre, logistique)."
	},
	{
		icon: Music,
		title: "Groupes musicaux",
		description:
			"Coordonnez les répétitions hebdomadaires, suivez qui sera là et qui s'occupe du matériel."
	},
	{
		icon: Building2,
		title: "Équipes et comités",
		description:
			"Planifiez les réunions récurrentes, tours de garde et astreintes sans outil lourd ni inscription obligatoire."
	}
];
</script>

<section class="py-10">
	<h2 class="mb-8 text-center text-2xl font-bold">Pour qui ?</h2>

	<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
		{#each useCases as useCase (useCase.icon)}
			{@const Icon = useCase.icon}
			<div class="card bg-base-100 shadow-md transition hover:shadow-lg">
				<div class="card-body">
					<h3 class="card-title text-base">
						<Icon size={18} class="text-secondary shrink-0" />
						{useCase.title}
					</h3>
					<p class="text-base-content/70 text-sm">{useCase.description}</p>
				</div>
			</div>
		{/each}
	</div>
</section>
