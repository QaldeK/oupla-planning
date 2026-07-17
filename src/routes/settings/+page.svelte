<script lang="ts">
	import { userStore } from '$lib/stores/userStore.svelte';
	import { pb } from '$lib/pocketbase/pb';
	import { goto } from '$app/navigation';
	import { User, Mail, Lock, LogOut, ShieldCheck } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import Modal from '$lib/components/ui/Modal.svelte';

	// Vérifier que l'utilisateur est connecté
	if (!userStore.isLoggedIn) {
		goto('/');
	}

	// État du formulaire
	let name = $state(userStore.pbUser?.name || '');
	let email = $state(userStore.pbUser?.email || '');
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');

	// État UI
	let isSaving = $state(false);
	let activeTab = $state<'profile' | 'security'>('profile');
	let showPasswordModal = $state(false);

	async function handleProfileUpdate() {
		if (!name.trim()) {
			toast.error('Le nom est requis');
			return;
		}

		isSaving = true;
		try {
			// 1. Mettre à jour PocketBase
			await pb.collection('users').update(pb.authStore.record!.id, {
				name: name.trim(),
				email: email.trim() || undefined
			});

			// 2. Rafraîchir le record authStore pour cohérence immédiate
			await pb.collection('users').authRefresh();

			toast.success('Profil mis à jour');
		} catch (error) {
			console.error('Error updating profile:', error);
			toast.error('Erreur lors de la mise à jour du profil');
		} finally {
			isSaving = false;
		}
	}

	async function handlePasswordChange() {
		if (!currentPassword || !newPassword || !confirmPassword) {
			toast.error('Tous les champs sont requis');
			return;
		}

		if (newPassword !== confirmPassword) {
			toast.error('Les mots de passe ne correspondent pas');
			return;
		}

		if (newPassword.length < 8) {
			toast.error('Le mot de passe doit contenir au moins 8 caractères');
			return;
		}

		isSaving = true;
		try {
			// Vérifier l'ancien mot de passe en se reconnectant
			try {
				await pb.collection('users').authWithPassword(pb.authStore.record!.email, currentPassword);
			} catch {
				toast.error("L'ancien mot de passe est incorrect");
				isSaving = false;
				return;
			}

			// Mettre à jour le mot de passe
			await pb.collection('users').update(pb.authStore.record!.id, {
				password: newPassword,
				passwordConfirm: confirmPassword
			});

			toast.success('Mot de passe modifié');

			// Reset et fermer le modal
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			showPasswordModal = false;
		} catch (error) {
			console.error('Error changing password:', error);
			toast.error('Erreur lors du changement de mot de passe');
		} finally {
			isSaving = false;
		}
	}

	async function handleLogout() {
		await userStore.logout();
		goto('/');
	}
</script>

