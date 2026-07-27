<script lang="ts">
import {
	Bell,
	CalendarCheck,
	ClipboardList,
	MessageSquareText,
	Repeat2,
	ShieldCheck
} from "@lucide/svelte";
import * as m from "$lib/paraglide/messages.js";

const features = [
	{
		icon: CalendarCheck,
		title: m.home_features_attendance_title(),
		description: m.home_features_attendance_desc()
	},
	{
		icon: ClipboardList,
		title: m.home_features_tasks_title(),
		description: m.home_features_tasks_desc()
	},
	{
		icon: Repeat2,
		title: m.home_features_recurrence_title(),
		description: m.home_features_recurrence_desc()
	},
	{
		icon: MessageSquareText,
		title: m.home_features_comments_title(),
		description: m.home_features_comments_desc()
	},
	{
		icon: Bell,
		title: m.home_features_notifications_title(),
		description: m.home_features_notifications_desc()
	},
	{
		icon: ShieldCheck,
		title: m.home_features_confirmation_title(),
		description: m.home_features_confirmation_desc()
	}
];
</script>

<section class="py-10">
	<h2 class="mb-8 text-center text-2xl font-bold">{m.home_features_heading()}</h2>

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
