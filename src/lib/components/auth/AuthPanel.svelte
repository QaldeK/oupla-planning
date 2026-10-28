<script lang="ts">
	import AuthForm from "./AuthForm.svelte";
	import * as m from "$lib/paraglide/messages.js";

	interface Props {
		/** Mode courant, bindable — le parent l'initialise et peut le réinitialiser. */
		mode?: "register" | "login";
		name?: string;
		onSuccess?: () => void;
	}

	let { mode = $bindable("login"), name = "", onSuccess }: Props = $props();
</script>

<!-- Corps partagé du compte : formulaire + bascule connexion/création.
     Un seul exemplaire, consommé par AccountModal (modale) et AuthWall (mur
     d'authentification de l'app installée). -->
<AuthForm {mode} {onSuccess} compact={false} {name} />

<div class="divider text-[10px] tracking-widest uppercase opacity-50">
	{m.auth_or_divider()}
</div>

<div class="text-center text-sm">
	{#if mode === "register"}
		{m.auth_already_have_account()}
		<button type="button" class="link link-primary font-medium" onclick={() => (mode = "login")}>
			{m.auth_login_link()}
		</button>
	{:else}
		{m.auth_no_account_yet()}
		<button type="button" class="link link-primary font-medium" onclick={() => (mode = "register")}>
			{m.auth_register_link()}
		</button>
	{/if}
</div>
