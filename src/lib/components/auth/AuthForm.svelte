<script lang="ts">
	import { pb } from '$lib/pocketbase/pb';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { defaultNotifSub, subscribeToPush } from '$lib/services/push';
	import { toast } from 'svelte-sonner';
	import { Mail, KeyRound, LoaderCircle } from 'lucide-svelte';
	import { onMount } from 'svelte';

	interface Props {
		mode?: 'register' | 'login';
		compact?: boolean;
		name?: string;
		onSuccess?: () => void;
	}

	let { mode = 'login', compact = false, name = '', onSuccess }: Props = $props();

	let email = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	
	let emailNotif = $state(false);
	let pushNotif = $state(false);
	
	let isMobile = $state(false);
	let isSubmitting = $state(false);
	let errorMsg = $state('');

	onMount(() => {
		isMobile = window.matchMedia('(pointer: coarse)').matches;
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!email || !password) return;
		if (mode === 'register' && password !== passwordConfirm) {
			errorMsg = "Les mots de passe ne correspondent pas.";
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

				const sub = { ...defaultNotifSub };
				if (emailNotif) sub.email = true;
				if (pushNotif) sub.push = true;

				// Créer l'utilisateur PocketBase (l'ID est l'uuid du client)
				await pb.collection('users').create({
					id: userId,
					email,
					password,
					passwordConfirm,
					name,
					notificationsSubscription: sub
				});

				// Authentification auto
				await pb.collection('users').authWithPassword(email, password);

				// Souscription push si demandée
				if (pushNotif) {
					const pushSuccess = await subscribeToPush(userId);
					if (!pushSuccess) {
						toast.warning("Impossible d'activer les notifications push. Vérifiez les permissions de votre navigateur.");
					}
				}

				toast.success('Compte créé avec succès !');

			} else {
				// Mode Login
				await pb.collection('users').authWithPassword(email, password);
				toast.success('Connexion réussie !');
			}

			if (onSuccess) onSuccess();

		} catch (error: any) {
			console.error("Auth error", error);
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
		<fieldset class="space-y-3">
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

			<!-- Préférences de base -->
			<div class="space-y-2 pt-2 px-1">
				<label class="label cursor-pointer justify-start gap-3 py-1">
					<input
						type="checkbox"
						bind:checked={emailNotif}
						class="checkbox checkbox-primary checkbox-sm"
						disabled={isSubmitting}
					/>
					<span class="label-text font-medium text-sm">Recevoir les notifications par email</span>
				</label>
				
				{#if isMobile && ('serviceWorker' in navigator) && ('PushManager' in window)}
					<label class="label cursor-pointer justify-start gap-3 py-1">
						<input
							type="checkbox"
							bind:checked={pushNotif}
							class="checkbox checkbox-secondary checkbox-sm"
							disabled={isSubmitting}
						/>
						<span class="label-text font-medium text-sm">Activer les notifications push</span>
					</label>
				{/if}
			</div>
		</fieldset>
	{/if}

	<button
		type="submit"
		class="btn btn-primary btn-block"
		class:btn-sm={compact}
		disabled={isSubmitting || !email || !password || (mode === 'register' && password !== passwordConfirm)}
	>
		{#if isSubmitting}
			<LoaderCircle class="animate-spin" size={compact ? 16 : 18} />
			Validation...
		{:else}
			{mode === 'register' ? "S'inscrire" : 'Se connecter'}
		{/if}
	</button>
</form>
