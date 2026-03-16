<script lang="ts">
	import Modal from './ui/Modal.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { AlertTriangle, Users, Trash2, UserPlus, SkipForward } from 'lucide-svelte';
	import type { BackupProfile } from '$lib/stores/userStore.svelte';
	import { storage } from '$lib/utils/storage';
	import { BACKUP_KEY } from '$lib/stores/userStore.svelte';

	const restoreModal = $state({
		open: false,
		backupName: '',
		isProcessing: false
	});

	const switchModal = $state({
		open: false,
		currentProfile: '',
		backupProfile: '',
		isProcessing: false
	});

	/**
	 * Vérifie et gère les backups au démarrage
	 */
	async function checkBackups() {
		const hasBackup = await userStore.hasBackup();
		if (!hasBackup) return;

		const backup = await storage.getItem<BackupProfile>(BACKUP_KEY);
		if (!backup) return;

		if (!userStore.globalProfile) {
			// Scénario 1 : Pas de profil local, proposer la restauration
			restoreModal.backupName = backup.globalProfile.defaultName;
			restoreModal.open = true;
		} else {
			// Scénario 2 : Vérifier si le backup est d'un autre utilisateur
			if (backup.globalProfile.id !== userStore.globalProfile.id) {
				switchModal.currentProfile = userStore.globalProfile.defaultName;
				switchModal.backupProfile = backup.globalProfile.defaultName;
				switchModal.open = true;
			}
		}
	}

	/**
	 * Restaure le backup (Scénario 1)
	 */
	async function handleRestore() {
		restoreModal.isProcessing = true;
		try {
			await userStore.restoreBackup();
			restoreModal.open = false;
			location.reload(); // Recharger pour appliquer les changements
		} catch (error) {
			console.error('Erreur lors de la restauration:', error);
		} finally {
			restoreModal.isProcessing = false;
		}
	}

	/**
	 * Supprime le backup (Scénario 1)
	 */
	async function handleDeleteBackup() {
		restoreModal.isProcessing = true;
		try {
			await userStore.deleteBackup();
			restoreModal.open = false;
		} catch (error) {
			console.error('Erreur lors de la suppression:', error);
		} finally {
			restoreModal.isProcessing = false;
		}
	}

	/**
	 * Switch vers le backup (Scénario 2)
	 */
	async function handleSwitchToBackup() {
		switchModal.isProcessing = true;
		try {
			// Backup du profil actuel avant de switcher
			await userStore.backupLocalProfile();
			// Restauration du backup de l'autre utilisateur
			await userStore.restoreBackup();
			switchModal.open = false;
			location.reload(); // Recharger pour appliquer les changements
		} catch (error) {
			console.error('Erreur lors du switch:', error);
		} finally {
			switchModal.isProcessing = false;
		}
	}

	/**
	 * Supprime le backup et garde le profil actuel (Scénario 2)
	 */
	async function handleDeleteBackupAndKeep() {
		switchModal.isProcessing = true;
		try {
			await userStore.deleteBackup();
			switchModal.open = false;
		} catch (error) {
			console.error('Erreur lors de la suppression:', error);
		} finally {
			switchModal.isProcessing = false;
		}
	}

	/**
	 * Garde le profil actuel et ferme le modal (Scénario 2)
	 */
	function handleKeepCurrent() {
		switchModal.open = false;
	}

	/**
	 * Ouvre le modal d'authentification (Scénario 1)
	 */
	function handleOpenAuth() {
		restoreModal.open = false;
		userStore.authModal = { open: true, mode: 'homepage' };
	}

	/**
	 * Ignore et continue sans profil (Scénario 1)
	 */
	function handleSkip() {
		restoreModal.open = false;
	}

	// Exposer les méthodes pour utilisation externe
	export async function init() {
		await checkBackups();
	}
</script>

<!-- Scénario 1 : Modal de restauration au démarrage -->
<Modal
	open={restoreModal.open}
	onClose={() => {
		if (!restoreModal.isProcessing) restoreModal.open = false;
	}}
	title="Profil local détecté"
	size="sm"
