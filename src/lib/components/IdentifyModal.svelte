<script lang="ts">
import { ArrowLeftFromLine, ArrowRight, InfoIcon, Lock, User } from "@lucide/svelte";
import { fade } from "svelte/transition";
import { toast } from "svelte-sonner";
import * as m from "$lib/paraglide/messages.js";
import { userStore } from "$lib/stores/userStore.svelte";
import type { Participant, PlanningIdentity } from "$lib/types/planning.types";
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
	currentIdentity = null
}: Props = $props();

let name = $state("");
let email = $state("");
let isSubmitting = $state(false);
let inputRef = $state<HTMLInputElement | null>(null);
let authMode = $state<"login" | "register">("register");
let showAccountForm = $state(false);

// État pour la revendication d'identité protégée
let claimedIdentity = $state<Participant | null>(null);

// Conflit de nom : on ne peut pas créer de participant avec un nom déjà pris
// sur ce planning. L'utilisateur doit soit revendiquer l'identité existante
// (bouton "C'est moi" du NameConflictHandler), soit choisir un autre nom.
// On exclut l'identité courante pour autoriser l'édition sans faux positif.
let hasNameConflict = $derived.by(() => {
	const trimmed = name.trim().toLowerCase();
	if (!trimmed) return false;
	return existingParticipants.some(
		(p) => p.name.toLowerCase() === trimmed && p.id !== currentIdentity?.id
	);
});

function resetForm() {
	name = "";
	email = "";
	claimedIdentity = null;
	authMode = "register";
	showAccountForm = false;
}

function closeModal() {
	resetForm();
	onClose();
}

// Focus auto à l'ouverture et préremplissage du nom
$effect(() => {
	if (open && !claimedIdentity) {
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
					email: participant.email
				},
				false // pas nouveau participant
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

async function handleSubmit() {
	if (!name.trim() || isSubmitting || hasNameConflict) return;

	// Cas avec masterId : identification sur un planning
	if (masterId && onPlanningIdentify) {
		// Déterminer si c'est un nouveau participant ou un changement de nom
		const hasExistingIdentity = !!currentIdentity;
		const isNewParticipant = !hasExistingIdentity;

		const newIdentity: PlanningIdentity = {
			// Garder l'ID existant si l'utilisateur a déjà une identité, sinon en générer un nouveau
			id: currentIdentity?.id || crypto.randomUUID(),
			name: name.trim(),
			email: email.trim() || undefined
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

<Modal {open} onClose={closeModal} title={m.identify_title()} size="md" closable={!claimedIdentity}>
	<div class="space-y-6">
		<!-- Alerte pour identité protégée -->
		{#if claimedIdentity}
			<div
				class="alert alert-info alert-soft animate-in fade-in slide-in-from-top-2 duration-300"
				in:fade
			>
				<Lock size={20} class="shrink-0" />
				<div class="flex-1">
					<p class="text-sm font-medium">
						{m.identify_account_protected({name: claimedIdentity.name})}
					</p>
					<p class="text-xs opacity-80">{m.identify_login_prompt()}</p>
				</div>
			</div>
			<button
				type="button"
				class="btn btn-soft btn-sm btn-block"
				onclick={() => {
					claimedIdentity = null;
					authMode = 'register';
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
					initialEmail={claimedIdentity.email || ''}
					focusEmail={true}
					showNameInput={false}
					compact
					onSuccess={handleAuthSuccess}
				/>
			</div>
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
						disabled={isSubmitting || !name.trim() || hasNameConflict}
					>
						{#if isSubmitting}
							<span class="loading loading-spinner loading-xs"></span>
							{m.identify_processing()}
						{:else}
							{m.identify_continue_as({name: name || '...'})}
							<ArrowRight size={18} />
						{/if}
					</button>
				</div>
			</form>

			<!-- Inscription depuis le IdentifyModal -->
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
								authMode = 'login';
								showAccountForm = true;
							}}
						>
							{m.identify_switch_to_login()}
						</button>
						<button
							class="btn {authMode === 'register' ? 'btn-primary' : 'btn-soft btn-primary'}"
							onclick={() => {
								authMode = 'register';
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
								name={name.trim()}
								showNameInput={false}
								compact
								onSuccess={handleAuthSuccess}
							/>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</Modal>
