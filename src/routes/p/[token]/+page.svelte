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
	import { pb } from '$lib/pocketbase/pb';
	import { formatDateShort } from '$lib/utils/date';
	import { getRecurrenceLabel } from '$lib/utils/recurrence';
	import {
		ArrowRightFromLine,
		ArrowRightSquare,
		Calendar,
		Clock,
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

	let token = $derived($page.params.token as string);
	let master = $derived(planningStore.master);
	let occurrences = $derived(planningStore.occurrences);
	let isLoading = $derived(planningStore.isLoading);
	let displayCount = $state(10);
	let showShareModal = $state(false);
	let showNotifModal = $state(false);

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

			<!-- Card description -->
			{#if master.description}
				<div class="card card-sm bg-base-200 border-base-content/5 mb-4 border shadow-sm">
					<div class="card-body flex-row items-center gap-5">
						<div class="bg-base-300 text-primary rounded-2xl p-3">
							<InfoIcon size={24} />
						</div>
						<div>
							<div class="text-xs font-bold tracking-wider uppercase opacity-50">Description</div>
							<div class="text-base-content text-base">{master.description}</div>
						</div>
					</div>
				</div>
			{/if}
			<div class="grid gap-6 md:grid-cols-2">
				<!-- Card Récurrence -->
				<div class="card card-sm bg-base-200 border-base-content/5 border shadow-sm">
					<div class="card-body flex-row items-center gap-5">
						<div class="bg-base-300 text-primary rounded-2xl p-3">
							<Calendar size={24} />
						</div>
						<div>
							<div class="text-base font-bold">{getRecurrenceLabel(master.recurrence)}</div>
							{#if master.recurrence.firstDate || master.recurrence.lastDate}
								<div class="text-base-content/70 text-sm">
									{#if master.recurrence.firstDate}
										Du {formatDateShort(master.recurrence.firstDate)}
									{/if}
									{#if master.recurrence.lastDate}
										au {formatDateShort(master.recurrence.lastDate)}
									{/if}
								</div>
							{:else}
								<div class="text-base-content/70 text-sm">
									Du {formatDateShort(master.recurrence.recurrenceDates?.[0] || '')}
									au {formatDateShort(
										master.recurrence.recurrenceDates?.[
											(master.recurrence.recurrenceDates?.length || 1) - 1
										] || ''
									)}
								</div>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<Clock size={16} class="text-primary" />
							<span>{master.defaultStartTime} — {master.defaultEndTime}</span>
						</div>
					</div>
				</div>

				<!-- Card Participants -->
				<div class="card card-sm bg-base-200 border-base-content/5 border shadow-sm">
					<div class="card-body flex-row flex-wrap items-center gap-4">
						<div class="flex items-center gap-2">
							<div class="bg-base-300 text-primary rounded-2xl p-3">
								<Users size={24} />
							</div>
							<div class="text-xs font-bold tracking-wider uppercase opacity-70">
								{master.participants.length} Participants
							</div>
						</div>
						{#if master.participants.length > 0}
							<div class="ms-auto flex flex-wrap justify-end gap-1.5">
								{#each master.participants as p (p.id)}
									<span class="badge badge-sm badge-outline opacity-70">{p.name}</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Card Notifications -->
				<div class="card card-sm bg-base-200 border-base-content/5 border shadow-sm">
					<div class="card-body flex-row items-center gap-5">
						<div class="bg-base-300 text-info rounded-2xl p-3">
							<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bell"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>
						</div>
						<div class="flex-1">
							<div class="text-xs font-bold tracking-wider uppercase opacity-70 mb-1">Notifications</div>
							{#if pb.authStore.isValid && pb.authStore.model?.notificationsSubscription}
								{@const sub = pb.authStore.model.notificationsSubscription}
								<div class="text-sm">
									<p class="font-medium text-base-content/90">
										{#if sub.email && sub.push}
											Email & Push activés
										{:else if sub.email}
											Email uniquement
										{:else if sub.push}
											Push uniquement
										{:else}
											Aucun canal actif
										{/if}
									</p>
									<p class="text-xs opacity-70 leading-tight mt-1">
										{#if sub.reminderDays > 0} Rappels (J-{sub.reminderDays}) {/if}
										{#if sub.missingParticipantsDays > 0} Manques (J-{sub.missingParticipantsDays}) {/if}
									</p>
								</div>
							{:else}
								<p class="text-sm opacity-70 leading-tight">Recevez des alertes (email/mobile) sur ce planning et vos engagements.</p>
							{/if}
						</div>
						<div>
							<button class="btn btn-sm btn-outline" onclick={() => {
								if (!pb.authStore.isValid) {
									userStore.authModal = { open: true, mode: 'homepage' };
								} else {
									showNotifModal = true;
								}
							}}>
								Configurer
							</button>
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
									class="btn btn-primary btn-sm flex-1"
									onclick={() => (showShareModal = true)}
								>
									<Share2 size={18} />
									Partager
								</button>
							{/if}
							<button
								class="btn btn-soft btn-sm ms-auto max-sm:flex-1"
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

<NotificationModal bind:open={showNotifModal} onClose={() => showNotifModal = false} />
