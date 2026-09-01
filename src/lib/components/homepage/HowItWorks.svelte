<script lang="ts">
	import { CalendarPlus, Eye, Share2 } from "@lucide/svelte";
	import * as m from "$lib/paraglide/messages.js";

	const steps = [
		{
			num: "1",
			icon: CalendarPlus,
			title: m.home_howitworks_step1_title(),
			description: m.home_howitworks_step1_desc(),
		},
		{
			num: "2",
			icon: Share2,
			title: m.home_howitworks_step2_title(),
			description: m.home_howitworks_step2_desc(),
		},
		{
			num: "3",
			icon: Eye,
			title: m.home_howitworks_step3_title(),
			description: m.home_howitworks_step3_desc(),
		},
	];
</script>

<section class=" py-10">
	<h2 class="mb-8 text-center text-2xl font-bold">{m.home_howitworks_heading()}</h2>

	<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
		{#each steps as step (step.icon)}
			{@const Icon = step.icon}
			<div class="card bg-base-100 shadow-md">
				<div class="card-body items-center text-center">
					<div class="bg-primary text-primary-content rounded-full p-3">
						<Icon size={28} />
					</div>
					<h3 class="card-title mt-2">{step.title}</h3>
					<p class="text-base-content/70 text-sm">{step.description}</p>
				</div>
			</div>
		{/each}
	</div>
</section>
