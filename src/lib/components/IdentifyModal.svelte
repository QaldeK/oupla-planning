<script lang="ts">
	import type { Participant, PlanningIdentity, SavedPlanning } from '$lib/types/planning.types';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { isTauri, storage } from '$lib/utils/storage';
	import Modal from './ui/Modal.svelte';
	import ConfirmModal from './ui/ConfirmModal.svelte';
	import AuthForm from './auth/AuthForm.svelte';
	import { pb } from '$lib/pocketbase/pb';
	import {
		CircleAlert,
		CircleHelp,
		User,
		ArrowRight,
		CircleCheck,
		Trash2,
		ShieldCheck,
		ArrowLeft,
		InfoIcon
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { fade, slide } from 'svelte/transition';

	const PLANNINGS_KEY = 'planning_saved';

	interface Props {
		open: boolean;
		onClose: () => void;
		mode: 'homepage' | 'planning' | 'conflict' | 'edit-global';
		existingParticipants?: Participant[];
		onGlobalProfileCreate?: (name: string, email?: string, persist?: boolean) => void;
		onGlobalProfileUpdate?: (name: string, email?: string, persist?: boolean) => void;
		onPlanningIdentify?: (identity: PlanningIdentity, isNewParticipant: boolean) => Promise<void>;
	}

	let {
		open = $bindable(false),
		onClose,
		mode,
		existingParticipants = [],
		onGlobalProfileCreate,
		onGlobalProfileUpdate,
		onPlanningIdentify
	}: Props = $props();

	let name = $state('');
	let email = $state('');
	// État global lié au profil (plus de state local rememberMe)
	let globalPersist = $state(userStore.globalProfile?.persist ?? true);
	let isSubmitting = $state(false);
	let showConfirmClear = $state(false);
	let showConfirmClearAll = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);

	let requireLoginFor = $state<Participant | null>(null);
	let inlineAuthMode = $state<'register' | 'login'>('register');
	let networkError = $state(false);
	let retryingParticipant = $state<Participant | null>(null);

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

		// Fusionner (plus besoin de setter persist, c'est déduit de globalProfile)
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

		// Fusionner (plus besoin de setter persist)
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
			requireLoginFor = null;
			networkError = false;
			retryingParticipant = null;
			const planningId = userStore.authModal.masterId;
			const specificIdentity = planningId ? userStore.getPlanningIdentity(planningId) : null;

			if (specificIdentity) {
				name = specificIdentity.name;
				email = specificIdentity.email || '';
			} else if (userStore.globalProfile) {
				name = userStore.globalProfile.defaultName;
				email = userStore.globalProfile.defaultEmail || '';
			} else {
				name = '';
				email = '';
			}
		}
	});

	// Détection de participant existant par le nom
	let matchedParticipant = $derived(
		name.trim() && (mode === 'planning' || mode === 'conflict')
			? existingParticipants.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
			: null
	);

	// Conflit concret : le nom est pris par un ID différent du nôtre
	let hasConflict = $derived(
		!!matchedParticipant && matchedParticipant.id !== userStore.globalProfile?.id
	);

	async function identifyAs(participant: Participant) {
		const identity: PlanningIdentity = {
			id: participant.id,
			name: participant.name,
			email: participant.email
		};

		isSubmitting = true;
		try {
			// Synchroniser l'ID global si on a un profil
			if (userStore.globalProfile && userStore.globalProfile.id !== participant.id) {
				await userStore.updateGlobalProfile({
					id: participant.id,
					defaultName: participant.name,
					defaultEmail: participant.email
				});
			}

			await onPlanningIdentify?.(identity, false);
			onClose();
		} catch (error) {
			toast.error("Erreur lors de l'identification");
		} finally {
			isSubmitting = false;
		}
	}

	async function attemptIdentifyAs(participant: Participant, retryCount = 0) {
		const RETRY_DELAYS = [300, 600, 1000];
		const MAX_RETRIES = RETRY_DELAYS.length;

		isSubmitting = true;
		networkError = false;
		retryingParticipant = participant;

		try {
			const res = await pb.send(`/api/has-account/${participant.id}`, {});
			if (res.hasAccount) {
				// Le participant a un compte -> exiger la connexion
				requireLoginFor = participant;
				isSubmitting = false;
				retryingParticipant = null;
			} else {
				// Pas de compte -> identification directe
				await identifyAs(participant);
			}
		} catch (err) {
			if (retryCount < MAX_RETRIES) {
				// Retry automatique avec délai progressif
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[retryCount]));
				return attemptIdentifyAs(participant, retryCount + 1);
			} else {
				// Échec après tous les retries -> afficher erreur
				networkError = true;
				isSubmitting = false;
			}
		}
	}

	async function handleManualIdentify() {
		if ((!name.trim() || hasConflict) && !requireLoginFor) return;

		// Cas Homepage / Edit Global
		if (mode === 'homepage') {
			onGlobalProfileCreate?.(name.trim(), email.trim() || undefined, globalPersist);
			onClose();
			return;
		}

		if (mode === 'edit-global') {
			onGlobalProfileUpdate?.(name.trim(), email.trim() || undefined, globalPersist);
			onClose();
			return;
		}

		// Cas Planning : Vérifier si on est déjà identifié pour mettre à jour
		const currentIdentity = userStore.getPlanningIdentity(userStore.authModal.masterId || '');

		isSubmitting = true;
		try {
			// Si déjà identifié sur ce planning, c'est une mise à jour
			const isUpdate = !!currentIdentity;
			const globalId = currentIdentity?.id || userStore.globalProfile?.id || crypto.randomUUID();

			// Ensure global profile exists with the entered name if created now
			if (!userStore.globalProfile) {
				await userStore.createGlobalProfile(
					name.trim(),
					email.trim() || undefined,
					globalPersist,
					globalId
				);
			} else {
				// Mettre à jour le nom par défaut du profil global si c'est la première fois qu'on le fixe
				if (userStore.globalProfile.defaultName !== name.trim()) {
					await userStore.updateGlobalProfile({ defaultName: name.trim() });
				}
			}

			const identity: PlanningIdentity = {
				id: globalId,
				name: name.trim(),
				email: email.trim() || undefined
			};

			await onPlanningIdentify?.(identity, !isUpdate);
			if (isUpdate) toast.success('Profil mis à jour');
			onClose();
		} catch (error) {
			toast.error("Erreur lors de l'identification");
		} finally {
			isSubmitting = false;
		}
	}

	async function handleClearProfile() {
		await userStore.clearUser();
		showConfirmClear = false;
		toast.info('Profil effacé de cet appareil');
		onClose();
	}

	async function handleClearAllData() {
		await userStore.clearAllLocalData();
		showConfirmClearAll = false;
		toast.success('Toutes les données ont été effacées');
		onClose();
	}
