<script lang="ts">
	import { ArrowLeftFromLine, ArrowRight, InfoIcon, Lock, User } from "@lucide/svelte";
	import { fade } from "svelte/transition";
	import { toast } from "svelte-sonner";
	import * as m from "$lib/paraglide/messages.js";
	import { userStore } from "$lib/stores/userStore.svelte";
	import type { Participant, PlanningIdentity } from "$lib/types/planning.types";
	import { hasNameConflict } from "$lib/utils/participantConflict";
	import AuthForm from "./auth/AuthForm.svelte";
	import NameConflictHandler from "./NameConflictHandler.svelte";
	import Modal from "./ui/Modal.svelte";

	interface Props {
		open: boolean;
		onClose: () => void;
		masterId?: string;
		existingParticipants?: Participant[];
		onPlanningIdentify?: (identity: PlanningIdentity, isNewParticipant: boolean) => Promise<void>;
		initialName?: string; // Nom prérempli pour les users auth
		hideExistingParticipants?: boolean; // Cacher la liste des participants existants pour les users auth
		currentIdentity?: PlanningIdentity | null; // Identité actuelle de l'utilisateur pour ce planning
	}

	let {
		open = $bindable(false),
		onClose,
		masterId,
		existingParticipants = [],
		onPlanningIdentify,
		initialName,
		hideExistingParticipants = false,
		currentIdentity = null,
	}: Props = $props();

	let name = $state("");
	let email = $state("");
	let isSubmitting = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);
	let authMode = $state<"login" | "register">("register");
	let showAccountForm = $state(false);

	// Mode switch : l'utilisateur a déjà une identité sur ce planning. Le modal ne
	// propose plus de saisie immédiate (source de confusion rename/switch) : il met
	// en avant l'identité active, liste les participants reprenables et déplie la
	// création d'un nouveau participant. Le rename vit dans RenameParticipantModal.
	// Garde auth : le flux des users connectés passe par IdentityClaimModal — la
	// branche switch reste guest même si un futur appelant passe une currentIdentity.
	let isSwitch = $derived(!!currentIdentity && !userStore.isLoggedIn);
	let newParticipantName = $state("");
	let showCreateForm = $state(false);

	let switchableParticipants = $derived(
		existingParticipants.filter((p) => p.id !== currentIdentity?.id),
	);

	// Conflit pour la création : nom déjà porté par un autre participant actif.
	let createConflict = $derived(
		hasNameConflict(existingParticipants, newParticipantName, currentIdentity?.id ?? ""),
	);

	// Nom par défaut pour la création de compte (le compte reprend le nom de
	// l'identité active en mode switch, la saisie en primo-identification).
	let accountDefaultName = $derived(currentIdentity?.name?.trim() || name.trim());

	// État pour la revendication d'identité protégée
	let claimedIdentity = $state<Participant | null>(null);

	// Conflit de nom (primo-identification) : on ne peut pas créer de participant
	// avec un nom déjà pris sur ce planning. L'utilisateur doit soit revendiquer
	// l'identité existante (bouton "C'est moi" du NameConflictHandler), soit
	// choisir un autre nom. On exclut l'identité courante pour autoriser l'édition
	// sans faux positif.
	let hasConflict = $derived(
		hasNameConflict(existingParticipants, name, currentIdentity?.id ?? ""),
	);

	function resetForm() {
		name = "";
		email = "";
		claimedIdentity = null;
		authMode = "register";
		showAccountForm = false;
		newParticipantName = "";
		showCreateForm = false;
	}

	function closeModal() {
		resetForm();
		onClose();
	}

	// Focus auto à l'ouverture et préremplissage du nom (primo-identification
	// uniquement : en mode switch il n'y a plus de saisie immédiate).
	$effect(() => {
		if (open && !claimedIdentity && !isSwitch) {
			// Préremplir le nom si fourni (pour les users auth)
			if (initialName) {
				name = initialName;
			}
			// Focus sur l'input
			if (inputRef) {
				setTimeout(() => inputRef?.focus(), 50);
			}
		}
	});

	// === Gestion des callbacks de NameConflictHandler ===

	// Appelé quand on clique "C'est moi !" sur un participant sans compte
	async function handleIdentifyAs(participant: Participant) {
		isSubmitting = true;
		try {
			// Stocker l'association dans le planning (si masterId disponible)
			if (masterId && onPlanningIdentify) {
				await onPlanningIdentify(
					{
						id: participant.id, // L'ID du participant dans CE planning
						name: participant.name,
						email: participant.email,
					},
					false, // pas nouveau participant
				);
			}

			toast.success(m.identify_welcome({ name: participant.name }));
			closeModal();
		} catch (error) {
			console.error("Error identifying as participant:", error);
			toast.error(m.identify_error());
		} finally {
			isSubmitting = false;
		}
	}

	// Appelé quand le participant a un compte protégé - géré en interne
	function handleRequireLogin(participant: Participant) {
		claimedIdentity = participant;
		authMode = "login";
		// Le focus sera géré par AuthForm via focusEmail
	}

	// Mode switch : reprendre un participant existant (redirige vers le login
	// s'il est lié à un compte, comme en primo-identification).
	async function attemptSwitch(participant: Participant) {
		if (participant.userId) {
			handleRequireLogin(participant);
			return;
		}
		await handleIdentifyAs(participant);
	}

	// Mode switch : créer un nouveau participant vierge et basculer dessus.
	// L'ancien participant reste dans la liste avec ses réponses.
	async function handleCreateNew() {
		const trimmed = newParticipantName.trim();
		if (!trimmed || isSubmitting || createConflict) return;

		if (!masterId || !onPlanningIdentify) {
			console.warn("IdentifyModal: handleCreateNew called without masterId or onPlanningIdentify");
			return;
		}

		isSubmitting = true;
		try {
			await onPlanningIdentify({ id: crypto.randomUUID(), name: trimmed }, true);
			closeModal();
		} catch (error) {
			console.error("Error creating participant:", error);
			toast.error(m.identify_error());
		} finally {
			isSubmitting = false;
		}
	}

	async function handleSubmit() {
		if (!name.trim() || isSubmitting || hasConflict) return;

		// Cas avec masterId : identification sur un planning
		if (masterId && onPlanningIdentify) {
			// Déterminer si c'est un nouveau participant ou un changement de nom
			const hasExistingIdentity = !!currentIdentity;
			const isNewParticipant = !hasExistingIdentity;

			const newIdentity: PlanningIdentity = {
				// Garder l'ID existant si l'utilisateur a déjà une identité, sinon en générer un nouveau
				id: currentIdentity?.id || crypto.randomUUID(),
				name: name.trim(),
				email: email.trim() || undefined,
			};

			await onPlanningIdentify(newIdentity, isNewParticipant);
			closeModal();
			return;
		}

		// Sans masterId : ne rien faire (ne devrait pas arriver)
		console.warn("IdentifyModal: handleSubmit called without masterId or onPlanningIdentify");
	}

	// Callback après connexion réussie
	function handleAuthSuccess() {
		// L'identification sur le planning sera gérée par la page parente
		// via la réactivité de userStore.isLoggedIn
		closeModal();
	}
