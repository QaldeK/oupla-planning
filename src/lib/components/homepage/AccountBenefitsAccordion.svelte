<script lang="ts">
import { HatGlasses, InfoIcon, Mail, Smartphone } from "@lucide/svelte";
</script>

<div class="space-y-1">
	<!-- Titre -->
	<div class="mb-2 flex items-center gap-2">
		<InfoIcon size={20} class="text-info" />
		<h3 class="text-lg font-bold">Pourquoi créer un compte ?</h3>
	</div>

	<!-- Accordion 1: Retrouvez vos plannings -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" checked />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<Smartphone size={18} class="text-info" />
			<span>Retrouvez vos plannings partout</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				Accédez à vos plannings depuis tous vos appareils : mobile, tablette, ordinateur. Vos
				données sont synchronisées automatiquement.
			</p>
		</div>
	</div>

	<!-- Accordion 2: Recevez des notifications -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<Mail size={18} class="text-info" />
			<span>Recevez des notifications</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				<strong>Par email</strong> : soyez alerté des annulations, de vos inscriptions, et des modifications
				importantes.
			</p>
			<p class="mt-2 text-sm opacity-80">
				<strong>Sur mobile</strong> : installez l'app en un clic pour recevoir des notifications push
				directement sur votre appareil.
			</p>
		</div>
	</div>

	<!-- Accordion 3: Respecte votre vie privée -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<HatGlasses size={18} class="text-info" />
			<span>Respecte votre vie privée</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				<strong>oupla-planning</strong> ne collecte aucune donnée personnelle autre que vos identifiants
				de connexion et les plannings eux-mêmes.
			</p>
			<p class="mt-2 text-sm opacity-80">Vos données ne sont jamais partagées à des tiers.</p>
		</div>
	</div>

	<!-- Accordion 4: Sans compte -->
	<div class="collapse-arrow border-base-300 bg-base-100 collapse border">
		<input type="radio" name="account-accordion" />
		<div class="collapse-title flex items-center gap-3 font-medium">
			<InfoIcon size={18} class="text-info/70" />
			<span>... ou participez sans compte</span>
		</div>
		<div class="collapse-content">
			<p class="text-sm opacity-80">
				Il est possible de créer et de participer à des plannings sans compte.
			</p>
			<p class="mt-2 text-sm opacity-80">
				Penser à sauvegarder les URLs des plannings pour ne pas les perdre.
			</p>
		</div>
	</div>
</div>
