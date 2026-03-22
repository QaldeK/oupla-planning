<script lang="ts">
	import type { Participant, SavedPlanning } from '$lib/types/planning.types';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { isTauri, storage } from '$lib/utils/storage';
	import Modal from './ui/Modal.svelte';
	import ConfirmModal from './ui/ConfirmModal.svelte';
	import AuthForm from './auth/AuthForm.svelte';
	import NameConflictHandler from './NameConflictHandler.svelte';
	import { User, ArrowRight, InfoIcon, ArrowLeft } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	const PLANNINGS_KEY = 'planning_saved';

	interface Props {
		open: boolean;
		onClose: () => void;
		mode: 'homepage' | 'edit-global';
		existingParticipants?: Participant[];
		onGlobalProfileCreate?: (name: string, email?: string, persist?: boolean) => void;
		onGlobalProfileUpdate?: (name: string, email?: string, persist?: boolean) => void;
		onRequireLogin?: () => void; // Appelé quand une revendication nécessite une connexion
	}

	let {
		open = $bindable(false),
		onClose,
		mode,
		existingParticipants = [],
		onGlobalProfileCreate,
		onGlobalProfileUpdate,
		onRequireLogin
	}: Props = $props();

	let name = $state('');
	let email = $state('');
	let globalPersist = $state(userStore.globalProfile?.persist ?? true);
	let isSubmitting = $state(false);
	let showConfirmClear = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);

	// Focus auto à l'ouverture
	$effect(() => {
		if (open && inputRef) {
			setTimeout(() => inputRef?.focus(), 50);
		}
	});

	// Réagir aux changements du toggle avec migration des données
	$effect(() => {
		if (!userStore.globalProfile) return;

		const oldPersist = userStore.globalProfile.persist;
		const newPersist = globalPersist;

		if (oldPersist !== newPersist) {
			handlePersistChange(newPersist);
		}
	});

	async function handlePersistChange(newPersist: boolean) {
		if (newPersist) {
			// false → true : Transférer sessionStorage → localStorage
			await migrateSessionToLocalStorage();
		} else {
			// true → false : Transférer localStorage → sessionStorage
			await migrateLocalStorageToSessionStorage();
		}

		// Mettre à jour le profil global
		await userStore.updateGlobalProfile({ persist: newPersist });
	}

	async function migrateSessionToLocalStorage() {
		const session =
			(await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist: false })) || [];
		if (session.length === 0) return;

		// Récupérer aussi les localStorage existants
		const local = (await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist: true })) || [];

		// Fusionner
		const merged = [...local];
		for (const planning of session) {
			if (!merged.find((p) => p.masterId === planning.masterId)) {
				merged.push(planning);
			}
		}

		userStore.savedPlannings = merged;
		await userStore.savePlanningsLocal();

		toast.info(`${session.length} planning(s) transféré(s) vers le stockage permanent.`);
	}

	async function migrateLocalStorageToSessionStorage() {
		const local = (await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist: true })) || [];
		if (local.length === 0) return;

		// Récupérer aussi les sessionStorage existants
		const session =
			(await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist: false })) || [];

		// Fusionner
		const merged = [...session];
		for (const planning of local) {
			if (!merged.find((p) => p.masterId === planning.masterId)) {
				merged.push(planning);
			}
		}

		userStore.savedPlannings = merged;
		await userStore.savePlanningsLocal();

		toast.info(`${local.length} planning(s) transféré(s) vers le stockage temporaire.`);
	}

	// Initialiser les champs à l'ouverture
	$effect(() => {
		if (open) {
			if (userStore.globalProfile) {
				name = userStore.globalProfile.defaultName;
				email = userStore.globalProfile.defaultEmail || '';
			} else {
				name = '';
				email = '';
			}
		}
	});

	// === Gestion des callbacks de NameConflictHandler ===

	// Appelé quand on clique "C'est moi !" sur un participant sans compte
	async function handleIdentifyAs(participant: Participant) {
		isSubmitting = true;
		try {
			// Créer ou mettre à jour le globalProfile avec ce participant
			if (!userStore.globalProfile) {
				await userStore.createGlobalProfile(
					participant.name,
					participant.email,
					globalPersist,
					participant.id
				);
			} else {
				// Mettre à jour le globalProfile existant avec les infos du participant
				await userStore.updateGlobalProfile({
					defaultName: participant.name,
					defaultEmail: participant.email
				});
			}

			toast.success(`Bienvenue, ${participant.name} !`);
			onClose();
		} catch (error) {
			console.error('Error identifying as participant:', error);
			toast.error("Erreur lors de l'identification");
		} finally {
			isSubmitting = false;
		}
	}

	// Appelé quand le participant a un compte protégé
	function handleRequireLogin() {
		// Fermer IdentifyModal et notifier le parent pour ouvrir AccountModal
		onClose();
		onRequireLogin?.();
	}

	async function handleManualIdentify() {
		if (!name.trim()) return;

		// Cas Homepage : Création du profil global
		if (mode === 'homepage') {
			onGlobalProfileCreate?.(name.trim(), email.trim() || undefined, globalPersist);
			onClose();
			return;
		}

		// Cas Edit Global : Modification du profil global (guest uniquement)
		if (mode === 'edit-global') {
			onGlobalProfileUpdate?.(name.trim(), email.trim() || undefined, globalPersist);
			onClose();
			return;
		}
	}

	async function handleClearProfile() {
		await userStore.clearUser();
		showConfirmClear = false;
		toast.info('Profil effacé de cet appareil');
		onClose();
	}