>
	<div class="space-y-4 py-2">
		<div class="flex items-start gap-4">
			<div class="bg-info/10 rounded-full p-2">
				<Users size={24} class="text-info" />
			</div>
			<div class="flex-1">
				<p class="text-base font-semibold">
					Une sauvegarde locale existe pour <span class="text-primary"
						>{restoreModal.backupName}</span
					>
				</p>
				<p class="text-base-content/70 mt-2 text-sm">
					Voulez-vous restaurer ce profil ou créer un nouveau compte ?
				</p>
			</div>
		</div>

		<div class="modal-action flex-col gap-2">
			<button
				type="button"
				class="btn btn-primary btn-block"
				onclick={handleRestore}
				disabled={restoreModal.isProcessing}
			>
				{#if restoreModal.isProcessing}
					<span class="loading loading-spinner loading-sm"></span>
					Restauration...
				{:else}
					<Users size={18} class="mr-2" />
					Restaurer le profil
				{/if}
			</button>

			<button
				type="button"
				class="btn btn-outline btn-block"
				onclick={handleOpenAuth}
				disabled={restoreModal.isProcessing}
			>
				<UserPlus size={18} class="mr-2" />
				Créer un compte
			</button>

			<button
				type="button"
				class="btn btn-ghost btn-block text-sm"
				onclick={handleSkip}
				disabled={restoreModal.isProcessing}
			>
				<SkipForward size={18} class="mr-2" />
				Continuer sans profil
			</button>

			<button
				type="button"
				class="btn btn-error btn-ghost btn-block text-sm"
				onclick={handleDeleteBackup}
				disabled={restoreModal.isProcessing}
			>
				<Trash2 size={18} class="mr-2" />
				Supprimer la sauvegarde
			</button>
		</div>
	</div>
</Modal>

<!-- Scénario 2 : Modal de switch entre profils -->
<Modal
	open={switchModal.open}
	onClose={() => {
		if (!switchModal.isProcessing) switchModal.open = false;
	}}
	title="Changement de profil détecté"
	size="sm"
>
	<div class="space-y-4 py-2">
		<div class="flex items-start gap-4">
			<div class="bg-warning/10 rounded-full p-2">
				<AlertTriangle size={24} class="text-warning" />
			</div>
			<div class="flex-1">
				<p class="text-base font-semibold">Backup d'un autre utilisateur détecté</p>
				<p class="text-base-content/70 mt-2 text-sm">
					Profil actuel : <span class="text-primary font-semibold"
						>{switchModal.currentProfile}</span
					>
				</p>
				<p class="text-base-content/70 text-sm">
					Backup disponible : <span class="text-warning font-semibold"
						>{switchModal.backupProfile}</span
					>
				</p>
				<p class="text-base-content/60 mt-2 text-xs">
					Voulez-vous switcher vers ce backup ? Votre profil actuel sera sauvegardé.
				</p>
			</div>
		</div>

		<div class="modal-action flex-col gap-2">
			<button
				type="button"
				class="btn btn-warning btn-block"
				onclick={handleSwitchToBackup}
				disabled={switchModal.isProcessing}
			>
				{#if switchModal.isProcessing}
					<span class="loading loading-spinner loading-sm"></span>
					Changement...
				{:else}
					<Users size={18} class="mr-2" />
					Switcher vers {switchModal.backupProfile}
				{/if}
			</button>

			<button
				type="button"
				class="btn btn-error btn-ghost btn-block text-sm"
				onclick={handleDeleteBackupAndKeep}
				disabled={switchModal.isProcessing}
			>
				<Trash2 size={18} class="mr-2" />
				Supprimer le backup
			</button>

			<button
				type="button"
				class="btn btn-ghost btn-block"
				onclick={handleKeepCurrent}
				disabled={switchModal.isProcessing}
			>
				Garder {switchModal.currentProfile}
			</button>
		</div>
	</div>
</Modal>
