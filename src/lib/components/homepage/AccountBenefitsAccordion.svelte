<script lang="ts">
	import { HatGlasses, InfoIcon, Mail, Smartphone } from "@lucide/svelte";
	import * as m from "$lib/paraglide/messages.js";
</script>

<div class="space-y-1">
	<!-- Titre -->
	<div class="mb-2 flex items-center gap-2">
		<InfoIcon size={20} class="text-info" />
		<h3 class="text-lg font-bold">{m.home_accordion_why_account()}</h3>
	</div>

	<!-- Accordion 1: Retrouvez vos plannings -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" checked />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<Smartphone size={18} class="text-info" />
			<span>{m.home_accordion_cross_device_title()}</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				{m.home_accordion_cross_device_desc()}
			</p>
		</div>
	</div>

	<!-- Accordion 2: Recevez des notifications -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<Mail size={18} class="text-info" />
			<span>{m.home_accordion_notifications_title()}</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				{m.home_accordion_notifications_email()}
			</p>
			<p class="mt-2 text-sm opacity-80">
				{m.home_accordion_notifications_push()}
			</p>
		</div>
	</div>

	<!-- Accordion 3: Respecte votre vie privée -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<HatGlasses size={18} class="text-info" />
			<span>{m.home_accordion_privacy_title()}</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				{m.home_accordion_privacy_desc()}
			</p>
			<p class="mt-2 text-sm opacity-80">{m.home_accordion_privacy_no_sharing()}</p>
		</div>
	</div>

	<!-- Accordion 4: Sans compte -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<InfoIcon size={18} class="text-info/70" />
			<span>{m.home_accordion_no_account_title()}</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				{m.home_accordion_no_account_desc()}
			</p>
			<p class="mt-2 text-sm opacity-80">
				{m.home_accordion_no_account_save_urls()}
			</p>
		</div>
	</div>
</div>
