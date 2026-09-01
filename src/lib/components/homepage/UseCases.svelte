<script lang="ts">
	import { Building2, Music, Trophy, Users } from "@lucide/svelte";
	import * as m from "$lib/paraglide/messages.js";

	const useCases = [
		{
			icon: Users,
			title: m.home_usecases_associations_title(),
			description: m.home_usecases_associations_desc(),
		},
		{
			icon: Trophy,
			title: m.home_usecases_sports_title(),
			description: m.home_usecases_sports_desc(),
		},
		{
			icon: Music,
			title: m.home_usecases_music_title(),
			description: m.home_usecases_music_desc(),
		},
		{
			icon: Building2,
			title: m.home_usecases_teams_title(),
			description: m.home_usecases_teams_desc(),
		},
	];
</script>

<section class="py-10">
	<h2 class="mb-8 text-center text-2xl font-bold">{m.home_usecases_heading()}</h2>

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
