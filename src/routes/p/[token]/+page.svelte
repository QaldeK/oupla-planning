<script lang="ts">
	import { page } from '$app/stores';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import IdentityClaimModal from '$lib/components/IdentityClaimModal.svelte';
	import NotificationModal from '$lib/components/notifications/NotificationModal.svelte';
	import { OccurrenceView } from '$lib/components/occurrences/index';
	import ViewTabs from '$lib/components/occurrences/ViewTabs.svelte';
	import ParticipantFAB from '$lib/components/ParticipantFAB.svelte';
	import PlanningErrorStates from '$lib/components/PlanningErrorStates.svelte';
	import PwaInstallCard from '$lib/components/PwaInstallCard.svelte';
	import ShareSection from '$lib/components/ShareSection.svelte';
	import { PlanningSkeleton } from '$lib/components/ui/skeletons';
	import { addParticipant, updateParticipant, quitPlanning } from '$lib/services/planningActions';
	import QuitReturnModal from '$lib/components/QuitReturnModal.svelte';
	import { ensurePlanningParticipant } from '$lib/services/planningParticipants';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import type { Participant, PlanningIdentity } from '$lib/types/planning.types';
	import { formatDateShort } from '$lib/utils/date';
	import { getRecurrenceLabel } from '$lib/utils/recurrence';
	import { fade } from 'svelte/transition';

	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import {
		Bell,
		Calendar,
		History,
		InfoIcon,
		ListFilter,
		Lock,
		MapPin,
		Settings,
		Users,
		LogOut,
		User,
		UserCheck,
		UserCog
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';

	let token = $derived($page.params.token as string);
	let master = $derived(planningStore.master);
	let allOccurrences = $derived(planningStore.occurrences);
	const today = $derived(new Date().toISOString().split('T')[0]);
	const occurrences = $derived(allOccurrences.filter((o) => o.date >= today));
	let isLoading = $derived(planningStore.isLoading);
	let displayCount = $state(10);
	let showAllParticipants = $state(false);
	let showNotifModal = $state(false);
	let showAccountModal = $state(false);
	let showQuitModal = $state(false);
	let showClaimModal = $state(false);
	let showQuitReturnModal = $state(false);
	let accountModalMode = $state<'login' | 'register'>('register');

	// Mémorise les masters pour lesquels on a déjà fait un auto-add silencieux (CAS C)
	// afin d'éviter les déclenchements multiples avant que l'update Dexie ne se propage
	const autoAddedMasterIds = new SvelteSet<string>();

	// Participant lié à l'utilisateur courant sur ce planning
	// - Auth : recherche par `userId` (le participant peut avoir un id différent de pbUser.id)
	// - Guest : recherche par `currentIdentity.id`
	const myParticipant = $derived.by(() => {
		if (!master) return null;
		if (userStore.isLoggedIn && userStore.pbUser) {
			return (
				master.participants.find((p) => p.userId === userStore.pbUser!.id && !p.hasQuit) ?? null
			);
		}
		const identity = userStore.getIdentityForPlanning(master.id);
		if (identity) {
			return master.participants.find((p) => p.id === identity.id && !p.hasQuit) ?? null;
		}
		return null;
	});

	// Détection cross-device : un guest dont le participant possède un `userId` alors
	// qu'il n'est pas connecté. Cela signifie que son identité a été revendiquée par
	// un compte sur un autre terminal (ou qu'il s'est connecté ailleurs). Dans ce
	// cas, on entre en état « locked » : responses bloquées (currentIdentity null),
	// bandeau dédié, pas d'auto-open d'IdentifyModal.
	const identityClaimedByAuth = $derived(!!myParticipant?.userId && !userStore.isLoggedIn);

	const currentIdentity = $derived(
		myParticipant && !identityClaimedByAuth
			? {
					id: myParticipant.id,
					name: myParticipant.name,
					email: userStore.pbUser?.email
				}
			: null
	);

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
		const sp = userStore.savedPlannings.find((p) => p.masterId === master.id);
		if (sp?.hasQuit && sp?.currentUser) {
			return master.participants.find((p) => p.id === sp.currentUser!.id && p.hasQuit)?.id ?? null;
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
	const claimModalMode = $derived(myParticipant ? 'manage' : 'new');

	$effect(() => {
		if (!master) return;

		// Guard : ne rien faire pendant la transition guest → auth.
		// Sans ça, l'$effect verrait un état intermédiaire (master cleared,
		// userId pas encore posé) et déclencherait un CAS B/C intempestif.
		if (userStore.isTransitioning) return;

		// === PRIORITÉ : retour après quit ===
		// L'utilisateur a déjà quitté ce planning. On ouvre un modal de
		// confirmation pour qu'il choisisse de rejoindre ou quitter définitivement.
		// Ce guard bloque CAS A/B/C tant que le choix n'est pas fait.
		if (hasQuitThisPlanning) {
			if (!showQuitReturnModal) showQuitReturnModal = true;
			return;
		}

		// === Utilisateur authentifié ===
		if (userStore.isLoggedIn && userStore.pbUser) {
			const pbUser = userStore.pbUser;

			// CAS A : déjà participant via userId → sync silencieuse (sans renommer, préserve l'indépendance nom-par-planning)
			if (myParticipant) {
				ensurePlanningParticipant(master.id, pbUser.id).catch((err) =>
					console.error('ensurePlanningParticipant failed:', err)
				);
				return;
			}

			// CAS B : name match avec un participant non-lié sans hasQuit → ouvrir IdentityClaimModal
			const nameMatch = master.participants.find(
				(p) => !p.userId && !p.hasQuit && p.name.toLowerCase() === pbUser.name.toLowerCase()
			);
			if (nameMatch && !showClaimModal) {
				openIdentityClaimModal();
				return;
			}

			// CAS C : pas de match → auto-add silencieux avec userId
			// Garde de sécurité : ne pas re-déclencher si déjà fait pour ce master
			if (!autoAddedMasterIds.has(master.id)) {
				autoAddedMasterIds.add(master.id);
				handlePlanningIdentify({ id: pbUser.id, name: pbUser.name, email: pbUser.email }, true, {
					userId: pbUser.id
				});
			}
			return;
		}

		// === Guest ===
		if (!userStore.getIdentityForPlanning(master.id)) {
			openIdentifyModal();
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
					await ensurePlanningParticipant(master.id, userStore.pbUser!.id);
				} catch (err) {
					console.error('Erreur création planning_participant:', err);
				}
			}

			await userStore.setPlanningIdentity(master.id, identity);

			userStore.authModal = { ...userStore.authModal, open: false };
		} catch (error) {
			console.error('Error identifying:', error);
			toast.error("Erreur lors de l'identification");
		}
	}

	/** Callback invoqué par IdentityClaimModal après un changement d'identité réussi */
	function handleIdentityChanged(identity: PlanningIdentity) {
		// setPlanningIdentity est no-op pour les auth, mais on l'appelle pour les guests
		userStore
			.setPlanningIdentity(master!.id, identity)
			.catch((err) => console.error('setPlanningIdentity failed:', err));
		// Le refresh des données vient automatiquement via realtime (pb-sync → Dexie → liveQuery)
		showClaimModal = false;
	}

	function loadMore() {
		displayCount += 10;
	}

	function openIdentifyModal() {
		if (!master) return;

		const identityName = currentIdentity?.name || userStore.pbUser?.name || '';

		userStore.authModal = {
			open: true,
			masterId: master.id,
			existingParticipants: master.participants,
			onPlanningIdentify: handlePlanningIdentify,
			initialName: identityName,
			hideExistingParticipants: userStore.isLoggedIn ? true : undefined,
			currentIdentity: currentIdentity
		};
	}

	function openIdentityClaimModal() {
		showClaimModal = true;
	}

	const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;

	async function shareLink(url: string, label: string) {
		try {
			if (canNativeShare) {
				await navigator.share({ title: 'Oupla - Planning', text: `Participe à ${label}`, url });
			} else {
				await navigator.clipboard.writeText(url);
				toast.success(`${label} copié !`);
			}
		} catch (error) {
			if ((error as Error).name !== 'AbortError') {
				toast.error('Erreur lors du partage');
			}
		}
	}

	const isAdmin = $derived(master ? !!master.adminToken : false);
	const adminToken = $derived(master?.adminToken ?? null);

	async function handleQuit() {
		if (!master || !currentIdentity) return;
		try {
			await quitPlanning(master.id, currentIdentity.id, token);
			await userStore.markPlanningAsQuit(master.id);
			toast.success('Vous avez quitté le planning');
			showQuitModal = false;
			goto('/');
		} catch (err) {
			console.error('Error quitting planning:', err);
			toast.error('Erreur lors de la sortie du planning');
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
	<title>{master?.title || 'Planning'}</title>
</svelte:head>

{#if isLoading}
	<PlanningSkeleton />
{:else if master}
	<div class="mx-auto max-w-6xl md:px-4 md:py-8" in:fade={{ duration: 300 }}>
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
										jusqu'au {formatDateShort(master.recurrence.lastDate)}
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
								Planning
							</button>
							<a href="/admin/{adminToken}" class="tab gap-2">
								<Settings size={18} />
								Configuration
							</a>
						</div>
					{/if}
				</div>
			</div>

			<!-- Description du planning (hors card, fait suite au header) -->
			{#if master.description}
				<div class="mb-4 flex items-start gap-2">
					<InfoIcon size={18} class="text-primary mt-0.5 shrink-0" />
					<p class="text-base-content/80 text-sm">{master.description}</p>
				</div>
			{/if}

			<!-- Card : Participants (rendue même si 0 participant) -->
			<div class="card card-sm bg-base-300/20 border-base-content/5 mb-4 border shadow-sm">
				<div class="card-body gap-4">
					<!-- Groupe « Vous » : gestion de l'identité courante -->
					<div>
						<div class="text-content-primary mb-2 flex items-center gap-2 text-sm font-semibold">
							<User size={16} class="shrink-0" />
							Vous
						</div>
						{#if currentIdentity}
							<!-- Identifié -->
							<div class="flex flex-wrap items-center gap-2">
								<span class="badge badge-info gap-1">{currentIdentity.name}</span>
								<button
									class="btn btn-soft btn-info btn-sm gap-1"
									type="button"
									onclick={() =>
										userStore.isLoggedIn ? openIdentityClaimModal() : openIdentifyModal()}
								>
									<UserCog size={14} />
									Changer d'identité
								</button>
								{#if userStore.isLoggedIn && claimableParticipants.length > 0 && !myParticipant?.claimedAt}
									<button
										class="btn btn-link btn-sm text-info gap-1"
										type="button"
										onclick={openIdentityClaimModal}
									>
										<UserCheck size={14} />
										Revendiquer une identité existante
									</button>
								{/if}
								<button
									class="btn btn-ghost btn-error btn-sm ms-auto gap-1"
									onclick={() => (showQuitModal = true)}
									title="Quitter ce planning"
								>
									<LogOut size={16} />
									<span>Quitter le planning</span>
								</button>
							</div>
						{:else if identityClaimedByAuth}
							<!-- Verrouillé : identité guest revendiquée par un compte ailleurs -->
							<div class="alert alert-warning alert-soft flex items-center gap-3 py-2">
								<Lock size={18} class="shrink-0" />
								<span class="flex-1 text-sm">
									L'identité « {myParticipant?.name} » est désormais liée à un compte. Connectez-vous
									pour continuer à participer.
								</span>
								<button
									class="btn btn-primary btn-sm"
									onclick={() => ((accountModalMode = 'login'), (showAccountModal = true))}
								>
									Se connecter
								</button>
							</div>
						{:else}
							<!-- Non identifié -->
							<div class="flex flex-wrap items-center gap-3">
								<span class="text-sm opacity-80">Vous n'êtes pas encore identifié.</span>
								<button
									class="btn btn-primary btn-sm"
									onclick={() =>
										userStore.isLoggedIn ? openIdentityClaimModal() : openIdentifyModal()}
								>
									S'identifier
								</button>
							</div>
						{/if}
					</div>

					<!-- Groupe « Autres participant·es » -->
					<div>
						<div class="text-content-primary mb-2 flex items-center gap-2 text-sm font-semibold">
							<Users size={16} class="shrink-0" />
							{otherParticipants.length} autre{otherParticipants.length > 1 ? 's' : ''}
							participant{otherParticipants.length > 1 ? 's' : ''}
						</div>
						{#if otherParticipants.length === 0}
							<p class="text-sm opacity-60">Pas d'autre participant pour le moment.</p>
						{:else}
							<div class="flex flex-wrap gap-1.5">
								{#each visibleOtherParticipants as p (p.id)}
									<span class="badge badge-info badge-outline">{p.name}</span>
								{/each}
								{#if hasMoreOthers}
									<button
										class="btn btn-link btn-xs"
										type="button"
										onclick={() => (showAllParticipants = true)}
									>
										Tout afficher ({otherParticipants.length})
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
					{token}
					allowResponses={master?.allowResponses}
					tasksCount={master?.tasks?.length ?? 0}
				/>
			{/if}

			<!-- Installation PWA (compact) -->
			<PwaInstallCard compact />
		</div>

		<!-- Liste des occurrences -->
		<div class="">
			<div class="flex flex-wrap justify-between gap-x-4">
				<a href="/p/{token}/archive" class="btn btn-soft mb-2 gap-2">
					<History size={18} />
					Voir les événements passés
				</a>
				<div class="mx-2 flex gap-4">
					{#if mediaQuery.isMobile && isAdmin}
						<button class="btn btn-accent btn-circle" onclick={() => goto(`/admin/${adminToken}`)}>
							<Settings size={18} class="shrink-0" />
						</button>
					{/if}
					<button
						class="btn btn-primary {mediaQuery.isMobile ? 'btn-circle' : ''}"
						onclick={() =>
							userStore.isLoggedIn ? (showNotifModal = true) : (showAccountModal = true)}
					>
						<Bell size={18} class="shrink-0" />
						{#if !mediaQuery.isMobile}
							Configurer les notifications
						{/if}
					</button>
				</div>
			</div>
			<!-- Header avec tabs -->
			<div class="flex flex-wrap items-center justify-between gap-4">
				<h2 class="text-xl font-semibold max-sm:px-2 sm:text-2xl">Prochaines dates</h2>
				<ViewTabs />
			</div>

			<!-- Liste des occurrences avec composant unique -->
			{#each displayedOccurrences as occurrence (occurrence.id)}
				<OccurrenceView
					{occurrence}
					{master}
					participants={master.participants}
					currentUserId={currentIdentity?.id}
					{isAdmin}
					onNeedReidentify={() =>
						userStore.isLoggedIn ? openIdentityClaimModal() : openIdentifyModal()}
				/>
			{/each}

			{#if hasMore}
				<div class="my-4 text-center">
					<button class="btn btn-outline" onclick={loadMore}>
						Afficher plus ({occurrences.length - displayCount} restantes)
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
	title="Quitter ce planning ?"
	message="Êtes-vous sûr de vouloir quitter ce planning ?"
	description="Votre réponses seront supprimées et ne serez plus inscrit comme participant·e. Vous pourrez retrouver ce planning si vous conservez son url."
	confirmLabel="Quitter"
	variant="warning"
/>

{#if master && userStore.pbUser}
	<IdentityClaimModal
		bind:open={showClaimModal}
		onClose={() => (showClaimModal = false)}
		mode={claimModalMode}
		{master}
		pbUser={userStore.pbUser}
		{token}
		occurrences={allOccurrences}
		onIdentityChanged={handleIdentityChanged}
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
