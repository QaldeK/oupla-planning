<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { untrack } from 'svelte';
	import { on } from 'svelte/events';
	import PlanningForm, { type PlanningFormData } from '$lib/components/PlanningForm.svelte';
	import { AdminSkeleton } from '$lib/components/ui/skeletons';
	import { updatePlanningWithOccurrences } from '$lib/services/planningActions';
	import {
		acquireLock,
		heartbeatLock,
		releaseLock,
		getLock,
		LockHeldError,
		type LockInfo
	} from '$lib/services/lockService';
	import { planningStore } from '$lib/stores/planningStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { guestStateStore } from '$lib/stores/guestStateStore.svelte';
	import { authTransition } from '$lib/stores/authTransition.svelte';
	import { networkStore } from '$lib/stores/networkStore.svelte';
	import { pb } from '$lib/pocketbase/pb';
	import { fade } from 'svelte/transition';
	import { format } from 'date-fns';

	import QuitReturnModal from '$lib/components/QuitReturnModal.svelte';
	import LockOverlay from '$lib/components/admin/LockOverlay.svelte';
	import NetworkAlert from '$lib/components/NetworkAlert.svelte';
	import { ArrowLeft, Calendar, CalendarCog, RefreshCw, Trash2, WifiOff } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	let token = $derived($page.params.token as string);
	let master = $derived(planningStore.master);
	let occurrences = $derived(planningStore.occurrences);
	let isLoading = $derived(planningStore.isLoading);
	let isSubmitting = $state(false);

	// === Verrouillage d'édition (R5.3) ===
	// lockState pilote l'affichage de l'overlay : 'editing' = on détient le lock,
	// 'locked-by-other' = un autre admin édite (overlay read-only), 'lock-lost' =
	// on a perdu le lock (inactivité / retour d'arrière-plan). La reprise après
	// blocage est manuelle (bouton « Réessayer » de l'overlay), pas de polling.
	let lockState = $state<'acquiring' | 'editing' | 'locked-by-other' | 'lock-lost'>('acquiring');
	let heldBy = $state<LockInfo | null>(null);
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	// TTL 5 min côté serveur — le heartbeat (2 min) le rafraîchit avant expiration.
	const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

	const lockReturnUrl = $derived(master ? `/p/${master.participantToken}` : '/');

	// Quand un autre admin édite ou qu'on a perdu la main, on rend le formulaire
	// inert (non-interactif, retiré du tab order, masqué de l'a11y tree). C'est le
	// pendant « lecture seule » de l'overlay, qui ne bloquait que la souris.
	const isFormReadOnly = $derived(lockState === 'locked-by-other' || lockState === 'lock-lost');

	function stopHeartbeat() {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
	}

	/**
	 * Tente d'acquérir le lock. En cas de succès démarre le heartbeat ;
	 * en cas de conflit (LockHeldError) passe en overlay read-only.
	 *
	 * `isStale` court-circuite tout effet de bord après l'await : si l'$effect
	 * propriétaire a été teardown entre-temps (navigation, master cleared), on
	 * ne démarre ni le heartbeat ni l'overlay. Sans cette garde, un acquire
	 * résolvant après le teardown recréerait un interval heartbeat orphelin qui
	 * re-acquerrait le lock sur une row vidée → lock zombie.
	 */
	async function acquireOrBlock(
		masterId: string,
		adminToken: string,
		userId: string,
		name: string | undefined,
		isStale: () => boolean
	): Promise<void> {
		try {
			const info = await acquireLock(masterId, adminToken, userId, name);
			if (isStale()) return;
			heldBy = info;
			lockState = 'editing';
			startHeartbeat(masterId, adminToken, userId, name);
		} catch (err) {
			if (isStale()) return;
			if (err instanceof LockHeldError) {
				heldBy = err.info;
				lockState = 'locked-by-other';
			} else {
				console.error('[lock] acquire failed:', err);
				// Dégradation gracieuse : on laisse l'admin éditer (le formulaire reste
				// actif en 'acquiring'), mais on le prévient qu'il n'est pas protégé.
				toast.warning(
					'Verrouillage indisponible (réseau) — édition non protégée contre les conflits.'
				);
			}
		}
	}

	function startHeartbeat(
		masterId: string,
		adminToken: string,
		userId: string,
		name: string | undefined
	): void {
		stopHeartbeat();
		heartbeatTimer = setInterval(() => {
			heartbeatLock(masterId, adminToken, userId, name).catch((err) => {
				if (err instanceof LockHeldError) {
					// Le lock a été repris par un autre admin pendant notre édition :
					// on bascule en read-only. La reprise est manuelle (bouton
					// « Réessayer » de l'overlay).
					heldBy = err.info;
					lockState = 'locked-by-other';
					stopHeartbeat();
				} else {
					console.error('[lock] heartbeat failed:', err);
				}
			});
		}, HEARTBEAT_INTERVAL_MS);
	}

	/**
	 * Reprendre l'édition depuis un overlay (clic « Réessayer » /
	 * « Poursuivre l'édition »). On recharge la page plutôt que de
	 * ré-acquérir le lock silencieusement : garantit que le formulaire
	 * reparte du master serveur courant. Sans ça, l'admin reprendrait sur
	 * un snapshot stale et écraserait les modifs d'un autre admin au save
	 * (`master.updated` est rafraîchi par realtime, donc l'OCC ne voit pas
	 * le conflit). Le `$effect` lifecycle ré-acquiert le lock au mount.
	 */
	function handleLockRetry(): void {
		window.location.reload();
	}

	// Lifecycle du lock : démarre au chargement du master, nettoie au destroy.
	// Dépend de master?.id (pas de l'objet master) pour ne pas re-déclencher à
	// chaque update realtime, et de userStore.isReady pour s'assurer que
	// l'identité (guest) est disponible.
	$effect(() => {
		const masterId = master?.id;
		const ready = userStore.isReady;
		if (!masterId || !ready) return;

		const adminToken = token;
		// Identité lue ponctuellement : on ne veut pas redémarrer le cycle lock
		// quand l'état guest évolue (markFetched, etc.) pendant l'édition.
		const identity = untrack(() => {
			if (userStore.pbUser) return { id: userStore.pbUser.id, name: userStore.pbUser.name };
			const guest = guestStateStore.getGuestIdentity(masterId);
			return guest ? { id: guest.id, name: guest.name } : null;
		});
		if (!identity) return;
		const userId = identity.id;

		// Garde d'annulation : invalide toute résolution async (acquire, check de
		// visibilité) dont l'$effect aurait été teardown entre-temps. Sans elle, un
		// acquire résolvant après le teardown redémarrerait un heartbeat orphelin
		// → lock zombie (le heartbeat re-acquiert sur une row vidée par le release).
		let cancelled = false;

		lockState = 'acquiring';
		acquireOrBlock(masterId, adminToken, userId, identity.name, () => cancelled);

		// pagehide : release via fetch keepalive — releaseLock (pb.send) ne survit
		// pas à la fermeture de l'onglet, keepalive permet à la requête de partir.
		const releaseOnHide = () => {
			const url = `${pb.baseUrl}/api/unlock/${masterId}?_token=${encodeURIComponent(adminToken)}`;
			fetch(url, {
				method: 'POST',
				keepalive: true,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ lockedBy: userId })
			}).catch(() => {});
		};

		// visibilitychange (visible) : vérifier qu'on détient toujours le lock.
		// Pas de release sur background (le TTL gère l'absence prolongée).
		const checkVisibility = () => {
			if (document.visibilityState !== 'visible') return;
			if (lockState !== 'editing') return;
			getLock(masterId, adminToken)
				.then((current) => {
					if (cancelled) return;
					const lost =
						!current ||
						current.lockedBy !== userId ||
						Date.now() > new Date(current.expiresAt).getTime();
					if (lost) {
						stopHeartbeat();
						lockState = 'lock-lost';
					}
				})
				.catch((err) => console.error('[lock] visibility check failed:', err));
		};

		const offPageHide = on(window, 'pagehide', releaseOnHide);
		const offVisChange = on(document, 'visibilitychange', checkVisibility);

		return () => {
			cancelled = true;
			stopHeartbeat();
			offPageHide();
			offVisChange();
			// Best-effort pour le cas navigation interne SvelteKit (sans unload).
			// Le pagehide couvre la fermeture d'onglet via fetch keepalive.
			releaseLock(masterId, adminToken, userId);
		};
	});

	// === Détection retour après quit ===
	let showQuitReturnModal = $state(false);

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

	// Logique de redirection admin → participant
	$effect(() => {
		if (!master) return;

		// Guard : ne rien faire pendant la transition guest → auth, au même
		// titre que sur /p/[token]. Sans ça, l'$effect verrait un état
		// intermédiaire (master cleared, participant pas encore posé).
		if (authTransition.isTransitioning) return;

		// PRIORITÉ : retour après quit
		if (hasQuitThisPlanning) {
			if (!showQuitReturnModal) showQuitReturnModal = true;
			return;
		}

		// Guest non identifié : l'identification se fait sur /p (avec l'adminToken
		// pour préserver isAdmin et le bouton « Configuration »), puis l'user
		// revient manuellement sur l'admin.
		if (
			userStore.isReady &&
			!userStore.isLoggedIn &&
			!userStore.pbUser &&
			!guestStateStore.getGuestIdentity(master.id)
		) {
			goto(`/p/${token}`);
			return;
		}

		// La page admin requiert l'adminToken (64 chars). Un participantToken (32 chars)
		// chargerait le master (cache Dexie) mais ferait échouer les routes /api/lock.
		if (token.length !== 64) {
			goto(`/p/${token}`);
			return;
		}

		// Si l'utilisateur n'a pas les droits admin sur ce planning, rediriger
		if (!planningStore.hasAdminAccess(master.id)) {
			goto(`/p/${master.participantToken}`);
		}
	});

	async function handleUpdatePlanning(data: PlanningFormData) {
		if (!master) return;

		try {
			isSubmitting = true;
			await updatePlanningWithOccurrences(
				master.id,
				data,
				token,
				master.participantToken as string,
				master.updated // Optimistic locking
			);
			toast.success('Planning mis à jour avec succès');

			// Le save libère le lock : release explicite avant la navigation
			// (l'$effect teardown relancera aussi releaseLock, idempotent côté serveur).
			const identityId = userStore.pbUser?.id ?? guestStateStore.getGuestIdentity(master.id)?.id;
			if (identityId) {
				await releaseLock(master.id, token, identityId);
			}

			// Rediriger vers la vue participant après sauvegarde réussie
			await goto(`/p/${master.participantToken}`);
		} catch (error) {
			console.error('Update error:', error);
			toast.error('Erreur lors de la mise à jour');
		} finally {
			isSubmitting = false;
		}
	}

	// Identifier les dates futures qui ont des données (réponses ou commentaires).
	// Filtre sur date >= today pour rester cohérent avec `activeDates` (futur
	// uniquement) et `updatePlanningWithOccurrences` (qui ne touche pas le passé).
	const today = format(new Date(), 'yyyy-MM-dd');
	const datesWithData = $derived(
		occurrences
			.filter((o) => {
				const d = o.date.split(' ')[0].split('T')[0];
				return d >= today && (o.responses?.length > 0 || o.comments?.length > 0);
			})
			.map((o) => o.date.split(' ')[0].split('T')[0])
	);

	// Identifier les dates futures qui ont des tâches spécifiques (non héritées)
	const datesWithSpecificTasks = $derived(
		occurrences
			.filter((o) => {
				const d = o.date.split(' ')[0].split('T')[0];
				return d >= today && o.tasks && o.tasks.length > 0;
			})
			.map((o) => o.date.split(' ')[0].split('T')[0])
	);
