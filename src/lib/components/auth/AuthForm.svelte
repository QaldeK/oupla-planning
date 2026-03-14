<script lang="ts">
	import { pb } from '$lib/pocketbase/pb';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { toast } from 'svelte-sonner';
	import { Mail, KeyRound, LoaderCircle, User } from 'lucide-svelte';

	interface Props {
		mode?: 'register' | 'login';
		compact?: boolean;
		name?: string;
		showNameInput?: boolean;
		onSuccess?: () => void;
	}

	let {
		mode = 'login',
		compact = false,
		name = '',
		showNameInput = true,
		onSuccess
	}: Props = $props();

	let email = $state('');
	let password = $state('');
	let passwordConfirm = $state('');

	let isSubmitting = $state(false);
	let errorMsg = $state('');

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!email || !password) return;
		if (mode === 'register' && password !== passwordConfirm) {
			errorMsg = 'Les mots de passe ne correspondent pas.';
			return;
		}

		isSubmitting = true;
		errorMsg = '';

		try {
			if (mode === 'register') {
				const globalProfile = userStore.globalProfile;
				const userId = globalProfile ? globalProfile.id : crypto.randomUUID();

				if (!globalProfile) {
					// Utilisation du nom fourni ou à défaut le prefix de l'email
					const defaultName = name || email.split('@')[0];
					await userStore.createGlobalProfile(defaultName, email, true);
					// Force the ID
					await userStore.updateGlobalProfile({ id: userId });
				}

				// Créer l'utilisateur PocketBase (l'ID est l'uuid du client)
				await pb.collection('users').create({
					id: userId,
					email,
					password,
					passwordConfirm,
					name
				});

				// Authentification auto
				await pb.collection('users').authWithPassword(email, password);

				toast.success('Compte créé avec succès !');
			} else {
				// Mode Login
				await pb.collection('users').authWithPassword(email, password);
				toast.success('Connexion réussie !');
			}

			if (onSuccess) onSuccess();
		} catch (error: any) {
			console.error('Auth error', error);
			errorMsg = error.response?.message || "Une erreur inattendue s'est produite.";
		} finally {
			isSubmitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit} class="space-y-4">
	{#if errorMsg}
		<div class="alert alert-error alert-soft max-sm:alert-vertical p-2 text-sm">
			<span>{errorMsg}</span>
		</div>
	{/if}

	{#if showNameInput}
		<fieldset>
			<label class="input w-full" class:input-sm={compact}>
				<span class="label">
					<User size={compact ? 16 : 18} class="opacity-40" />
					Nom
				</span>
				<input
					type="text"
					bind:value={name}
					class="grow"
					placeholder="Votre nom"
					required
					autocomplete="name"
					disabled={isSubmitting}
				/>
			</label>
		</fieldset>
	{/if}

	<fieldset>
		<label class="input w-full" class:input-sm={compact}>
			<span class="label">
				<Mail size={compact ? 16 : 18} class="opacity-40" />
				Email
			</span>
			<input
				type="email"
				bind:value={email}
				class="grow"
				placeholder="votre@email.fr"
				required
				autocomplete="email"
				disabled={isSubmitting}
			/>
		</label>
	</fieldset>

	<fieldset>
		<label class="input w-full" class:input-sm={compact}>
			<span class="label">
				<KeyRound size={compact ? 16 : 18} class="opacity-40" />
				Mot de passe
			</span>
			<input
				type="password"
				bind:value={password}
				class="grow"
				placeholder="********"
				required
				minlength="8"
				autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
				disabled={isSubmitting}
			/>
		</label>
	</fieldset>

	{#if mode === 'register'}
		<fieldset>
			<label class="input w-full" class:input-sm={compact}>
				<span class="label">
					<KeyRound size={compact ? 16 : 18} class="opacity-40" />
					Confirmer
				</span>
				<input
					type="password"
					bind:value={passwordConfirm}
					class="grow"
					placeholder="********"
					required
					minlength="8"
					autocomplete="new-password"
					disabled={isSubmitting}
				/>
			</label>
		</fieldset>
	{/if}

	<button
		type="submit"
		class="btn btn-primary btn-block"
		class:btn-sm={compact}
		disabled={isSubmitting ||
			!email ||
			!password ||
			(mode === 'register' && password !== passwordConfirm)}
	>
		{#if isSubmitting}
			<LoaderCircle class="animate-spin" size={compact ? 16 : 18} />
			Validation...
		{:else}
			{mode === 'register' ? "S'inscrire" : 'Se connecter'}
		{/if}
	</button>
</form>
