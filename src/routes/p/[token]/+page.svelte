<script lang="ts">
	import { page } from '$app/stores';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import CopyLinksButtons from '$lib/components/CopyLinksButtons.svelte';
	import NotificationModal from '$lib/components/notifications/NotificationModal.svelte';
	import { OccurrenceView } from '$lib/components/occurrences/index';
	import ViewTabs from '$lib/components/occurrences/ViewTabs.svelte';
	import { PlanningSkeleton } from '$lib/components/ui/skeletons';
	import { addParticipant, updateParticipant } from '$lib/services/planningActions';
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
		ArrowRightFromLine,
		Bell,
		Calendar,
		Info,
		InfoIcon,
		ListFilter,
		MapPin,
		RefreshCw,
		Settings,
		Share2,
		User,
		Users,
		WifiOff
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let token = $derived($page.params.token as string);
	let master = $derived(planningStore.master);
	let occurrences = $derived(planningStore.occurrences);
	let isLoading = $derived(planningStore.isLoading);
	let displayCount = $state(10);
	let showNotifModal = $state(false);
	let showAccountModal = $state(false);
	let accountModalMode = $state<'login' | 'register'>('register');

	$effect(() => {
		if (!master) return;

		// Déjà identifié sur ce planning — ne rien faire
		if (userStore.getPlanningIdentity(master.id)) return;

		if (userStore.isLoggedIn && userStore.pbUser) {
			const pbUser = userStore.pbUser;
			const existingParticipant = master.participants.find((p) => p.id === pbUser.id);

			if (existingParticipant) {
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

			const hasConflict = master.participants.some(
				(p) => p.name.toLowerCase() === pbUser.name.toLowerCase() && p.id !== pbUser.id
			);

			if (!hasConflict) {
				handlePlanningIdentify({ id: pbUser.id, name: pbUser.name, email: pbUser.email }, true);
			} else {
				openIdentifyModal();
			}
			return;
		}

		openIdentifyModal();
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
				planningStore.updateMaster(updated);
			} else if (existing && existing.name !== identity.name) {
				const updated = await updateParticipant(
					master.id,
					identity.id,
					{ name: identity.name },
					token
				);
				planningStore.updateMaster(updated);
			}

			if (userStore.isLoggedIn) {
				try {
					await ensurePlanningParticipant(master.id, userStore.pbUser!.id);
				} catch (err) {
					console.error('Erreur création planning_participant:', err);
				}
			}

			await userStore.setPlanningIdentity(master.id, identity);

			const isAdminToken = token.length === 64;
			const savedPlanning = {
				masterId: master.id,
				title: master.title!,
				participantToken: isAdminToken ? master.participantToken! : token,
				adminToken: isAdminToken ? token : userStore.getAdminToken(master.id) || '',
				lastAccessed: new Date().toISOString(),
				currentUser: identity,
				isSync: userStore.isLoggedIn ? false : undefined
			};
			await userStore.savePlanning(savedPlanning);

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

	const isAdmin = $derived(master ? userStore.hasAdminAccess(master.id) : false);
	const adminToken = $derived(master && isAdmin ? userStore.getAdminToken(master.id) : null);

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
</script>

{#snippet shareContent()}
	<div class="grid gap-8 md:grid-cols-2">
		<!-- Lien Public -->
		<div class="flex flex-col justify-between gap-4">
			<div class="space-y-2">
				<div class="text-content-primary flex items-center gap-2 font-bold">
					<Users size={18} />
					Lien Public
				</div>
				<p class="text-sm leading-relaxed opacity-80">
					Partagez ce lien avec les participants pour qu'ils puissent
					{#if master?.allowResponses}déclarer leur présence,{/if}
					{#if master?.tasks?.length ?? 0 > 0}s'inscrire aux tâches,{/if}
					et ajouter des commentaires.
				</p>
			</div>
			<CopyLinksButtons size="md" participantToken={token} />
		</div>

		<!-- Lien Admin -->
		<div
			class="border-base-content/10 flex flex-col justify-between gap-4 border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8"
		>
			<div class="space-y-2">
				<div class="text-content-warning flex items-center gap-2 font-bold">
					<Settings size={18} />
					Lien Administrateur
				</div>
				<p class="text-sm leading-relaxed opacity-80">
					Permet la modification du planning et des occurrences, ainsi que la confirmation ou
					l'annulation des événements.
				</p>
			</div>
			{#if isAdmin}
				<CopyLinksButtons size="md" adminToken={adminToken ?? undefined} />
			{:else}
				<div class="alert alert-info alert-soft text-xs">
					<Info size={14} />
					<span>Seuls les administrateurs ont accès à ce lien de gestion.</span>
				</div>
			{/if}
		</div>
	</div>
{/snippet}

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
									{#each sortedParticipants as p (p.id)}
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

			<!-- Card 2: config user -->
			<div class="card card-sm bg-base-200 border-base-content/5 border shadow-sm">
				<div class="card-body">
					<div class="flex flex-wrap items-start gap-4 gap-y-4 max-sm:flex-col">
						<!-- Identification (en premier) -->
						<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-center gap-2">
							<div class="min-w-0 flex-1">
								{#if !currentIdentity}
									<p class="text-sm font-medium">Non identifié</p>
									<button class="btn btn-primary btn-xs mt-1" onclick={openIdentifyModal}>
										S'identifier
									</button>
								{:else}
									<div class="flex items-start gap-x-2">
										<User size={18} class="text-primary mt-0.5 shrink-0" />
										<div class="flex items-center justify-between gap-x-2">
											<span class="text-sm leading-4 font-medium">
												Vous êtes identifié comme
												<span class="text-primary-content font-semibold underline"
													>{currentIdentity.name}</span
												>
												sur ce planning.
											</span>
											<button
												class="btn btn-xs btn-primary btn-outline ms-auto text-end"
												onclick={openIdentifyModal}
											>
												Changer
											</button>
										</div>
									</div>
								{/if}
							</div>
						</div>

						<!-- Notifications  -->
						<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
							<Bell size={18} class="text-primary mt-0.5 shrink-0" />
							<div class="min-w-0 flex-1">
								<div class="mb-1 flex flex-wrap items-center justify-between gap-x-2">
									<div class="text-sm font-medium">Notifications :</div>
									<button
										class="btn btn-xs btn-primary btn-outline font-semibold"
										onclick={() =>
											userStore.isLoggedIn ? (showNotifModal = true) : (showAccountModal = true)}
									>
										Configurer
									</button>
								</div>
								{#if !userStore.isLoggedIn}
									<p class="text-base-content/70 mb-2 text-xs">
										Un compte est requis pour recevoir des alertes email ou notifications push sur
										mobile (rappel de vos inscription, alerte annulation, nombre d'inscrit
										insuffisant, nouveaux messages)
									</p>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</div>
			<!-- Zone de partage -->
			{#if !mediaQuery.isMobile}
				<div class="card card-sm bg-base-300 border-primary/10 my-8 border-2 shadow-md">
					<div class="card-body">
						<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
							<Share2 size={22} class="text-primary" />
							Partager ce planning
						</h3>

						{@render shareContent()}
					</div>
				</div>
			{:else}
				<!-- Boutons d'action mobile : Configurer + Partage direct -->
				<div class="p-4">
					<CopyLinksButtons
						size="sm"
						participantToken={token}
						adminToken={adminToken ?? undefined}
					/>
				</div>
			{/if}

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
		<div class="space-y-4">
			<div class="flex justify-end">
				<a href="/p/{token}/archive" class="btn btn-soft gap-2">
					Voir les événements passés
					<ArrowRightFromLine size={18} />
				</a>
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
				<div class="text-center">
					<button class="btn btn-outline" onclick={loadMore}>
						Afficher plus ({occurrences.length - displayCount} restantes)
					</button>
				</div>
			{/if}
		</div>
	</div>
{:else if !networkStore.online || planningStore.error?.type === 'network'}
	{@const errorMessage = !networkStore.online
		? 'Vous êtes hors ligne. Vérifiez votre connexion internet.'
		: 'Le serveur est inaccessible. Réessayez dans quelques instants.'}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="max-w-md text-center">
			<div class="alert alert-error alert-soft">
				<WifiOff size={24} />
				<div>
					<h3 class="font-bold">Connexion impossible</h3>
					<div class="text-xs">
						<p>{errorMessage}</p>
					</div>
				</div>
			</div>
			<button class="btn btn-outline mt-4 gap-2" onclick={() => window.location.reload()}>
				<RefreshCw size={16} />
				Réessayer
			</button>
		</div>
	</div>
{:else}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="text-center">
			<h2 class="mb-2 text-2xl font-bold">Planning introuvable</h2>
			<p class="text-base-content/70">Le lien que vous avez utilisé n'est pas valide</p>
			<a href="/" class="btn btn-primary mt-4">Retour à l'accueil</a>
		</div>
	</div>
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