</script>

<Modal
	{open}
	{onClose}
	title={requireLoginFor
		? 'Connexion requise'
		: mode === 'edit-global'
			? 'Mon Profil'
			: 'Identification'}
	size="md"
>
	<div class="space-y-6">
		{#if requireLoginFor}
			<div class="animate-in fade-in slide-in-from-right-4 space-y-5 duration-300">
				<div class="alert alert-warning alert-soft text-sm">
					<ShieldCheck size={20} class="text-warning shrink-0" />
					<div class="leading-tight">
						L'identité de <strong>{requireLoginFor.name}</strong> est protégée par un compte.
					</div>
				</div>
				<AuthForm mode="login" showNameInput={false} onSuccess={() => onClose()} />
				<div class="text-center">
					<button
						type="button"
						class="btn btn-ghost sm:btn-sm text-base-content/60"
						onclick={() => {
							requireLoginFor = null;
							name = '';
							setTimeout(() => inputRef?.focus(), 50);
						}}
					>
						<ArrowLeft size={16} /> Retour
					</button>
				</div>
			</div>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleManualIdentify();
				}}
				class="space-y-5"
			>
				<fieldset>
					<label class="input w-full" class:input-error={hasConflict}>
						<span class="label">
							<User size={18} class="opacity-40" />
							Nom *
						</span>
						<input
							bind:this={inputRef}
							id="name"
							type="text"
							bind:value={name}
							class="grow"
							placeholder="Votre nom ou pseudo"
							required
							disabled={isSubmitting}
						/>
					</label>
					<div class="fieldset-label p-1 text-xs">
						C'est le nom qui apparaîtra pour les autres participants. {#if mode === 'edit-global'}
							Il sera utilisé par défaut dans les plannings que vous rejoindrez.
						{:else if mode === 'planning'}
							Ce nom sera spécifique à ce planning.
						{/if}
					</div>
				</fieldset>

				{#if hasConflict && matchedParticipant}
					<div
						class="alert alert-warning alert-soft alert-vertical text-base-content animate-in fade-in slide-in-from-top-2 mt-4 duration-300"
						transition:slide
					>
						<div class="text-warning-content text-sm">
							<CircleAlert size={20} class="me-2 inline shrink-0" />
							Ce nom est déjà utilisé par un·e participant·e sur ce planning.
						</div>

						<div class="flex flex-col gap-2">
							<button
								type="button"
								class="btn sm:btn-sm btn-warning"
								onclick={() => attemptIdentifyAs(matchedParticipant!)}
								disabled={isSubmitting}
							>
								{#if isSubmitting}
									<span class="loading loading-spinner loading-xs"></span>
								{:else}
									C'est moi !
								{/if}
							</button>
						</div>
						<p class="px-2 text-center text-[10px] leading-tight opacity-50">
							Choisissez "C'est moi !" si vous avez déjà participé à ce planning sur un autre
							appareil ou si vous avez effacé vos données. <strong
								>Sinon, choississez un autre nom</strong
							>
						</p>
					</div>
				{:else if !hasConflict && matchedParticipant}
					<!-- Cas où le nom match l'ID global (déjà reconnu mais modal ouvert par erreur ou switch manuel) -->
					<div class="alert alert-success alert-soft alert-vertical" transition:slide>
						<div class="text-sm font-medium">
							<CircleCheck size={20} class="inline shrink-0" />
							Votre profil et vos plannings sont enregistrés sur cet appareil
						</div>
						<button
							type="button"
							class="btn btn-warning btn-wide sm:btn-sm h-auto"
							onclick={() => (showConfirmClear = true)}
						>
							<Trash2 size={16} class="shrink-0" />
							Effacer mon profil sur cet appareil
						</button>
					</div>
				{/if}

				<!-- Liste rapide simplifiée -->
				{#if existingParticipants.length > 0 && mode === 'planning'}
					<div class="card card-xs bg-accent/20">
						<div class="card-body">
							<span class="text-accent-content/70 flex items-center gap-1 text-sm italic"
								><InfoIcon class="inline size-4 shrink-0 opacity-80" /> Vous avez déjà participé à ce
								planning ? Indiquez qui vous êtes :
							</span>
							<div class="flex max-h-40 flex-wrap gap-2 overflow-y-auto p-1">
								{#each existingParticipants as p (p.id)}
									<button
										type="button"
										class="btn btn-accent btn-xs"
										onclick={() => attemptIdentifyAs(p)}
										disabled={isSubmitting}
									>
										{p.name}
									</button>
								{/each}
							</div>
						</div>
					</div>
				{/if}

				<!-- Erreur réseau -->
				{#if networkError && retryingParticipant}
					<div class="alert alert-error alert-soft alert-vertical" transition:slide>
						<div class="text-sm">
							<CircleAlert size={20} class="me-2 inline shrink-0" />
							Impossible de vérifier l'identité. Vérifiez votre connexion.
						</div>
						<button
							type="button"
							class="btn btn-error btn-sm"
							onclick={() => attemptIdentifyAs(retryingParticipant!)}
						>
							Réessayer
						</button>
					</div>
				{/if}

				{#if (!isTauri || !userStore.isLoggedIn) && (mode === 'planning' || mode === 'homepage')}
					<!-- Toggle "Mémoriser sur cet appareil" -->
					<div class=" card card-xs {globalPersist ? 'bg-success/10' : 'bg-warning/10'}">
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
								⚠️ Ne fonctionne pas en navigation privée. Peut être perdu lors du nettoyage du
								cache. Gardez les URLs des plannings ou créez un compte ci-dessous pour plus de
								sécurité.
							</p>
							<p class="text-xxs mt-1 px-2 opacity-70">
								Désactivé: Votre navigateur oubliera vos plannings après sa fermeture. Recommandé
								sur les appareils partagés ou publics.
							</p>
						</div>
					</div>
				{/if}

				<div class="modal-action mt-8">
					<button
						type="submit"
						class="btn btn-primary btn-block gap-2"
						disabled={isSubmitting || !name.trim() || hasConflict}
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
			{#if !pb.authStore.isValid && !isTauri && !hasConflict && (mode === 'planning' || mode === 'homepage' || mode === 'edit-global')}
				<div class="divider mt-8 text-sm font-medium tracking-widest uppercase opacity-50">
					.. ou Créez un compte !
				</div>
				<div class="flex w-full flex-col gap-1 leading-tight">
					<div class=" flex items-center gap-2 text-sm opacity-70">
						<InfoIcon size={20} class="inline shrink-0 " />
						Créez un compte pour recevoir des notifications par email (et push sur mobile).
					</div>
					<div class="mt-1 flex justify-center">
						<button
							type="button"
							class="btn btn-link btn-sm text-info h-auto min-h-0 p-0 font-bold no-underline hover:underline"
							onclick={() =>
								(inlineAuthMode = inlineAuthMode === 'register' ? 'login' : 'register')}
						>
							{inlineAuthMode === 'register'
								? "J'ai déjà un compte - se connecter"
								: "Je n'ai pas de compte - s'inscrire"}
						</button>
					</div>
				</div>
				<div class="bg-base-200/50 border-base-300 rounded-xl border p-4">
					<AuthForm
						mode={inlineAuthMode}
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

<ConfirmModal
	bind:open={showConfirmClearAll}
	onClose={() => (showConfirmClearAll = false)}
	onConfirm={handleClearAllData}
	title="Effacer TOUTES les données ?"
	message="Voulez-vous vraiment effacer toutes les données de cet appareil ?"
	description="Cela supprimera votre profil, vos plannings sauvegardés, vos préférences de vue et toutes les données locales. Cette action est irréversible."
	confirmLabel="Tout effacer"
	variant="danger"
/>