</script>

<Modal
	{open}
	onClose={closeModal}
	title={isSwitch && !claimedIdentity ? m.switch_title() : m.identify_title()}
	size="md"
	closable={!claimedIdentity}
>
	<div class="space-y-6">
		{#snippet linkAccount()}
			{#if !userStore.isLoggedIn}
				<div class="divider mt-8 text-sm font-medium tracking-widest uppercase opacity-50">
					{m.identify_or_link_account()}
				</div>
				<div class="flex w-full flex-col gap-2 leading-tight">
					<div class="flex items-center gap-2 text-sm opacity-70">
						<InfoIcon size={20} class="inline shrink-0" />
						{m.identify_link_account_desc()}
					</div>

					<div class="my-4 flex flex-wrap justify-evenly gap-2">
						<button
							class="btn {authMode === 'login' ? 'btn-primary' : 'btn-soft btn-primary'}"
							onclick={() => {
								authMode = "login";
								showAccountForm = true;
							}}
						>
							{m.identify_switch_to_login()}
						</button>
						<button
							class="btn {authMode === 'register' ? 'btn-primary' : 'btn-soft btn-primary'}"
							onclick={() => {
								authMode = "register";
								showAccountForm = true;
							}}
						>
							{m.identify_create_account()}
						</button>
					</div>

					{#if showAccountForm}
						<div class="bg-base-200/50 border-base-300 rounded-xl border p-4">
							<AuthForm
								mode={authMode}
								name={accountDefaultName}
								showNameInput={false}
								compact
								onSuccess={handleAuthSuccess}
							/>
						</div>
					{/if}
				</div>
			{/if}
		{/snippet}

		<!-- Alerte pour identité protégée -->
		{#if claimedIdentity}
			<div
				class="alert alert-info alert-soft animate-in fade-in slide-in-from-top-2 duration-300"
				in:fade
			>
				<Lock size={20} class="shrink-0" />
				<div class="flex-1">
					<p class="text-sm font-medium">
						{m.identify_account_protected({ name: claimedIdentity.name })}
					</p>
					<p class="text-xs opacity-80">{m.identify_login_prompt()}</p>
				</div>
			</div>
			<button
				type="button"
				class="btn btn-soft btn-block"
				onclick={() => {
					claimedIdentity = null;
					authMode = "register";
				}}
			>
				<ArrowLeftFromLine size={20} class="shrink-0" />
				{m.identify_choose_other()}
			</button>
			<!-- Formulaire de connexion directement visible -->
			<div class="bg-base-200/50 border-base-300 rounded-xl border p-4">
				<h4 class="mb-4 text-sm font-medium">{m.identify_login_required()}</h4>
				<AuthForm
					mode="login"
					name={claimedIdentity.name}
					initialEmail={claimedIdentity.email || ""}
					focusEmail={true}
					showNameInput={false}
					compact
					onSuccess={handleAuthSuccess}
				/>
			</div>
		{:else if isSwitch}
			<!-- Mode switch : reprendre un participant existant ou en créer un nouveau.
			     Le rename vit dans RenameParticipantModal (bouton crayon). -->
			<div class="space-y-5" in:fade>
				<!-- En-tête rédigé : état courant + options possibles (liste auto-adaptée) -->
				<div class="space-y-2 text-sm">
					<p>{m.switch_intro({ name: currentIdentity?.name ?? "" })}</p>
					<ul class="list-disc space-y-1 ps-5">
						{#if switchableParticipants.length > 0}
							<li>{m.switch_option_existing()}</li>
						{/if}
						<li>{m.switch_option_new()}</li>
						<li>{m.switch_option_account()}</li>
					</ul>
					<p class="opacity-70">{m.switch_closing()}</p>
				</div>

				<!-- Participants reprenables -->
				{#if switchableParticipants.length > 0}
					<div class="card card-xs bg-accent/20">
						<div class="card-body">
							<span class="text-accent-content/70 flex items-center gap-1 text-sm italic">
								<InfoIcon class="inline size-4 shrink-0 opacity-80" />
								{m.nameconflict_already_participated()}
							</span>
							<div class="flex max-h-40 flex-wrap gap-2 overflow-y-auto p-1">
								{#each switchableParticipants as p (p.id)}
									<button
										type="button"
										class="btn btn-accent btn-sm"
										onclick={() => attemptSwitch(p)}
										disabled={isSubmitting}
									>
										{p.name}
									</button>
								{/each}
							</div>
						</div>
					</div>
				{:else}
					<p class="text-sm opacity-60">{m.switch_no_other()}</p>
				{/if}

				<!-- Création d'un nouveau participant -->
				<div class="border-base-300 rounded-xl border p-3">
					<p class="mb-3 text-sm opacity-80">{m.switch_new_desc()}</p>
					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleCreateNew();
						}}
						class="space-y-3"
					>
						<fieldset>
							<label class="input w-full" class:border-error={createConflict}>
								<span class="label">
									<User size={18} class="opacity-40" />
									{m.identify_name_label()}
								</span>
								<input
									type="text"
									bind:value={newParticipantName}
									class="grow"
									placeholder={m.identify_name_placeholder()}
									required
									disabled={isSubmitting}
									maxlength="36"
								/>
							</label>
							{#if createConflict}
								<div class="alert alert-warning alert-soft mt-2 p-2 text-sm">
									{m.rename_name_taken()}
								</div>
							{/if}
						</fieldset>
						<button
							type="submit"
							class="btn btn-primary btn-block gap-2"
							disabled={isSubmitting || !newParticipantName.trim() || createConflict}
						>
							{#if isSubmitting}
								<span class="loading loading-spinner loading-xs"></span>
								{m.identify_processing()}
							{:else}
								{m.switch_create_as({ name: newParticipantName.trim() || "..." })}
								<ArrowRight size={18} />
							{/if}
						</button>
					</form>
				</div>
			</div>

			<!-- Inscription depuis le IdentifyModal -->
			{@render linkAccount()}
		{:else}
			<!-- Formulaire normal -->
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-5"
				in:fade
			>
				<fieldset>
					<label class="input w-full">
						<span class="label">
							<User size={18} class="opacity-40" />
							{m.identify_name_label()}
						</span>
						<input
							bind:this={inputRef}
							type="text"
							bind:value={name}
							class="grow"
							placeholder={m.identify_name_placeholder()}
							required
							disabled={isSubmitting}
							maxlength="36"
						/>
					</label>
					<div class="fieldset-label p-1 text-xs">
						{m.identify_name_hint()}
					</div>
				</fieldset>

				<!-- Détection de conflit via NameConflictHandler -->
				{#if existingParticipants.length > 0}
					<NameConflictHandler
						{name}
						{existingParticipants}
						currentIdentityId={currentIdentity?.id}
						{hideExistingParticipants}
						onIdentifyAs={handleIdentifyAs}
						onRequireLogin={handleRequireLogin}
					/>
				{/if}

				<div class="modal-action mt-8">
					<button
						type="submit"
						class="btn btn-primary btn-block gap-2"
						disabled={isSubmitting || !name.trim() || hasConflict}
					>
						{#if isSubmitting}
							<span class="loading loading-spinner loading-xs"></span>
							{m.identify_processing()}
						{:else}
							{m.identify_continue_as({ name: name || "..." })}
							<ArrowRight size={18} />
						{/if}
					</button>
				</div>
			</form>

			<!-- Inscription depuis le IdentifyModal -->
			{@render linkAccount()}
		{/if}
	</div>
</Modal>
