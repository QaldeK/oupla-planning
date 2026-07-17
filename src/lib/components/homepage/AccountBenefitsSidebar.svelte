<script lang="ts">
	import { HatGlasses, Mail, Smartphone } from '@lucide/svelte';
</script>

<div class="flex flex-1 items-center justify-center py-8">
	<div class="alert alert-info alert-soft max-w-full text-xs shadow-sm">
		<div class="flex items-start gap-3">
			<div class="space-y-2">
				<h2 class="mb-4 text-center text-base font-semibold">
					Créez votre compte pour accéder à tous vos plannings
				</h2>

				<div class="flex items-start gap-3">
					<Smartphone size={20} class="text-info shrink-0" />

					<p>
						<strong>Retrouvez vos plannings partout :</strong> Synchronisez sur mobile, tablette et ordinateur.
						Vos données sont toujours accessibles.
					</p>
				</div>
				<div class="divider my-2"></div>

				<div class="flex items-start gap-2">
					<Mail size={16} class="text-info/70 mt-0.5 shrink-0" />
					<p>
						<strong>Notifications par email</strong> pour les annulations, inscriptions, etc.
					</p>
				</div>

				<div class="divider my-2"></div>

				<div class="flex items-start gap-2">
					<HatGlasses size={16} class="text-info/70 mt-0.5 shrink-0" />
					<p>
						<strong>Respecte votre vie privée</strong> : aucune collecte de données personnelles inutiles.
					</p>
				</div>

				<div class="divider my-2"></div>

				<p class="text-xs opacity-90">
					Vous pouvez continuer sans compte, mais gardez une trace des URLs pour ne pas perdre vos
					plannings.
				</p>
			</div>
		</div>
	</div>
</div>
