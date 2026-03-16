<script lang="ts">
	import { page } from '$app/stores';
	import CopyLinksButtons from '$lib/components/CopyLinksButtons.svelte';
	import { OccurrenceView } from '$lib/components/occurrences/index';
	import ViewTabs from '$lib/components/occurrences/ViewTabs.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { addParticipant, updateParticipant } from '$lib/services/planningActions';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import type { PlanningIdentity } from '$lib/types/planning.types';
	import NotificationModal from '$lib/components/notifications/NotificationModal.svelte';
	import AccountModal from '$lib/components/auth/AccountModal.svelte';
	import { pb } from '$lib/pocketbase/pb';
	import { getRecurrenceLabel } from '$lib/utils/recurrence';
	import { formatDateShort } from '$lib/utils/date';
	import { ensurePlanningParticipant } from '$lib/services/planningParticipants';
	import {
		ArrowRightFromLine,
		Bell,
		Calendar,
		Info,
		InfoIcon,
		ListFilter,
		MapPin,
		Settings,
		Share2,
		User,
		Users
	} from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { mediaQuery } from '$lib/stores/mediaQuery.svelte';

	let token = $derived($page.params.token as string);
	let master = $derived(planningStore.master);
	let occurrences = $derived(planningStore.occurrences);
	let isLoading = $derived(planningStore.isLoading);
	let displayCount = $state(10);
	let showShareModal = $state(false);
	let showNotifModal = $state(false);
	let showAccountModal = $state(false);

	// Initialisation via le store
	$effect(() => {
		planningStore.init(token);
	});

	// Logique d'ouverture du modal d'identification
	$effect(() => {
		if (!master) return;

		// CAS 1 : Déjà identifié sur ce planning
		const existingIdentity = userStore.getPlanningIdentity(master.id);
		if (existingIdentity) {
			return; // Pas de modal
		}

		// CAS 2 : Vérifier si l'utilisateur est déjà participant via son ID global
		const globalId = userStore.globalProfile?.id;
		const defaultName = userStore.globalProfile?.defaultName?.trim() || '';

		// Chercher un participant avec le même ID global
		const existingParticipant = master.participants.find((p) => p.id === globalId);

		if (existingParticipant) {
			// L'utilisateur est déjà participant ! L'identifier automatiquement
			handlePlanningIdentify(
				{
					id: existingParticipant.id,
					name: existingParticipant.name,
					email: existingParticipant.email,
					notifyOnMissingParticipants: existingParticipant.notifyOnMissingParticipants
				},
				false // Pas un nouveau participant
			);
			return; // Pas de modal
		}

		// CAS 3 : Première fois sur ce planning - vérifier les conflits de noms
		const hasConflict = master.participants.some(
			(p) => p.name.toLowerCase() === defaultName.toLowerCase() && p.id !== globalId
		);

		// Communiquer le mode au userStore pour que le layout affiche le bon modal
		userStore.authModal = {
			open: true,
			mode: hasConflict ? 'conflict' : 'planning',
			masterId: master.id,
			existingParticipants: master.participants,
			onPlanningIdentify: handlePlanningIdentify
		};
	});

	onDestroy(() => {
		planningStore.cleanup();
	});

	async function handlePlanningIdentify(identity: PlanningIdentity, isNewParticipant: boolean) {
		if (!master) return;

		try {
			// Vérifier si le participant existe déjà (pour éviter les doublons même si le modal dit "nouveau")
			const existing = master.participants.find((p) => p.id === identity.id);

			if (isNewParticipant && !existing) {
				const updated = await addParticipant(
					master.id,
					{
						id: identity.id,
						name: identity.name,
						email: identity.email,
						isAdmin: false,
						notifyOnMissingParticipants: identity.notifyOnMissingParticipants
					},
					token
				);
				planningStore.setMaster(updated);
			} else {
				// MISE À JOUR : Mettre à jour si le participant existe déjà (ou si c'est une update explicite)
				if (existing && (existing.name !== identity.name || existing.email !== identity.email)) {
					const updated = await updateParticipant(
						master.id,
						identity.id,
						{ name: identity.name, email: identity.email },
						token
					);
					planningStore.setMaster(updated);
				}
			}

			// NOUVEAU : Si user authentifié, l'ajouter à planning_participants
			if (pb.authStore.isValid && pb.authStore.record?.id) {
				try {
					await ensurePlanningParticipant(master.id, pb.authStore.record.id);
				} catch (err) {
					console.error('Erreur création planning_participant:', err);
				}
			}

			// Mettre à jour l'identité locale
			await userStore.setPlanningIdentity(master.id, identity);

			// Si l'utilisateur veut mémoriser le planning, déclencher la persistance
			if (identity.rememberMe) {
				const current = userStore.getSavedPlanning(master.id);
				if (current) {
					await userStore.savePlanning(current, true);
				}
			}

			if (!userStore.globalProfile) {
				await userStore.createGlobalProfile(identity.name, identity.email);
			}

			userStore.authModal = { ...userStore.authModal, open: false };
		} catch (error) {
			console.error('Error identifying:', error);
			toast.error("Erreur lors de l'identification");
		}
	}

	function loadMore() {
		displayCount += 10;
	}

	const isAdmin = $derived(master ? userStore.hasAdminAccess(master.id) : false);
	const adminToken = $derived(master && isAdmin ? userStore.getAdminToken(master.id) : null);

	const displayedOccurrences = $derived(occurrences.slice(0, displayCount));
	const hasMore = $derived(displayCount < occurrences.length);
	const currentIdentity = $derived(master ? userStore.getIdentityForPlanning(master.id) : null);
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
	<div class="flex min-h-[50vh] items-center justify-center">
		<span class="loading loading-spinner loading-lg"></span>
	</div>
{:else if master}
	<div class="mx-auto max-w-6xl md:px-4 md:py-8">
		<!-- En-tête -->
		<div class="mb-12">
			<div class="mb-8 flex flex-wrap items-start justify-between gap-6">
				<div class="flex flex-1 items-center gap-5">
					<div class="bg-primary/10 rounded-2xl p-4">
						<Calendar class="text-primary size-7 sm:size-10" />
					</div>
					<div class="flex-1 space-y-1 sm:space-y-3">
						<div>
							<h1 class="text-2xl font-semibold tracking-tight sm:text-4xl">{master.title}</h1>
						</div>

						<div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium opacity-80">
							{#if master.place}
								<div class="flex items-center gap-2">
									<MapPin size={16} class="text-primary" />
									<span>{master.place}</span>
								</div>
							{/if}
						</div>

						{#if master.tasks && master.tasks.length > 0}
							<div class="flex flex-wrap gap-1.5 pt-1">
								{#each master.tasks as task (task.id)}
									<span class="badge badge-ghost badge-sm font-medium opacity-80">{task.name}</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<div class="ms-auto flex items-center gap-3">
					{#if isAdmin}
						<div class="tabs tabs-lg tabs-boxed bg-base-200 font-semibold">
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
						<div class="flex flex-wrap items-start gap-4">
							<!-- Récurrence -->
							<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
								<Calendar size={18} class="text-primary/70 mt-0.5 shrink-0" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">
										{getRecurrenceLabel(master.recurrence)}
									</p>
									<p class="text-base-content/60 text-xs">
										{#if master.recurrence.firstDate || master.recurrence.lastDate}
											Du {formatDateShort(master.recurrence.firstDate || '')}
											au {formatDateShort(master.recurrence.lastDate || '')}
										{/if}
										{master.defaultStartTime} — {master.defaultEndTime}
									</p>
								</div>
							</div>

							<!-- Description (conditionnel) -->
							{#if master.description}
								<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
									<InfoIcon size={18} class="text-primary/70 mt-0.5 shrink-0" />
									<p class="text-base-content/80 line-clamp-2 text-sm">{master.description}</p>
								</div>
							{/if}

							<!-- Participants -->
							<div
								class="{master.description
									? 'min-w-[calc(50%-0.5rem)]'
									: 'w-full'} flex flex-1 items-start gap-2"
							>
								<Users size={18} class="text-primary/70 mt-0.5 shrink-0" />
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium">
										{master.participants.length} participant
										{master.participants.length > 1 ? 's' : ''}
									</p>
									<div class="mt-1 flex flex-wrap gap-1.5">
										{#each master.participants as p (p.id)}
											<span class="badge badge-sm badge-ghost opacity-70">{p.name}</span>
										{/each}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Card 2: Votre Expérience -->
			<div class="card card-sm bg-base-200 border-base-content/5 border shadow-sm">
				<div class="card-body">
					<div class="flex flex-wrap items-start gap-4">
						<!-- Identification (en premier) -->
						<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
							<User size={18} class="text-primary/70 mt-0.5 shrink-0" />
							<div class="min-w-0 flex-1">
								{#if !currentIdentity}
									<p class="text-sm font-medium">Non identifié</p>
									<button
										class="btn btn-primary btn-xs mt-1"
										onclick={() => (userStore.authModal.open = true)}
									>
										S'identifier
									</button>
								{:else}
									<p class="text-sm font-medium">{currentIdentity.name}</p>
									<p class="text-base-content/60 text-xs">Identifié sur ce planning</p>
									<button
										class="btn btn-ghost btn-xs mt-1"
										onclick={() => {
											userStore.authModal = {
												open: true,
												mode: 'planning',
												masterId: master.id,
												existingParticipants: master.participants,
												onPlanningIdentify: handlePlanningIdentify
											};
										}}
									>
										Changer
									</button>
								{/if}
							</div>
						</div>

						<!-- Notifications (en second) -->
						<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
							<Bell size={18} class="text-info/70 mt-0.5 shrink-0" />
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">Notifications</p>
								<p class="text-base-content/60 mb-2 text-xs">
									{pb.authStore.isValid
										? 'Configurez vos préférences'
										: 'Connectez-vous pour recevoir des alertes'}
								</p>
								<button
									class="btn btn-ghost btn-xs"
									onclick={() =>
										pb.authStore.isValid ? (showNotifModal = true) : (showAccountModal = true)}
								>
									Configurer
								</button>
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
				<Modal
					open={showShareModal}
					onClose={() => (showShareModal = false)}
					title="Partager ce planning"
				>
					<div class="py-4">
						{@render shareContent()}
					</div>
				</Modal>
			{/if}

			<!-- Identification -->
			{#if !currentIdentity}
				<div class="alert alert-warning mt-4">
					<Info size={18} />
					<p>Veuillez vous identifier pour répondre aux occurrences</p>
					<div class="flex gap-2">
						{#if mediaQuery.isMobile}
							<button class="btn btn-primary" onclick={() => (showShareModal = true)}>
								<Share2 size={18} />
								Partager
							</button>
						{/if}
						<button class="btn" onclick={() => (userStore.authModal.open = true)}>
							S'identifier
						</button>
					</div>
				</div>
			{:else}
				<div class="card card-sm bg-base-200 border-base-content/5 mt-6 border shadow-sm">
					<div class="card-body items-center justify-between sm:flex-row">
						<div class="flex items-center gap-3">
							<div class="bg-base-300 text-primary rounded-2xl p-3">
								<User size={24} />
							</div>
							<div>
								<p class="text-sm opacity-70">
									Sur ce planning, vous êtes identifié en tant que <span class="font-bold"
										>{currentIdentity.name}</span
									>
								</p>
							</div>
						</div>
						<div class="flex items-center gap-2 max-sm:w-full">
							{#if mediaQuery.isMobile}
								<button
									class="btn btn-primary sm:btn-sm flex-1"
									onclick={() => (showShareModal = true)}
								>
									<Share2 size={18} />
									Partager
								</button>
							{/if}
							<button
								class="btn btn-soft sm:btn-sm ms-auto max-sm:flex-1"
								onclick={() => {
									userStore.authModal = {
										open: true,
										mode: 'planning',
										masterId: master.id,
										existingParticipants: master.participants,
										onPlanningIdentify: handlePlanningIdentify
									};
								}}
							>
								Changer mon nom
							</button>
						</div>
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
				<h2 class="text-2xl font-semibold">Prochaines occurrences</h2>
				<ViewTabs />
			</div>

			<!-- Liste des occurrences avec composant unique -->
			<div class="">
				{#each displayedOccurrences as occurrence (occurrence.id)}
					<OccurrenceView
						{occurrence}
						{master}
						participants={master.participants}
						currentUserId={userStore.getIdentityForPlanning(master.id)?.id}
						{isAdmin}
					/>
				{/each}
			</div>

			{#if hasMore}
				<div class="text-center">
					<button class="btn btn-outline" onclick={loadMore}>
						Afficher plus ({occurrences.length - displayCount} restantes)
					</button>
				</div>
			{/if}
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
	defaultMode="register"
/>