</script>

<svelte:head>
	<title>{master?.title || 'Planning'} - Admin</title>
</svelte:head>

{#if isLoading}
	<AdminSkeleton />
{:else if master}
	<NetworkAlert />
	<div class="mx-auto max-w-6xl py-2 md:px-4" in:fade={{ duration: 300 }} inert={isFormReadOnly}>
		<div class="mb-4 flex justify-start">
			<a href="/p/{master.participantToken}" class="btn btn-ghost sm:btn-sm gap-2">
				<ArrowLeft size={18} />
				Retour au planning
			</a>
		</div>
		<!-- Contenu principal (Formulaire uniquement) -->
		<div class="mb-6 flex flex-1 items-center gap-5">
			<div class="bg-primary/10 self-start rounded-2xl p-2 sm:p-4">
				<CalendarCog class="text-primary size-7 sm:size-6" />
			</div>
			<div class="flex-1 space-y-1">
				<h3 class="font-semibold sm:text-xl">
					Configuration {'de ' + master?.title || 'du Planning'}
				</h3>
				<p class="text-base-content/50 text-sm">
					Modifiez les paramètres du planning. Les changements seront propagés aux occurrences.
				</p>
			</div>
		</div>
		<PlanningForm
			{master}
			onSubmit={handleUpdatePlanning}
			bind:isSubmitting
			{datesWithData}
			{datesWithSpecificTasks}
			occurrences={planningStore.futureOccurrences}
		/>
	</div>

	{#if lockState === 'locked-by-other'}
		<LockOverlay
			mode="locked-by-other"
			lockInfo={heldBy}
			returnUrl={lockReturnUrl}
			onRetry={handleLockRetry}
		/>
	{:else if lockState === 'lock-lost'}
		<LockOverlay mode="lock-lost" returnUrl={lockReturnUrl} onRetry={handleLockRetry} />
	{/if}
{:else if !networkStore.online}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div class="alert alert-error alert-soft">
				<WifiOff size={24} />
				<div>
					<h3 class="font-bold">Connexion impossible</h3>
					<div class="text-xs">
						<p>Vous êtes hors ligne. Vérifiez votre connexion internet.</p>
					</div>
				</div>
			</div>
			<button class="btn btn-outline mt-4 gap-2" onclick={() => window.location.reload()}>
				<RefreshCw size={16} />
				Réessayer
			</button>
		</div>
	</div>
{:else if planningStore.error?.type === 'network'}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div class="alert alert-error alert-soft">
				<WifiOff size={24} />
				<div>
					<h3 class="font-bold">Connexion impossible</h3>
					<div class="text-xs">
						<p>Le serveur est inaccessible. Réessayez dans quelques instants.</p>
					</div>
				</div>
			</div>
			<button class="btn btn-outline mt-4 gap-2" onclick={() => window.location.reload()}>
				<RefreshCw size={16} />
				Réessayer
			</button>
		</div>
	</div>
{:else if planningStore.error?.type === 'deleted'}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div
				class="bg-warning/10 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full p-4"
			>
				<Trash2 size={40} class="text-warning" />
			</div>
			<h2 class="mb-3 text-3xl font-semibold">Planning supprimé</h2>
			<p class="text-base-content/60 mb-8">Ce planning a été supprimé par son administrateur.</p>
			<a href="/" class="btn btn-primary btn-wide">Retour à l'accueil</a>
		</div>
	</div>
{:else}
	<div class="flex min-h-[50vh] items-center justify-center p-4">
		<div class="max-w-sm text-center">
			<div
				class="bg-error/10 text-error mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full p-4"
			>
				<Calendar size={40} />
			</div>
			<h2 class="mb-3 text-3xl font-semibold">Introuvable</h2>
			<p class="text-base-content/60 mb-8">
				Le lien admin est invalide ou le planning a été supprimé.
			</p>
			<a href="/" class="btn btn-primary btn-wide">Retour à l'accueil</a>
		</div>
	</div>
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
