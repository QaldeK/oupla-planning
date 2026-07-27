<script lang="ts">
import { HatGlasses, Mail, Smartphone } from "@lucide/svelte";
import * as m from "$lib/paraglide/messages.js";
</script>

<div class="flex flex-1 items-center justify-center py-8">
	<div class="alert alert-info alert-soft max-w-full text-xs shadow-sm">
		<div class="flex items-start gap-3">
			<div class="space-y-2">
				<h2 class="mb-4 text-center text-base font-semibold">
					{m.home_sidebar_heading()}
				</h2>

				<div class="flex items-start gap-3">
					<Smartphone size={20} class="text-info shrink-0" />

					<p>
						{m.home_sidebar_cross_device()}
					</p>
				</div>
				<div class="divider my-2"></div>

				<div class="flex items-start gap-2">
					<Mail size={16} class="text-info/70 mt-0.5 shrink-0" />
					<p>
						{m.home_sidebar_email_notifications()}
					</p>
				</div>

				<div class="divider my-2"></div>

				<div class="flex items-start gap-2">
					<HatGlasses size={16} class="text-info/70 mt-0.5 shrink-0" />
					<p>
						{m.home_sidebar_privacy()}
					</p>
				</div>

				<div class="divider my-2"></div>

				<p class="text-xs opacity-90">
					{m.home_sidebar_guest_caveat()}
				</p>
			</div>
		</div>
	</div>
</div>
