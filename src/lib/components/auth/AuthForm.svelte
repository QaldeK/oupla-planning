<script lang="ts">
	import { pb } from '$lib/pocketbase/pb';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { toast } from 'svelte-sonner';
	import { Mail, KeyRound, LoaderCircle, User } from 'lucide-svelte';
	import CollisionModal from './CollisionModal.svelte';

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

	// Collision modal state
	let collisionModal = $state({
		open: false,
		localName: '',
		remoteName: '',
		isProcessing: false
	});

	// États de validation
	let emailError = $state('');
	let passwordError = $state('');
	let passwordConfirmError = $state('');

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
				const globalProfile = userStore.globalProfile;
				const userId = globalProfile ? globalProfile.id : crypto.randomUUID();

				if (!globalProfile) {
					// Utilisation du nom fourni ou à défaut le prefix de l'email
					const defaultName = name || email.split('@')[0];
					await userStore.createGlobalProfile(defaultName, email, true, userId);
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

				// ⚠️ DÉTECTION DE COLLISION ICI
				const collision = userStore.detectCollision();

				if (collision === 'collision') {
					// Ouvrir le modal de collision
					collisionModal.localName = userStore.globalProfile!.defaultName;
					collisionModal.remoteName = pb.authStore.record?.name || email;
					collisionModal.open = true;
					isSubmitting = false;
					return; // Ne pas continuer pour l'instant
				}

				// Pas de collision : sync normale
				await userStore.syncProfileWithPocketBase();

				toast.success('Compte créé avec succès !');
			} else {
				// Mode Login
				await pb.collection('users').authWithPassword(email, password);

				// ⚠️ DÉTECTION DE COLLISION ICI
				const collision = userStore.detectCollision();

				if (collision === 'collision') {
					// Ouvrir le modal de collision
					collisionModal.localName = userStore.globalProfile!.defaultName;
					collisionModal.remoteName = pb.authStore.record?.name || email;
					collisionModal.open = true;
					isSubmitting = false;
					return; // Ne pas continuer pour l'instant
				}

				// Pas de collision : sync normale
				await userStore.syncProfileWithPocketBase();

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

	// Handlers pour le modal de collision
	async function handleBackupAndReplace() {
		collisionModal.isProcessing = true;
		try {
			await userStore.backupLocalProfile();
			await userStore.syncProfileWithPocketBase();
			await userStore.syncPlanningsWithPocketBase();
			collisionModal.open = false;
			toast.success('Connexion réussie (données précédentes sauvegardées)');
			if (onSuccess) onSuccess();
		} catch (error: any) {
			console.error('Backup and replace error', error);
			errorMsg = error.response?.message || "Une erreur s'est produite lors de la sauvegarde.";
		} finally {
			collisionModal.isProcessing = false;
		}
	}

	async function handleReplaceOnly() {
		collisionModal.isProcessing = true;
		try {
			await userStore.syncProfileWithPocketBase();
			await userStore.syncPlanningsWithPocketBase();
			collisionModal.open = false;
			toast.success('Connexion réussie');
			if (onSuccess) onSuccess();
		} catch (error: any) {
			console.error('Replace only error', error);
			errorMsg = error.response?.message || "Une erreur s'est produite lors de la connexion.";
		} finally {
			collisionModal.isProcessing = false;
		}
	}

	function handleCancelCollision() {
		collisionModal.open = false;
		pb.authStore.clear();
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
		<label class="input w-full {emailError ? 'input-error' : ''}">
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

<!-- Modal de collision -->
<CollisionModal
	open={collisionModal.open}
	localName={collisionModal.localName}
	remoteName={collisionModal.remoteName}
	onBackupAndReplace={handleBackupAndReplace}
	onReplaceOnly={handleReplaceOnly}
	onCancel={handleCancelCollision}
	isSubmitting={collisionModal.isProcessing}
/>