<svelte:head>
	<title>Paramètres - Planning</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	<div class="mb-8">
		<h1 class="text-3xl font-bold">Paramètres</h1>
		<p class="text-base-content/70 mt-2">Gérez votre profil et vos préférences</p>
	</div>

	<!-- Tabs -->
	<div class="tabs tabs-boxed bg-base-200 mb-8">
		<button
			class={['tab gap-2', activeTab === 'profile' && 'tab-active']}
			onclick={() => (activeTab = 'profile')}
		>
			<User size={18} />
			Profil
		</button>
		<button
			class={['tab gap-2', activeTab === 'security' && 'tab-active']}
			onclick={() => (activeTab = 'security')}
		>
			<ShieldCheck size={18} />
			Sécurité
		</button>
	</div>

	{#if activeTab === 'profile'}
		<div class="card card-compact bg-base-200 shadow-xl">
			<div class="card-body">
				<h2 class="card-title mb-4">Profil</h2>
				<p class="mb-6 text-sm opacity-70">
					Vos informations seront synchronisées sur tous vos appareils.
				</p>

				<form onsubmit={(e) => e.preventDefault()} class="space-y-4">
					<fieldset class="fieldset">
						<label class="input w-full">
							<span class="label">
								<User size={16} />
								Nom d'affichage
							</span>
							<input
								type="text"
								class=" w-full"
								bind:value={name}
								placeholder="Votre nom"
								disabled={isSaving}
							/>
						</label>

						<p class="label ms-auto text-xs">Sera pris en compte pour les nouveau planning.</p>
					</fieldset>

					<fieldset class="fieldset">
						<label class="input w-full">
							<span class="label">
								<Mail size={16} />
								Email
							</span>
							<input
								type="email"
								class="w-full"
								bind:value={email}
								placeholder="votre@email.com"
								disabled={isSaving}
							/>
						</label>
					</fieldset>

					<div class="card-actions mt-6 justify-end">
						<button
							class="btn btn-primary"
							onclick={handleProfileUpdate}
							disabled={isSaving || !name.trim()}
						>
							{#if isSaving}
								<span class="loading loading-spinner loading-xs"></span>
								Enregistrement...
							{:else}
								Enregistrer
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	{:else if activeTab === 'security'}
		<div class="card card-compact bg-base-200 shadow-xl">
			<div class="card-body">
				<h2 class="card-title mb-4">Sécurité</h2>
				<p class="mb-6 text-sm opacity-70">Gérez votre mot de passe et votre session.</p>

				<div class="space-y-6">
					<!-- Changement de mot de passe -->
					<div class="border-base-content/10 flex items-center justify-between border-b pb-6">
						<div>
							<h3 class="flex items-center gap-2 font-medium">
								<Lock size={16} />
								Mot de passe
							</h3>
							<p class="text-sm opacity-70">Changer votre mot de passe</p>
						</div>
						<button class="btn btn-ghost btn-sm" onclick={() => (showPasswordModal = true)}>
							Modifier
						</button>
					</div>

					<!-- Déconnexion -->
					<div class="flex items-center justify-between">
						<div>
							<h3 class="flex items-center gap-2 font-medium">
								<LogOut size={16} />
								Session
							</h3>
							<p class="text-sm opacity-70">Se déconnecter de cet appareil</p>
						</div>
						<button class="btn btn-error btn-ghost btn-sm" onclick={handleLogout}>
							Déconnexion
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Modal changement de mot de passe -->
<Modal
	bind:open={showPasswordModal}
	onClose={() => (showPasswordModal = false)}
	title="Changer le mot de passe"
	size="sm"
>
	<div class="space-y-4">
		<p class="text-sm opacity-70">Entrez votre mot de passe actuel pour confirmer le changement.</p>

		<form onsubmit={(e) => e.preventDefault()} class="space-y-4">
			<fieldset>
				<label class="label" for="current-password">
					<span class="label-text">Mot de passe actuel</span>
				</label>
				<input
					id="current-password"
					type="password"
					class="input input-bordered w-full"
					bind:value={currentPassword}
					placeholder="••••••••"
					disabled={isSaving}
				/>
			</fieldset>

			<fieldset>
				<label class="label" for="new-password">
					<span class="label-text">Nouveau mot de passe</span>
				</label>
				<input
					id="new-password"
					type="password"
					class="input input-bordered w-full"
					bind:value={newPassword}
					placeholder="Au moins 8 caractères"
					disabled={isSaving}
				/>
			</fieldset>

			<fieldset>
				<label class="label" for="confirm-password">
					<span class="label-text">Confirmer le mot de passe</span>
				</label>
				<input
					id="confirm-password"
					type="password"
					class="input input-bordered w-full"
					bind:value={confirmPassword}
					placeholder="••••••••"
					disabled={isSaving}
				/>
			</fieldset>

			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (showPasswordModal = false)}> Annuler </button>
				<button
					class="btn btn-primary"
					onclick={handlePasswordChange}
					disabled={isSaving || !currentPassword || !newPassword || !confirmPassword}
				>
					{#if isSaving}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						Changer
					{/if}
				</button>
			</div>
		</form>
	</div>
</Modal>
