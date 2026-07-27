<script lang="ts">
import {
	Bell,
	Calendar,
	CalendarX,
	History,
	ListFilter,
	Lock,
	LogOut,
	MapPin,
	Settings,
	Share2,
	User,
	UserCheck,
	UserCog,
	Users
} from "@lucide/svelte";
import { onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { fade } from "svelte/transition";
import { toast } from "svelte-sonner";
import { goto } from "$app/navigation";
import { page } from "$app/stores";
import AccountModal from "$lib/components/auth/AccountModal.svelte";
import IdentityClaimModal from "$lib/components/IdentityClaimModal.svelte";
import NetworkAlert from "$lib/components/NetworkAlert.svelte";
import NotificationModal from "$lib/components/notifications/NotificationModal.svelte";
import { OccurrenceView } from "$lib/components/occurrences/index";
import ViewTabs from "$lib/components/occurrences/ViewTabs.svelte";
import ParticipantFAB from "$lib/components/ParticipantFAB.svelte";
import PlanningErrorStates from "$lib/components/PlanningErrorStates.svelte";
import PwaInstallCard from "$lib/components/PwaInstallCard.svelte";
import QuitReturnModal from "$lib/components/QuitReturnModal.svelte";
import ShareSection from "$lib/components/ShareSection.svelte";
import ConfirmModal from "$lib/components/ui/ConfirmModal.svelte";
import DescriptionCard from "$lib/components/ui/DescriptionCard.svelte";
import { PlanningSkeleton } from "$lib/components/ui/skeletons";
import * as m from "$lib/paraglide/messages.js";
import { addParticipant, quitPlanning, updateParticipant } from "$lib/services/planningActions";
import { ensurePlanningParticipant } from "$lib/services/planningParticipants";
import { authTransition } from "$lib/stores/authTransition.svelte";
import { guestStateStore } from "$lib/stores/guestStateStore.svelte";
import { mediaQuery } from "$lib/stores/mediaQuery.svelte";
import { networkStore } from "$lib/stores/networkStore.svelte";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import type { Participant, PlanningIdentity } from "$lib/types/planning.types";
import { formatDate, formatDateShort } from "$lib/utils/date";
import { resolveCurrentIdentity } from "$lib/utils/identityResolution";
import { resolveIdentityStrategy } from "$lib/utils/identityStrategy";
import { hasNameConflict } from "$lib/utils/participantConflict";
import { getRecurrenceLabel } from "$lib/utils/recurrence";

let token = $derived($page.params.token as string);
let master = $derived(planningStore.master);
let allOccurrences = $derived(planningStore.occurrences);
const today = $derived(new Date().toISOString().split("T")[0]);
const occurrences = $derived(allOccurrences.filter((o) => o.date >= today));
let isLoading = $derived(planningStore.isLoading);
let displayCount = $state(10);
let showAllParticipants = $state(false);
let showNotifModal = $state(false);
let showAccountModal = $state(false);
let showQuitModal = $state(false);
let showClaimModal = $state(false);
// Participant proposé au claim direct à l'ouverture du modal (flux de transition
// guest → auth). Null sauf quand le modal s'ouvre via le trigger suggestion.
let suggestionParticipant = $state<Participant | null>(null);
let showQuitReturnModal = $state(false);
let accountModalMode = $state<"login" | "register">("register");

// Mémorise les masters pour lesquels on a déjà fait un auto-add silencieux (CAS C)
// afin d'éviter les déclenchements multiples avant que l'update Dexie ne se propage
const autoAddedMasterIds = new SvelteSet<string>();

// Règle ADR-0002 consolidée : auth > guest > identité revendiquée cross-device
const identityResolution = $derived(
	master
		? resolveCurrentIdentity({
				isLoggedIn: !!userStore.isLoggedIn,
				pbUser: userStore.pbUser,
				guestIdentity: guestStateStore.getGuestIdentity(master.id),
				participants: master.participants
			})
		: { participant: null, identity: null, claimedByAuth: false }
);
const myParticipant = $derived(identityResolution.participant);
const identityClaimedByAuth = $derived(identityResolution.claimedByAuth);
const currentIdentity = $derived(identityResolution.identity);

// === Détection retour après quit ===
// Pour l'auth : participant avec userId + hasQuit
// Pour le guest : localMeta.hasQuit + currentUser.id match
const quitParticipantId = $derived.by(() => {
	if (!master) return null;
	if (userStore.isLoggedIn && userStore.pbUser) {
		return (
			master.participants.find((p) => p.userId === userStore.pbUser!.id && p.hasQuit)?.id ?? null
		);
	}
	const guestIdentity = guestStateStore.getGuestIdentity(master.id);
	if (guestStateStore.getGuestQuitState(master.id) && guestIdentity) {
		return master.participants.find((p) => p.id === guestIdentity.id && p.hasQuit)?.id ?? null;
	}
	return null;
});
const hasQuitThisPlanning = $derived(quitParticipantId !== null);

// Participants non-liés que l'user auth peut revendiquer (sans userId, sans hasQuit)
const claimableParticipants = $derived(
	master
		? master.participants.filter((p) => !p.userId && !p.hasQuit && p.id !== myParticipant?.id)
		: []
);

// Mode du IdentityClaimModal selon que l'user est déjà participant ou non
const claimModalMode = $derived(myParticipant ? "manage" : "new");

// Lien profond depuis les emails de notification (footer) : /p/{token}?notif=1
// ouvre directement le modal des préférences de notification au mount.
onMount(() => {
	if ($page.url.searchParams.get("notif") === "1") {
		showNotifModal = true;
	}
});

$effect(() => {
	if (!master) return;

	// Décision (pure) : quel CAS A/B/C déclencher en fonction du contexte.
	// La stratégie ne fait aucun effet de bord — la réaction se fait dans le switch.
	const result = resolveIdentityStrategy({
		master,
		myParticipant,
		isLoggedIn: !!userStore.isLoggedIn,
		pbUser: userStore.pbUser,
		guestIdentity: guestStateStore.getGuestIdentity(master.id),
		hasQuitThisPlanning,
		isTransitioning: authTransition.isTransitioning,
		pendingGuestClaim: authTransition.pendingGuestClaim,
		autoAddedMasterIds,
		showClaimModal
	});

	if (result.expirePendingClaim) {
		authTransition.clearPendingGuestClaim();
	}

	switch (result.action.type) {
		case "none":
			break;
		case "block_quit":
			if (!showQuitReturnModal) showQuitReturnModal = true;
			break;
		case "silent_sync": {
			// CAS A : déjà lié via userId → sync silencieuse (sans renommer)
			const pbUser = userStore.pbUser!;
			ensurePlanningParticipant(master.id, pbUser.id, master.recurrence.type, isAdmin).catch(
				(err) => console.error("ensurePlanningParticipant failed:", err)
			);
			break;
		}
		case "show_claim_suggestion":
			// Prioritaire sur CAS B/C : snapshot guest→auth valide, propose le
			// claim avant de créer un nouveau participant par auto-add.
			suggestionParticipant = result.action.participant;
			showClaimModal = true;
			break;
		case "show_claim_modal":
			// CAS B (name match) ou CAS C (conflit) → étape principale, pas suggestion
			suggestionParticipant = result.action.suggestionParticipant;
			showClaimModal = true;
			break;
		case "auto_add": {
			autoAddedMasterIds.add(master.id);
			handlePlanningIdentify(result.action.identity, true, result.action.additionalFields);
			break;
		}
		case "identify_as_guest":
			openIdentifyModal();
			break;
	}
});

async function handlePlanningIdentify(
	identity: PlanningIdentity,
	isNewParticipant: boolean,
	additionalFields?: Partial<Participant>
) {
	if (!master) return;

	try {
		const existing = master.participants.find((p) => p.id === identity.id);

		if (isNewParticipant && !existing) {
			await addParticipant(
				master.id,
				{
					id: identity.id,
					name: identity.name,
					isAdmin: false,
					...additionalFields
				},
				token
			);
		} else if (existing && existing.name !== identity.name) {
			await updateParticipant(master.id, identity.id, { name: identity.name }, token);
		}

		if (userStore.isLoggedIn) {
			try {
				await ensurePlanningParticipant(
					master.id,
					userStore.pbUser!.id,
					master.recurrence.type,
					isAdmin
				);
			} catch (err) {
				console.error("Erreur création planning_participant:", err);
			}
		}

		await guestStateStore.setGuestIdentity(master.id, identity);

		userStore.authModal = { ...userStore.authModal, open: false };
	} catch (error) {
		console.error("Error identifying:", error);
		toast.error(m.participant_identify_error());
	}
}

/** Callback invoqué par IdentityClaimModal après un changement d'identité réussi */
function handleIdentityChanged(identity: PlanningIdentity) {
	// Persiste l'identité guest. Pour un user auth, l'écriture est inerte :
	// resolveCurrentIdentity priorise pbUser sur cette identité locale.
	guestStateStore
		.setGuestIdentity(master!.id, identity)
		.catch((err) => console.error("setGuestIdentity failed:", err));
	// Le snapshot de transition est consommé (claim ou ajout effectué).
	authTransition.clearPendingGuestClaim();
	// Le refresh des données vient automatiquement via realtime (pb-sync → Dexie → liveQuery)
	showClaimModal = false;
}

function loadMore() {
	displayCount += 10;
}

function openIdentifyModal() {
	if (!master) return;

	const identityName = currentIdentity?.name || userStore.pbUser?.name || "";

	userStore.authModal = {
		open: true,
		masterId: master.id,
		existingParticipants: master.participants.filter((p) => !p.hasQuit),
		onPlanningIdentify: handlePlanningIdentify,
		initialName: identityName,
		hideExistingParticipants: userStore.isLoggedIn ? true : undefined,
		currentIdentity: currentIdentity
	};
}

function openIdentityClaimModal() {
	suggestionParticipant = null; // ouverture manuelle = étape principale, jamais suggestion
	showClaimModal = true;
}

/** Refus de la suggestion de claim : auto-add du nom du compte si pas de conflit,
 * sinon on laisse l'user résoudre sur l'étape principale (conflit visible). */
function handleDeclineSuggestion() {
	if (!master || !userStore.pbUser) return;
	authTransition.clearPendingGuestClaim();
	const pbUser = userStore.pbUser;
	// Même garde que CAS C : pas d'auto-add si un autre participant actif porte ce nom.
	const conflict = hasNameConflict(master.participants, pbUser.name, pbUser.id);
	if (!conflict) {
		// Pas de conflit → auto-add silencieux + fermer le modal
		if (!autoAddedMasterIds.has(master.id)) {
			autoAddedMasterIds.add(master.id);
			handlePlanningIdentify({ id: pbUser.id, name: pbUser.name, email: pbUser.email }, true, {
				userId: pbUser.id
			});
		}
		showClaimModal = false;
	}
	// Si conflit → ne rien faire : le modal est déjà basculé sur l'étape principale
	// (géré en interne par le composant via suggestionDeclined), conflit visible.
}

const canNativeShare = typeof navigator !== "undefined" && "share" in navigator;

async function shareLink(url: string, label: string) {
	try {
		if (canNativeShare) {
			await navigator.share({
				title: m.participant_share_title(),
				text: m.participant_share_text({ label }),
				url
			});
		} else {
			await navigator.clipboard.writeText(url);
			toast.success(m.participant_copied({ label }));
		}
	} catch (error) {
		if ((error as Error).name !== "AbortError") {
			toast.error(m.participant_share_error());
		}
	}
}

const isAdmin = $derived(master ? !!master.adminToken : false);
const adminToken = $derived(master?.adminToken ?? null);

async function handleQuit() {
	if (!master || !currentIdentity) return;
	try {
		await quitPlanning(master.id, currentIdentity.id, token);
		await guestStateStore.markGuestQuit(master.id);
		toast.success(m.participant_quit_success());
		showQuitModal = false;
		goto("/");
	} catch (err) {
		console.error("Error quitting planning:", err);
		toast.error(m.participant_quit_error());
	}
}

const displayedOccurrences = $derived(occurrences.slice(0, displayCount));
const hasMore = $derived(displayCount < occurrences.length);

// Participants autres que l'utilisateur courant (hors ceux ayant quitté).
// Couvre les 3 états : identifié/verrouillé (myParticipant exclu, géré par le groupe « Vous »)
// ou non identifié (myParticipant null → tous les participants actifs).
const otherParticipants = $derived(
	master ? master.participants.filter((p) => !p.hasQuit && p.id !== myParticipant?.id) : []
);
const visibleOtherParticipants = $derived(
	showAllParticipants ? otherParticipants : otherParticipants.slice(0, 10)
);
const hasMoreOthers = $derived(!showAllParticipants && otherParticipants.length > 10);
</script>

<svelte:head>
	<title>{master?.title || m.participant_title_fallback()}</title>
</svelte:head>

{#if isLoading}
	<PlanningSkeleton />
{:else if master}
	<!-- Bannière réseau : affichée automatiquement quand !networkStore.isNetworkOk (fraîcheur + reload si serveur indispo) -->
	<NetworkAlert />
	<div class="mx-auto max-w-6xl md:px-4" in:fade={{ duration: 300 }}>
		<!-- En-tête -->
		<div class="mb-4 sm:mb-12">
			<div class="mb-2 flex flex-wrap items-start justify-between gap-6 sm:mb-8">
				<div class="flex flex-1 items-center gap-5">
					<div class="bg-primary/10 self-start rounded-2xl p-2 sm:p-4">
						<Calendar class="text-primary size-7 sm:size-6" />
					</div>
					<div class="flex-1 space-y-1">
						<h1 class="text-xl font-semibold tracking-tight sm:text-4xl">{master.title}</h1>
						<div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium opacity-80">
							{#if master.place}
								<div class="flex items-center gap-2">
									<MapPin size={16} class="text-primary" />
									<span>{master.place}</span>
								</div>
							{/if}
						</div>
						<!-- Récurrence -->
						<div class="flex min-w-[calc(50%-0.5rem)] items-center gap-2">
							<div class="flex flex-wrap items-center gap-x-2">
								<div class="truncate text-sm font-medium">
									{getRecurrenceLabel(master.recurrence)} • {master.defaultStartTime} — {master.defaultEndTime}
								</div>
								<div class="text-base-content/70 text-sm">
									{#if master.recurrence.lastDate}
										{m.participant_until()} {formatDateShort(master.recurrence.lastDate)}
									{/if}
								</div>
							</div>
						</div>
					</div>
				</div>

				<div class="ms-auto flex items-center gap-3">
					{#if isAdmin && !mediaQuery.isMobile}
						<div class="tabs sm:tabs-lg tabs-boxed bg-base-200 font-semibold">
							<button class="tab tab-active gap-2">
								<ListFilter size={18} />
								{m.participant_tab_planning()}
							</button>
							<a href="/admin/{adminToken}" class="tab gap-2">
								<Settings size={18} />
								{m.participant_tab_config()}
							</a>
						</div>
					{/if}
				</div>
			</div>

			<!-- Card : Participants (rendue même si 0 participant) -->
			<div class="card card-sm bg-base-300/20 border-base-content/5 mb-4 border shadow-sm">
				<div class="card-body gap-4">
					<!-- Groupe « Vous » : gestion de l'identité courante -->
					<div>
						<div class="text-content-primary mb-2 flex items-center gap-2 text-sm font-semibold">
							<User size={16} class="shrink-0" />
							{m.participant_you()}
						</div>
						{#if currentIdentity}
							<!-- Identifié -->
							<div class="flex flex-wrap items-center gap-2">
								<span class="badge badge-info gap-1 font-bold">{currentIdentity.name}</span>
								<button
									class="btn btn-soft btn-info btn-sm gap-1"
									type="button"
									onclick={() =>
										userStore.isLoggedIn ? openIdentityClaimModal() : openIdentifyModal()}
								>
									<UserCog size={14} />
									{m.participant_change_identity()}
								</button>
								{#if userStore.isLoggedIn && claimableParticipants.length > 0 && !myParticipant?.claimedAt}
									<button
										class="btn btn-link btn-sm text-info gap-1"
										type="button"
										onclick={openIdentityClaimModal}
									>
										<UserCheck size={14} />
										{m.participant_claim_identity()}
									</button>
								{/if}
								<button
									class="btn btn-ghost btn-error btn-sm ms-auto gap-1"
									onclick={() => (showQuitModal = true)}
									title={m.participant_quit_title()}
								>
									<LogOut size={16} />
									<span>{m.participant_quit_button()}</span>
								</button>
							</div>
						{:else if identityClaimedByAuth}
							<!-- Verrouillé : identité guest revendiquée par un compte ailleurs -->
							<div class="alert alert-warning alert-soft flex items-center gap-3 py-2">
								<Lock size={18} class="shrink-0" />
								<span class="flex-1 text-sm">
									{m.participant_identity_locked({name: myParticipant?.name})}
								</span>
								<button
									class="btn btn-primary btn-sm"
									onclick={() => ((accountModalMode = 'login'), (showAccountModal = true))}
								>
									{m.participant_login()}
								</button>
							</div>
						{:else}
							<!-- Non identifié -->
							<div class="alert alert-outline alert-warning flex flex-wrap items-center gap-3">
								<span class="text-sm opacity-80">{m.participant_not_identified()}</span>
								<button
									class="btn btn-warning btn-sm"
									onclick={() =>
										userStore.isLoggedIn ? openIdentityClaimModal() : openIdentifyModal()}
								>
									{m.participant_identify()}
								</button>
							</div>
						{/if}
					</div>

					<!-- Groupe « Autres participant·es » -->
					<div>
						<div class="text-content-primary mb-2 flex items-center gap-2 text-sm font-semibold">
							<Users size={16} class="shrink-0" />
							{m.participant_others_count({n: otherParticipants.length})}
						</div>
						{#if otherParticipants.length === 0}
							<p class="text-sm opacity-60">{m.participant_others_empty()}</p>
						{:else}
							<div class="flex flex-wrap gap-1.5">
								{#each visibleOtherParticipants as p (p.id)}
									<span class="badge badge-info badge-outline font-bold">{p.name}</span>
								{/each}
								{#if hasMoreOthers}
									<button
										class="btn btn-link btn-xs"
										type="button"
										onclick={() => (showAllParticipants = true)}
									>
										{m.participant_show_all({n: otherParticipants.length})}
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>

			<!-- Zone de partage -->
			{#if !mediaQuery.isMobile}
				<ShareSection
					{isAdmin}
					{adminToken}
					participantToken={master.participantToken}
					allowResponses={master?.allowResponses}
					tasksCount={master?.tasks?.length ?? 0}
				/>
			{/if}

			<!-- Installation PWA (compact) -->
			<PwaInstallCard compact />

			<!-- Description du planning (hors card, fait suite au header) -->
			{#if master.description}
				<div class="my-4">
					<DescriptionCard text={master.description} collapsedLines={3} />
				</div>
			{/if}
		</div>

		<!-- Liste des occurrences -->
		<div class="">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-x-2">
			<a href="/p/{token}/archive" class="btn btn-sm btn-soft">
				<History size={18} class="mr-1" />
				{m.participant_view_archive()}
			</a>
				<div class="mx-2 flex gap-2">
					{#if mediaQuery.isMobile && isAdmin}
						<button class="btn btn-accent btn-circle" onclick={() => goto(`/admin/${adminToken}`)}>
							<Settings size={22} class="shrink-0" />
						</button>
					{/if}
					{#if mediaQuery.isMobile}
						<button
							class="btn btn-info btn-circle"
							onclick={() =>
								shareLink(`${window.location.origin}/p/${master!.participantToken}`, m.participant_share_public_link())}
						>
							<Share2 size={22} class="shrink-0" />
						</button>
					{/if}
					<button
						class="btn btn-primary {mediaQuery.isMobile ? 'btn-circle' : ''}"
						onclick={() =>
							userStore.isLoggedIn ? (showNotifModal = true) : (showAccountModal = true)}
					>
						<Bell size={22} class="shrink-0" />
						{#if !mediaQuery.isMobile}
							{m.participant_configure_notifications()}
						{/if}
					</button>
				</div>
			</div>
			<!-- Header avec tabs -->
			<div class="flex flex-wrap items-center justify-between gap-4">
				<h2 class="text-xl font-semibold max-sm:px-2 sm:text-2xl">{m.participant_upcoming_dates()}</h2>
				<ViewTabs />
			</div>

			<!-- État vide : toutes les dates sont passées -->
			{#if occurrences.length === 0 && allOccurrences.length > 0}
				{@const sortedDates = allOccurrences.map((o) => o.date).sort()}
				{@const firstDate = master.recurrence?.firstDate ?? sortedDates[0]}
				{@const lastDate = master.recurrence?.lastDate ?? sortedDates.at(-1)}
				<div
					class="alert alert-vertical alert-info alert-soft mx-auto mt-4"
					in:fade={{ duration: 300 }}
				>
					<CalendarX size={26} class="shrink-0" />
					<div class="flex-1">
						<p class="font-medium">{m.participant_all_dates_passed()}</p>
						{#if firstDate && lastDate}
							<p class="text-sm opacity-80">
								{m.participant_date_range({firstDate: formatDate(firstDate), lastDate: formatDate(lastDate)})}
							</p>
						{/if}
						<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
							<a href="/p/{token}/archive" class="link link-hover inline-flex items-center gap-1">
								<History size={14} />
								{m.participant_view_archive_link()}
							</a>
							{#if isAdmin}
								<a
									href="/admin/{adminToken}"
									class="link link-hover inline-flex items-center gap-1"
								>
									<Settings size={14} />
									{m.participant_edit_planning()}
								</a>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<!-- Liste des occurrences avec composant unique -->
			{#each displayedOccurrences as occurrence, i (occurrence.id)}
				{@const isDateBoundary =
					i > 0 &&
					(master.timeSlots?.length ?? 0) > 1 &&
					displayedOccurrences[i - 1].date !== occurrence.date &&
					userStore.appPreferences.occurrenceView !== 'card'}
				<div class={isDateBoundary ? 'mt-6' : 'mt-2'}>
					<OccurrenceView
						{occurrence}
						{master}
						participants={master.participants}
						currentUserId={currentIdentity?.id}
						{isAdmin}
						onNeedReidentify={() =>
							userStore.isLoggedIn ? openIdentityClaimModal() : openIdentifyModal()}
					/>
				</div>
			{/each}

			{#if hasMore}
				<div class="my-4 text-center">
					<button class="btn btn-outline" onclick={loadMore}>
						{m.participant_load_more({n: occurrences.length - displayCount})}
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- FAB Speed Dial - mobile only -->
	{#if mediaQuery.isMobile}
		<ParticipantFAB
			{isAdmin}
			{adminToken}
			{token}
			onShare={shareLink}
			onNotifClick={() => {
				if (userStore.isLoggedIn) {
					showNotifModal = true;
				} else {
					showAccountModal = true;
				}
			}}
		/>
	{/if}
{:else if !networkStore.online || planningStore.error?.type === 'network'}
	<PlanningErrorStates
		errorType={planningStore.error?.type === 'network' ? 'network' : null}
		isOffline={!networkStore.online}
	/>
{:else if planningStore.error?.type === 'deleted'}
	<PlanningErrorStates errorType="deleted" isOffline={false} />
{:else}
	<PlanningErrorStates errorType="not-found" isOffline={false} />
{/if}

<NotificationModal
	bind:open={showNotifModal}
	onClose={() => (showNotifModal = false)}
	planningId={master?.id ?? ''}
	recurrenceType={master?.recurrence.type ?? 'WEEKLY'}
	{isAdmin}
/>

<AccountModal
	bind:open={showAccountModal}
	onClose={() => (showAccountModal = false)}
	onSuccess={() => {
		// Après création/connexion du compte, ouvrir le modal de notifications
		showAccountModal = false;
		showNotifModal = true;
	}}
	defaultMode={accountModalMode}
/>

<ConfirmModal
	bind:open={showQuitModal}
	onClose={() => (showQuitModal = false)}
	onConfirm={handleQuit}
	title={m.participant_quit_modal_title()}
	message={m.participant_quit_modal_message()}
	description={m.participant_quit_modal_description()}
	confirmLabel={m.participant_quit_confirm()}
	variant="warning"
/>

{#if master && userStore.pbUser}
	<IdentityClaimModal
		bind:open={showClaimModal}
		onClose={() => (showClaimModal = false)}
		mode={claimModalMode}
		{master}
		pbUser={userStore.pbUser!}
		{token}
		occurrences={allOccurrences}
		onIdentityChanged={handleIdentityChanged}
		{suggestionParticipant}
		onDeclineSuggestion={handleDeclineSuggestion}
	/>
{/if}

{#if master && quitParticipantId}
	<QuitReturnModal
		bind:open={showQuitReturnModal}
		onClose={() => (showQuitReturnModal = false)}
		{master}
		{token}
		quitParticipantId={quitParticipantId!}
		onRejoined={() => (showQuitReturnModal = false)}
	/>
{/if}
