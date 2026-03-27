<script lang="ts">
	import { pb } from '$lib/pocketbase/pb';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { toast } from 'svelte-sonner';
	import { Mail, KeyRound, LoaderCircle, User } from 'lucide-svelte';

	interface Props {
		mode?: 'register' | 'login';
		compact?: boolean;
		name?: string;
		initialEmail?: string;
		focusEmail?: boolean;
		showNameInput?: boolean;
		onSuccess?: () => void;
	}

	let {
		mode = 'login',
		compact = false,
		name = '',
		initialEmail = '',
		focusEmail = false,
		showNameInput = true,
		onSuccess
	}: Props = $props();

	let email = $state(initialEmail);
	let password = $state('');
	let passwordConfirm = $state('');
	let emailInputRef = $state<HTMLInputElement | null>(null);

	// État local pour le nom (sync avec prop car les props sont read-only)
	let localName = $state(name);
	// $effect(() => {
	// 	localName = name;
	// });

	let isSubmitting = $state(false);
	let errorMsg = $state('');

	// États de validation
	let emailError = $state('');
	let passwordError = $state('');
	let passwordConfirmError = $state('');

	// Focus auto sur l'email si demandé
	$effect(() => {
		if (focusEmail && emailInputRef) {
			setTimeout(() => emailInputRef?.focus(), 50);
		}
	});

	// Validation en temps réel
	$effect(() => {
		// Reset erreurs quand l'utilisateur tape
		if (emailError && email) emailError = '';
		if (passwordError && password) passwordError = '';
		if (passwordConfirmError && passwordConfirm) passwordConfirmError = '';
	});

	// Valider automatiquement la confirmation en register
	$effect(() => {
		if (mode === 'register' && passwordConfirm && password) {
			if (passwordConfirmError && password === passwordConfirm) {
				passwordConfirmError = '';
			}
		}
	});

	function validateEmail(): boolean {
		if (!email) {
			emailError = 'Email requis';
			return false;
		}
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			emailError = 'Email invalide';
			return false;
		}
		emailError = '';
		return true;
	}

	function validatePassword(): boolean {
		if (!password) {
			passwordError = 'Mot de passe requis';
			return false;
		}
		if (password.length < 8) {
			passwordError = 'Minimum 8 caractères';
			return false;
		}
		passwordError = '';
		return true;
	}

	function validatePasswordConfirm(): boolean {
		if (mode === 'register' && password !== passwordConfirm) {
			passwordConfirmError = 'Les mots de passe ne correspondent pas';
			return false;
		}
		passwordConfirmError = '';
		return true;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();

		// Valider tous les champs
		const isEmailValid = validateEmail();
		const isPasswordValid = validatePassword();
		const isPasswordConfirmValid = mode === 'register' ? validatePasswordConfirm() : true;

		if (!isEmailValid || !isPasswordValid || !isPasswordConfirmValid) {
			return;
		}

		isSubmitting = true;
		errorMsg = '';

		try {
			if (mode === 'register') {
				// Si le nom n'est pas renseigné, extraire la partie avant '@' de l'email
				const userName = localName.trim() || email.split('@')[0];

				// Créer l'utilisateur PocketBase
				await pb.collection('users').create({
					email,
					password,
					passwordConfirm,
					name: userName
				});

				// Authentification auto
				await pb.collection('users').authWithPassword(email, password);

				// La synchronisation des plannings est gérée par syncService dans le layout

				toast.success('Compte créé avec succès !');
			} else {
				// Mode Login
				await pb.collection('users').authWithPassword(email, password);

				// La synchronisation des plannings est gérée par syncService dans le layout

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

	{#if showNameInput && mode === 'register'}
		<fieldset>
			<label class="input w-full">
				<span class="label">
					<User size={compact ? 16 : 18} class="opacity-40" />
					Nom
				</span>
				<input
					type="text"
					bind:value={localName}
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
		<label class="input w-full {emailError ? 'input-error' : ''}">
			<span class="label">
				<Mail size={compact ? 16 : 18} class="opacity-40" />
				Email
			</span>
			<input
				bind:this={emailInputRef}
				type="email"
				bind:value={email}
				class="grow"
				placeholder="votre@email.fr"
				required
				autocomplete="email"
				disabled={isSubmitting}
				onblur={validateEmail}
			/>
		</label>
		{#if emailError}
			<p class="text-error mt-1 text-xs">{emailError}</p>
		{/if}
	</fieldset>

	<fieldset>
		<label class="input w-full {passwordError ? 'input-error' : ''}">
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
				onblur={validatePassword}
			/>
		</label>
		{#if passwordError}
			<p class="text-error mt-1 text-xs">{passwordError}</p>
		{/if}
	</fieldset>

	{#if mode === 'register'}
		<fieldset>
			<label class="input w-full {passwordConfirmError ? 'input-error' : ''}">
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
					onblur={validatePasswordConfirm}
				/>
			</label>
			{#if passwordConfirmError}
				<p class="text-error mt-1 text-xs">{passwordConfirmError}</p>
			{/if}
		</fieldset>
	{/if}

	<button type="submit" class="btn btn-primary btn-block" disabled={isSubmitting}>
		{#if isSubmitting}
			<LoaderCircle class="animate-spin" size={compact ? 16 : 18} />
			Validation...
		{:else}
			{mode === 'register' ? "S'inscrire" : 'Se connecter'}
		{/if}
	</button>
</form>
