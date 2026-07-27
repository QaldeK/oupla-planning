<!-- src/lib/components/homepage/AuthSection.svelte -->
<script lang="ts">
import AuthForm from "$lib/components/auth/AuthForm.svelte";
import AccountBenefitsAccordion from "$lib/components/homepage/AccountBenefitsAccordion.svelte";
import * as m from "$lib/paraglide/messages.js";

let authMode = $state<"register" | "login">("register");

async function handleAuthSuccess() {
	// Après auth réussie, la page va se mettre à jour automatiquement
	// grâce à la réactivité de userStore.isLoggedIn
}
</script>

<div class="space-y-6">
	<!-- AuthForm Inline -->
	<div class="card bg-base-100 shadow-md">
		<div class="card-body">
			<h3 class="card-title mb-4 text-base">
				{authMode === 'register' ? m.home_auth_form_register_title() : m.home_auth_form_login_title()}
			</h3>

			<AuthForm mode={authMode} showNameInput={true} onSuccess={handleAuthSuccess} />

			<div class="divider text-xs opacity-50">{m.home_auth_form_or_divider()}</div>

			<button
				class="btn btn-ghost btn-block text-sm"
				onclick={() => (authMode = authMode === 'register' ? 'login' : 'register')}
			>
				{authMode === 'register'
					? m.home_auth_form_switch_to_login()
					: m.home_auth_form_switch_to_register()}
			</button>
		</div>
	</div>

	<!-- Accordion: Avantages du compte (mobile ET desktop) -->
	<div class="card bg-base-100 shadow-md">
		<div class="card-body pt-4">
			<AccountBenefitsAccordion />
		</div>
	</div>
</div>
