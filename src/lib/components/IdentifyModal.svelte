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
		ArrowLeft
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

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
	let inputRef = $state<HTMLInputElement | null>(null);

	let requireLoginFor = $state<Participant | null>(null);
	let inlineAuthMode = $state<'register' | 'login'>('register');

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

	async function attemptIdentifyAs(participant: Participant) {
		// Vérification compte PB existant
		isSubmitting = true;
		try {
			await pb.collection('users').getOne(participant.id, { requestKey: null });
			// Le compte existe -> exiger la connexion
			requireLoginFor = participant;
			isSubmitting = false;
		} catch (err) {
			// Pas de compte -> on passe direct
			await identifyAs(participant);
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
				<AuthForm
					mode="login"
					showNameInput={false}
					onSuccess={() => identifyAs(requireLoginFor!)}
				/>
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
					>
						<CircleAlert size={20} class="text-warning shrink-0" />
						<div class="text-sm">
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
					<div class="alert alert-success alert-soft max-sm:alert-vertical">
						<CircleCheck size={20} class="shrink-0" />
						<div class="text-sm font-medium">Votre profil est enregistré sur cet appareil</div>
						<button
							type="button"
							class="btn btn-warning btn-block sm:btn-sm h-auto gap-2"
							onclick={() => (showConfirmClear = true)}
						>
							<Trash2 size={16} class="shrink-0" />
							Effacer mon profil sur cet appareil
						</button>
					</div>
				{/if}

				{#if !isTauri && !matchedParticipant && !userStore.isLoggedIn && (mode === 'planning' || mode === 'homepage')}
					<!-- Toggle "Mémoriser sur cet appareil" -->
					<div class="space-y-2">
						<label class="label cursor-pointer justify-start gap-3">
							<span class="label-text font-medium">Mémoriser sur cet appareil</span>
							<input
								type="checkbox"
								class="toggle toggle-primary"
								bind:checked={globalPersist}
								disabled={isSubmitting}
							/>
						</label>

						{#if globalPersist}
							<div class="text-xs opacity-75">
								<div class="alert alert-info alert-sm py-2">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										class="h-4 w-4 shrink-0 stroke-current"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										></path></svg
									>
									<span>Vos plannings seront sauvegardés sur cet appareil.</span>
								</div>
								<p class="mt-1 px-2 text-[10px] opacity-70">
									⚠️ Ne fonctionne pas en navigation privée. Peut être perdu lors du nettoyage du
									cache. Gardez les URLs des plannings ou créez un compte ci-dessous pour plus de
									sécurité.
								</p>
							</div>
						{:else}
							<div class="text-xs opacity-75">
								<div class="alert alert-warning alert-sm py-2">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										class="h-4 w-4 shrink-0 stroke-current"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
										></path></svg
									>
									<span>Votre navigateur oubliera vos plannings après sa fermeture.</span>
								</div>
								<p class="mt-1 px-2 text-[10px] opacity-70">
									💡 Recommandé sur les appareils partagés ou publics.
								</p>
							</div>
						{/if}
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
				<div class="divider mt-8 text-[10px] tracking-widest uppercase opacity-50">
					Oupla Notifications
				</div>
				<div class="alert alert-info alert-soft mb-4 flex gap-3 p-3 text-sm">
					<CircleHelp size={20} class="text-info shrink-0" />
					<div class="flex w-full flex-col gap-1 leading-tight">
						<div>
							Créez un compte pour recevoir des notifications par email (et push sur mobile).
							<span class="mt-1 block text-xs opacity-75"
								>Ce compte protégera aussi votre identité.</span
							>
						</div>
						<div class="mt-1 flex justify-end">
							<button
								type="button"
								class="btn btn-link btn-xs text-info h-auto min-h-0 p-0 font-bold no-underline hover:underline"
								onclick={() =>
									(inlineAuthMode = inlineAuthMode === 'register' ? 'login' : 'register')}
							>
								{inlineAuthMode === 'register'
									? "J'ai déjà un compte - se connecter"
									: "Je n'ai pas de compte - s'inscrire"}
							</button>
						</div>
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

			<!-- Liste rapide simplifiée -->
			{#if !name.trim() && existingParticipants.length > 0 && mode === 'planning'}
				<div class="divider text-[10px] tracking-widest uppercase opacity-50">
					Déjà participant·es ?
				</div>
				<div class="alert alert-soft alert-info text-base-content/80 text-sm italic">
					<span>Vous avez déjà participé à ce planning ? Indiquez qui vous êtes : </span>
				</div>
				<div class="flex max-h-40 flex-wrap gap-2 overflow-y-auto p-1">
					{#each existingParticipants as p (p.id)}
						<button
							type="button"
							class="btn btn-accent sm:btn-sm"
							onclick={() => attemptIdentifyAs(p)}
							disabled={isSubmitting}
						>
							{p.name}
						</button>
					{/each}
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
