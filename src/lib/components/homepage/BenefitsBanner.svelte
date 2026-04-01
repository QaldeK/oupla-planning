<script lang="ts">
	import { UserX, WifiOff, Smartphone } from 'lucide-svelte';

	const benefits = [
		{
			icon: UserX,
			title: 'Sans inscription',
			description: 'Participez simplement avec votre nom. Créez un planning sans créer de compte.'
		},
		{
			icon: WifiOff,
			title: 'Fonctionne hors ligne',
			description: 'Vos données sont synchronisées automatiquement quand la connexion revient.'
		},
		{
			icon: Smartphone,
			title: 'Installable en un clic',
			description:
				"Ajoutez l'app à votre écran d'accueil pour une expérience native avec notifications push."
		}
	];
</script>

<section class="py-10">
	<h2 class="mb-8 text-center text-2xl font-bold">Pourquoi Oupla</h2>

	<div class="grid grid-cols-1 gap-5 md:grid-cols-3">
		{#each benefits as benefit (benefit.icon)}
			{@const Icon = benefit.icon}
			<div class="card bg-base-100 shadow-md transition hover:shadow-lg">
				<div class="card-body items-center text-center">
					<div
						class="bg-accent/10 mb-2 inline-flex size-12 items-center justify-center rounded-full"
					>
						<Icon size={26} class="text-accent" />
					</div>
					<h3 class="card-title text-base">{benefit.title}</h3>
					<p class="text-base-content/70 text-sm">{benefit.description}</p>
				</div>
			</div>
		{/each}
	</div>
</section>