</script>

<Modal {open} {onClose} title={mode === 'edit-global' ? 'Mon Profil' : 'Identification'} size="md">
	<div class="space-y-6">
		{#if mode === 'edit-global'}
			<p class="text-sm opacity-80">
				Modifiez votre profil par défaut. Ces changements s'appliqueront aux nouveaux plannings.
			</p>
		{:else}
			<p class="text-sm opacity-80">
				Créez votre profil pour commencer. Il sera utilisé par défaut dans les plannings.
			</p>
		{/if}

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleManualIdentify();
			}}
			class="space-y-5"
		>
			<fieldset>
				<label class="input w-full">
					<span class="label">
						<User size={18} class="opacity-40" />
						Nom *
					</span>
					<input
						bind:this={inputRef}
						type="text"
						bind:value={name}
						class="grow"
						placeholder="Votre nom ou pseudo"
						required
						disabled={isSubmitting}
					/>
				</label>
				<div class="fieldset-label p-1 text-xs">
					{#if mode === 'edit-global'}
						C'est le nom qui apparaîtra par défaut dans les plannings que vous rejoindrez.
					{:else}
						C'est le nom qui apparaîtra pour les autres participants.
					{/if}
				</div>
			</fieldset>

			<!-- Détection de conflit via NameConflictHandler (mode homepage uniquement) -->
			{#if mode === 'homepage' && existingParticipants.length > 0}
				<NameConflictHandler
					{name}
					{existingParticipants}
					currentUserId={userStore.globalProfile?.id}
					allowClaimIdentity={true}
					onIdentifyAs={handleIdentifyAs}
					onRequireLogin={handleRequireLogin}
				/>
			{/if}

			{#if (!isTauri || !userStore.isLoggedIn) && mode === 'homepage'}
				<!-- Toggle "Mémoriser sur cet appareil" -->
				<div class="card card-xs {globalPersist ? 'bg-success/10' : 'bg-warning/10'}">
					<div class="card-body">
						<label class="label cursor-pointer justify-start gap-3">
							<input
								type="checkbox"
								class="toggle toggle-primary"
								bind:checked={globalPersist}
								disabled={isSubmitting}
							/>
							<div class="grid-row">
								<div class="label-text text-base font-medium">Mémoriser sur cet appareil</div>
								<div>Vos plannings seront sauvegardés sur cet appareil.</div>
							</div>
						</label>
						<p class="text-xxs mt-1 px-2 opacity-70">
							⚠️ Ne fonctionne pas en navigation privée. Peut être perdu lors du nettoyage du cache.
							Gardez les URLs des plannings ou créez un compte ci-dessous pour plus de sécurité.
						</p>
						<p class="text-xxs mt-1 px-2 opacity-70">
							Désactivé: Votre navigateur oubliera vos plannings après sa fermeture. Recommandé sur
							les appareils partagés ou publics.
						</p>
					</div>
				</div>
			{/if}

			<div class="modal-action mt-8">
				<button
					type="submit"
					class="btn btn-primary btn-block gap-2"
					disabled={isSubmitting || !name.trim()}
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
						Traitement...
					{:else}
						Continuer comme {name || '...'}
						<ArrowRight size={18} />
					{/if}
				</button>
			</div>
		</form>

		<!-- Inscription depuis le IdentifyModal -->
		{#if !userStore.isLoggedIn && !isTauri && (mode === 'homepage' || mode === 'edit-global')}
			<div class="divider mt-8 text-sm font-medium tracking-widest uppercase opacity-50">
				.. ou Créez un compte !
			</div>
			<div class="flex w-full flex-col gap-1 leading-tight">
				<div class="flex items-center gap-2 text-sm opacity-70">
					<InfoIcon size={20} class="inline shrink-0" />
					Créez un compte pour recevoir des notifications par email (et push sur mobile).
				</div>
			</div>
			<div class="bg-base-200/50 border-base-300 rounded-xl border p-4">
				<AuthForm
					mode="register"
					name={name.trim()}
					showNameInput={false}
					compact
					onSuccess={() => {
						if (name.trim()) handleManualIdentify();
						else onClose();
					}}
				/>
			</div>
		{/if}

		<!-- Effacer le profil (mode edit-global uniquement) -->
		{#if mode === 'edit-global' && userStore.globalProfile}
			<div class="text-center">
				<button
					type="button"
					class="btn-link btn btn-sm text-error h-auto min-h-0 p-0"
					onclick={() => (showConfirmClear = true)}
				>
					Effacer mon profil
				</button>
			</div>
		{/if}
	</div>
</Modal>

<ConfirmModal
	bind:open={showConfirmClear}
	onClose={() => (showConfirmClear = false)}
	onConfirm={handleClearProfile}
	title="Effacer le profil ?"
	message="Voulez-vous vraiment effacer votre profil sur cet appareil ?"
	description="Cela supprimera votre nom par défaut et la liste de vos plannings enregistrés localement. Vos participations sur les plannings eux-mêmes ne seront pas supprimées."
	confirmLabel="Effacer tout"
	variant="danger"
/>
