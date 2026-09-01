<script lang="ts">
	import { HatGlasses, Smartphone, UserX } from "@lucide/svelte";
	import * as m from "$lib/paraglide/messages.js";

	const benefits = [
		{
			icon: UserX,
			title: m.home_benefits_no_registration_title(),
			description: m.home_benefits_no_registration_desc(),
		},
		{
			icon: HatGlasses,
			title: m.home_benefits_opensource_title(),
			description: m.home_benefits_opensource_desc(),
		},
		{
			icon: Smartphone,
			title: m.home_benefits_installable_title(),
			description: m.home_benefits_installable_desc(),
		},
	];
</script>

<section class="py-10">
	<!-- <h2 class="mb-8 text-center text-2xl font-bold">Pourquoi Oupla</h2> -->

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
