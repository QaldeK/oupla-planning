<script lang="ts">
	import { page } from '$app/stores';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import NotificationModal from '$lib/components/notifications/NotificationModal.svelte';
	import { OccurrenceView } from '$lib/components/occurrences/index';
	import ViewTabs from '$lib/components/occurrences/ViewTabs.svelte';
	import ParticipantFAB from '$lib/components/ParticipantFAB.svelte';
	import PlanningErrorStates from '$lib/components/PlanningErrorStates.svelte';
	import PwaInstallCard from '$lib/components/PwaInstallCard.svelte';
	import ShareSection from '$lib/components/ShareSection.svelte';
	import { PlanningSkeleton } from '$lib/components/ui/skeletons';
	import { addParticipant, updateParticipant, quitPlanning } from '$lib/services/planningActions';
	import { ensurePlanningParticipant } from '$lib/services/planningParticipants';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import type { PlanningIdentity } from '$lib/types/planning.types';
	import { formatDateShort } from '$lib/utils/date';
	import { getRecurrenceLabel } from '$lib/utils/recurrence';
	import { fade } from 'svelte/transition';

	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import {
		Bell,
		Calendar,
		History,
		Info,
		InfoIcon,
		ListFilter,
		MapPin,
		Settings,
		Users,
		LogOut
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

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
	let accountModalMode = $state<'login' | 'register'>('register');

	$effect(() => {
		if (!master) return;

		// === Utilisateur authentifié ===
		if (userStore.isLoggedIn && userStore.pbUser) {
			const pbUser = userStore.pbUser;
			const existingParticipant = master.participants.find((p) => p.id === pbUser.id);

			if (existingParticipant) {
				// Déjà participant — synchroniser l'identité
				handlePlanningIdentify(
					{
						id: existingParticipant.id,
						name: existingParticipant.name,
						email: existingParticipant.email
					},
					false
				);
				return;
			}

			// Pas encore participant — vérifier le conflit de nom
			const hasConflict = master.participants.some(
				(p) => p.name.toLowerCase() === pbUser.name.toLowerCase() && p.id !== pbUser.id
			);

			if (!hasConflict) {
				// Pas de conflit → ajouter automatiquement
				handlePlanningIdentify({ id: pbUser.id, name: pbUser.name, email: pbUser.email }, true);
			} else {
				// Conflit → ouvrir le modal pour choisir un autre nom
				openIdentifyModal();
			}
			return;
		}

		// === Guest ===
		if (!userStore.getIdentityForPlanning(master.id)) {
			openIdentifyModal();
		}
	});

	async function handlePlanningIdentify(identity: PlanningIdentity, isNewParticipant: boolean) {
		if (!master) return;

		try {
			const existing = master.participants.find((p) => p.id === identity.id);

			if (isNewParticipant && !existing) {
				const updated = await addParticipant(
					master.id,
					{
						id: identity.id,
						name: identity.name,
						isAdmin: false
					},
					token
				);
			} else if (existing && existing.name !== identity.name) {
				const updated = await updateParticipant(
					master.id,
					identity.id,
					{ name: identity.name },
					token
				);
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

	function loadMore() {
		displayCount += 10;
	}

	function openIdentifyModal() {
		if (!master) return;

		const identityName = currentIdentity?.name || userStore.pbUser?.name || '';

		// Pour les users authentifiés : préremplir le nom et cacher la liste des participants
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
			await userStore.removePlanningIdentity(master.id);
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
	const currentIdentity = $derived(master ? userStore.getIdentityForPlanning(master.id) : null);

	// Liste des participants avec l'utilisateur actuel en premier
	const sortedParticipants = $derived.by(() => {
		if (!master || !currentIdentity) return master?.participants ?? [];

		const currentUser = master.participants.find((p) => p.id === currentIdentity.id);
		const otherParticipants = master.participants.filter((p) => p.id !== currentIdentity.id);

		return currentUser ? [currentUser, ...otherParticipants] : master.participants;
	});

	const visibleParticipants = $derived(
		showAllParticipants ? sortedParticipants : sortedParticipants.slice(0, 10)
	);
	const hasMoreParticipants = $derived(!showAllParticipants && sortedParticipants.length > 10);
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

			<!-- Card 1: Infos Planning -->
			{#if master.description || master.recurrence || master.participants.length > 0}
				<div class="card card-sm bg-base-200 border-base-content/5 mb-4 border shadow-sm">
					<div class="card-body">
						<div class="flex flex-wrap items-start gap-4 max-sm:flex-col">
							<!-- Participants -->
							<div
								class="{master.description
									? 'min-w-[calc(50%-0.5rem)]'
									: 'w-full'} flex flex-1 flex-wrap items-center gap-2"
							>
								<Users size={18} class="text-primary shrink-0" />
								<div class="min-w-0 text-sm font-medium">
									{master.participants.length} participant
									{master.participants.length > 1 ? 's' : ''}
								</div>

								<div class="flex flex-wrap gap-1.5">
									{#each visibleParticipants as p (p.id)}
										{#if currentIdentity && p.id === currentIdentity.id}
											<!-- Utilisateur actuel en badge-info avec bouton changer -->
											<span class="badge badge-info gap-1">
												{p.name}
												<button
													class="btn btn-soft btn-info btn-xs ms-1 h-4 min-h-0 px-1 text-current"
													type="button"
													onclick={openIdentifyModal}
												>
													Changer
												</button>
											</span>
										{:else}
											<span class="badge badge-soft">{p.name}</span>
										{/if}
									{/each}
									{#if hasMoreParticipants}
										<button
											class="btn btn-link btn-xs"
											type="button"
											onclick={() => (showAllParticipants = true)}
										>
											Tout afficher ({sortedParticipants.length})
										</button>
									{/if}
									<button
										class="btn btn-error btn-xs ms-auto gap-1"
										onclick={() => (showQuitModal = true)}
										title="Quitter ce planning"
									>
										<LogOut size={16} />
										<span>Quitter ce planning</span>
									</button>
								</div>
							</div>
							<!-- Description (conditionnel) -->
							{#if master.description}
								<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-center gap-2">
									<InfoIcon size={18} class="text-primary shrink-0" />
									<p class="text-base-content/80 text-sm">{master.description}</p>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

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

			<!-- Identification manquante -->
			{#if !currentIdentity}
				<div class="alert alert-warning mt-4">
					<Info size={18} />
					<p>Veuillez vous identifier pour répondre aux sondages</p>
					<div class="flex gap-2">
						<button class="btn" onclick={openIdentifyModal}>S'identifier</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Liste des occurrences -->
		<div class="">
			<div class="flex flex-wrap justify-between gap-x-4">
				<a href="/p/{token}/archive" class="btn btn-sm btn-soft mb-2 gap-2">
					<History size={18} />
					Voir les événements passés
				</a>
				<div class="mx-2 flex gap-4">
					{#if mediaQuery.isMobile && isAdmin}
						<button
							class="btn btn-accent btn-circle btn-sm"
							onclick={() => goto(`/admin/${adminToken}`)}
						>
							<Settings size={18} class="shrink-0" />
						</button>
					{/if}
					<button
						class="btn btn-primary btn-sm {mediaQuery.isMobile ? 'btn-circle' : ''}"
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
	description="Vous pourrez retrouver ce planning si vous concerver son url."
	confirmLabel="Quitter"
	variant="warning"
/>
