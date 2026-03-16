<!-- src/lib/components/homepage/AuthSection.svelte -->
<script lang="ts">
	import AuthForm from '$lib/components/auth/AuthForm.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { Lightbulb, Mail, ShieldCheck, Smartphone } from 'lucide-svelte';

	let authMode = $state<'register' | 'login'>('register');

	async function handleAuthSuccess() {
		// Après auth réussie, la page va se mettre à jour automatiquement
		// grâce à la réactivité de userStore.globalProfile
	}
</script>

<div class="space-y-6">
	<!-- AuthForm Inline -->
	<div class="card bg-base-100 shadow-md">
		<div class="card-body">
			<div class="grid gap-8 md:grid-cols-2">
				<!-- Alert Info: Intérêt du compte -->
				<div class="alert alert-info alert-soft shadow-sm">
					<div class="flex items-start gap-4">
						<Lightbulb size={24} class="text-info shrink-0" />
						<div class="flex-1 space-y-3">
							<h3 class="text-base font-bold">
								Créez un compte pour retrouver vos plannings partout
							</h3>

							<ul class="space-y-2 text-sm">
								<li class="flex items-start gap-2">
									<Smartphone size={16} class="text-info/70 mt-0.5 shrink-0" />
									<span class="opacity-80">
										<strong>Retrouvez vos plannings</strong> sur tous vos appareils (mobile, tablette,
										ordinateur)
									</span>
								</li>
								<li class="flex items-start gap-2">
									<Mail size={16} class="text-info/70 mt-0.5 shrink-0" />
									<span class="opacity-80">
										<strong>Configurer et recevez des notifications par email</strong> ou directement
										sur votre mobile (installer l'app en un clic) pour vous prévenir des annulations,
										de vos inscriptions, etc...
									</span>
								</li>
							</ul>
						</div>
					</div>
				</div>

				<div>
					<h3 class="card-title mb-4 text-base">
						{authMode === 'register' ? 'Créer un compte' : 'Se connecter'}
					</h3>

					<AuthForm
						mode={authMode}
						showNameInput={true}
						name={userStore.globalProfile?.defaultName}
						onSuccess={handleAuthSuccess}
					/>

					<div class="divider text-xs opacity-50">OU</div>

					<button
						class="btn btn-ghost btn-block text-sm"
						onclick={() => (authMode = authMode === 'register' ? 'login' : 'register')}
					>
						{authMode === 'register'
							? "J'ai déjà un compte - Se connecter"
							: "Je n'ai pas de compte - Créer un compte"}
					</button>
				</div>
			</div>
		</div>
	</div>
</div>
