<script lang="ts">
	import { CalendarPlus, Share2, Eye } from 'lucide-svelte';

	const steps = [
		{
			num: '1',
			icon: CalendarPlus,
			title: 'Créez votre planning',
			description:
				'Définissez la récurrence (quotidien, hebdomadaire, mensuel…), les horaires et les tâches à pourvoir.'
		},
		{
			num: '2',
			icon: Share2,
			title: 'Partagez le lien',
			description:
				"Envoyez le lien participant à votre groupe. Aucune inscription n'est requise pour répondre."
		},
		{
			num: '3',
			icon: Eye,
			title: 'Suivez les réponses',
			description:
				"Voyez qui sera présent, qui s'occupe de quoi, et communiquez via les commentaires en temps réel."
		}
	];
</script>

<section class="py-10">
	<h2 class="mb-8 text-center text-2xl font-bold">Comment ça marche</h2>

	<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
		{#each steps as step (step.icon)}
			{@const Icon = step.icon}
			<div class="card bg-base-100 shadow-md">
				<div class="card-body items-center text-center">
					<div class="bg-primary text-primary-content rounded-full p-3">
						<Icon size={28} />
					</div>
					<div class="badge badge-outline badge-sm mt-2">{step.num}</div>
					<h3 class="card-title mt-2">{step.title}</h3>
					<p class="text-base-content/70 text-sm">{step.description}</p>
				</div>
			</div>
		{/each}
	</div>
</section>
