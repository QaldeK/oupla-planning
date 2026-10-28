<script lang="ts">
	import { Drawer, DrawerContent, DrawerOverlay } from "@abhivarde/svelte-drawer";
	import {
		CalendarPlus,
		Code,
		Download,
		LogOut,
		MessageSquareWarning,
		Moon,
		Settings,
		Sun,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { Toaster, toast } from "svelte-sonner";
	import { afterNavigate, goto } from "$app/navigation";
	import AccountModal from "$lib/components/auth/AccountModal.svelte";
	import AuthWall from "$lib/components/auth/AuthWall.svelte";
	import CommentSection from "$lib/components/CommentSection.svelte";
	import AccountBenefitsSidebar from "$lib/components/homepage/AccountBenefitsSidebar.svelte";
	import IdentifyModal from "$lib/components/IdentifyModal.svelte";
	import MobileHeader from "$lib/components/MobileHeader.svelte";
	import NetworkIndicator from "$lib/components/NetworkIndicator.svelte";
	import Modal from "$lib/components/ui/Modal.svelte";
	import { setSubscriptionObserver } from "$lib/data/collections";
	import { m } from "$lib/paraglide/messages.js";
	import { getLocale } from "$lib/paraglide/runtime.js";
	import { pb } from "$lib/pocketbase/pb";
	import { setActivePlanningToken } from "$lib/services/activePlanningContext";
	import { commentStateStore } from "$lib/stores/commentStateStore.svelte";
	import { drawerStore } from "$lib/stores/drawerStore.svelte";
	import { guestStateStore } from "$lib/stores/guestStateStore.svelte";
	import { mediaQuery } from "$lib/stores/mediaQuery.svelte";
	import { modalStore } from "$lib/stores/modalStore.svelte";
	import { networkStore } from "$lib/stores/networkStore.svelte";
	import { planningStore } from "$lib/stores/planningStore.svelte";
	import { installStore } from "$lib/stores/installStore.svelte";
	import { swUpdateStore } from "$lib/stores/swUpdateStore.svelte";
	import { userStore } from "$lib/stores/userStore.svelte";
	import { recoverAllData } from "$lib/utils/recover";
	import { version } from "../../package.json" with { type: "json" };

	let { children } = $props();

	import { page } from "$app/state";

	// Les souscriptions realtime de `data/` remontent par observer : c'est ici, au
	// sommet, que la réaction rejoint le store. Branché au montage du layout, avant
	// toute activation de planning — la valeur est réaffectable, donc idempotent.
	setSubscriptionObserver((hasActiveSubscription) =>
		networkStore.setHasActiveSubscription(hasActiveSubscription),
	);

	// Mur d'authentification : app installée (standalone) sans session. isReady
	// évite tout flash de mur pendant la restauration d'une session valide au
	// boot — rien ne s'affiche tant que l'initialisation n'est pas terminée.
	const authWallActive = $derived(
		installStore.isInstalled && userStore.isReady && !userStore.isLoggedIn,
	);

	// Layout-driven : observer page.params.token pour activer/désactiver le planning
	$effect(() => {
		const token = page.params.token as string | undefined;

		// Détecter si on est sur la page archive pour passer le bon dateFilter
		const isArchivePage = page.url.pathname.includes("/archive");
		const dateFilter = isArchivePage ? "past" : "future";

		// Derrière le mur, aucune surface n'est montée : activer un planning y
		// ouvrirait des souscriptions realtime et écrirait en localMeta pour un
		// utilisateur encore sans session. La dérivation est réactive : l'effet
		// rejoue quand le mur se lève.
		if (authWallActive) {
			setActivePlanningToken(undefined);
			planningStore.setActiveToken(undefined, dateFilter);
			return;
		}

		setActivePlanningToken(token);
		planningStore.setActiveToken(token, dateFilter);
	});

	let showAccountModal = $state(false);
	let showLogoutConfirm = $state(false);

	async function confirmLogout() {
		showLogoutConfirm = false;
		await userStore.logout();
	}
	// Clé forçant la destruction/reconstruction du Drawer après navigation,
	// pour éviter un drawer fantôme quand la librairie @abhivarde/svelte-drawer
	// ne nettoie pas son état interne (visible non réactif).
	let drawerKey = $state(0);

	onMount(() => {
		// Hook de recover : déclenché par error.html (?recover=1) ou saisie manuelle.
		// error.html tente déjà le clear navigateur avant redirect vers `/` (sans le
		// paramètre). Ce hook est un filet pour le cas où ce script a échoué ou où
		// l'utilisateur a saisi l'URL directement. Dans tous les cas, on relance un
		// nettoyage complet puis on redirect vers `/` (recoverAllData inclus).
		const params = new URLSearchParams(window.location.search);
		if (params.get("recover") === "1") {
			// Fire-and-forget : recoverAllData ne devrait jamais rejeter (chaque step
			// catche ses propres erreurs), mais on ajoute un .catch défensif pour
			// éviter une unhandled rejection pendant le boot — exactement le scénario
			// qu'on cherche à résoudre.
			recoverAllData().catch((err) => console.error("[layout] recoverAllData failed:", err));
			return;
		}

		// onMount ne peut pas être async (il pourrait retourner un cleanup) : on
		// enveloppe la séquence de boot dans une IIFE async.
		//
		// ORDRE IMPORTANT : loadGuestState() doit être AWAIT avant userStore.init(),
		// car userStore.init() subscribe pb.authStore.onChange qui peut déclencher
		// authTransition.transitionToAuth() — et la transition a besoin du snapshot
		// guest. loadGuestState() résout à la première émission du liveQuery Dexie,
		// garantissant que guestStates est peuplé avant qu'un onChange puisse fire.
		// Pour les auth users, on skip le chargement (pas d'état guest à charger).
		//
		// Chaque étape est isolée : un store qui échoue ne doit pas empêcher les
		// autres de s'initialiser. `userStore.isReady` gate le mur
		// d'authentification — un init interrompu le laisserait indéfini, et
		// l'app installée s'ouvrirait sans mur. Il est donc posé même en échec,
		// et l'utilisateur voit une erreur plutôt qu'une app à moitié initialisée.
		(async () => {
			let bootFailed = false;

			try {
				if (!pb.authStore.isValid) {
					await guestStateStore.loadGuestState();
				}
			} catch (err) {
				bootFailed = true;
				console.error("[boot] loadGuestState failed:", err);
			}

			const steps: Array<[string, () => unknown]> = [
				["userStore", () => userStore.init()],
				["mediaQuery", () => mediaQuery.init()],
				["installStore", () => installStore.init()],
				["swUpdateStore", () => swUpdateStore.init()],
				["commentStateStore", () => commentStateStore.start()],
			];
			for (const [name, run] of steps) {
				try {
					await run();
				} catch (err) {
					bootFailed = true;
					console.error(`[boot] ${name} init failed:`, err);
					if (name === "userStore") userStore.isReady = true;
				}
			}

			if (bootFailed) toast.error(m.error_description_500());
		})();
	});

	// Notification de mise à jour de la PWA (Service Worker en attente d'activation).
	// Toast persistant (duration: Infinity) en top-center ; l'utilisateur déclenche
	// le reload via l'action. L'ID fixe évite tout doublon si l'$effect se rejoue.
	$effect(() => {
		if (!swUpdateStore.hasUpdate) return;
		toast(m.update_available(), {
			id: "sw-update",
			position: "top-center",
			duration: Infinity,
			action: {
				label: m.update_action(),
				onClick: () => swUpdateStore.applyUpdate(),
			},
		});
	});

	// Fermer le drawer des commentaires lors des changements de route ;
	// la clé drawerKey force le Drawer à être détruit/reconstruit, ce qui
	// évite un drawer fantôme (visible non réactif dans la librairie).
	afterNavigate(() => {
		drawerStore.close();
		drawerKey += 1;
	});

	$effect(() => {
		document.documentElement.setAttribute("data-theme", userStore.appPreferences.theme);
	});

	// `getLocale()` n'est pas réactif au sens Svelte 5 (la stratégie cookie recharge
	// le document au changement de locale), donc cet $effect se contente de pousser
	// la locale résolue vers <html lang> au montage — suffisant pour les lecteurs
	// d'écran et la césure navigateur. `app.html` garde `lang="fr"` en valeur
	// statique initiale (pas de SSR — ADR 0004).
	$effect(() => {
		document.documentElement.lang = getLocale();
	});

	function toggleTheme() {
		const newTheme = userStore.appPreferences.theme === "my" ? "nord-dark" : "my";
		userStore.setTheme(newTheme);
	}
</script>

{#if authWallActive}
	<!-- Mur d'authentification : remplace toute surface de l'app installée
	     (vues participant et admin incluses) tant qu'aucune session n'existe. -->
	<AuthWall />
{:else}
	<div class="drawer lg:drawer-open min-h-dvh">
		<input
			id="main-drawer"
			type="checkbox"
			class="drawer-toggle"
			checked={modalStore.drawerNavOpen}
			onchange={() => modalStore.toggleNavDrawer()}
		/>
		<div class="drawer-content flex flex-col">
			<!-- Header mobile rétractable -->
			<MobileHeader />

			<!-- Contenu principal -->
			<main class="bg-base-200 flex-1 p-2 md:p-4 lg:p-8">
				{@render children()}
			</main>

			<!-- Footer -->
			<footer class="border-base-300 mt-auto border-t py-4">
				<div class="flex flex-col items-center justify-center gap-4">
					<!-- Bouton d'installation PWA (mobile uniquement) ; gate terminal inclus -->
					{#if installStore.promptGateClear && installStore.canInstall}
						<button
							class="btn btn-soft btn-primary btn-sm lg:hidden"
							onclick={() => installStore.install()}
							aria-label={m.common_install_app()}
						>
							<Download size={16} />
							<span>{m.common_install_app()}</span>
						</button>
					{/if}

					<!-- Links existants -->
					<div class="text-base-content/60 flex items-center justify-center gap-2">
						<a
							href="https://github.com/QaldeK/oupla-planning/"
							target="_blank"
							rel="noopener noreferrer"
							class="hover:text-primary flex items-center gap-2 transition"
						>
							<Code size={20} /> v{version}
						</a>
						<span class="opacity-40">·</span>
						<a
							href="https://github.com/QaldeK/oupla-planning/blob/main/CHANGELOG.md"
							target="_blank"
							rel="noopener noreferrer"
							class="hover:text-primary transition"
						>
							{m.nav_changelog()}
						</a>
						<span class="opacity-40">·</span>
						<a
							href="https://www.gnu.org/licenses/agpl-3.0.html"
							target="_blank"
							rel="noopener noreferrer"
							class="hover:text-primary transition"
						>
							AGPL v3
						</a>
						<span class="opacity-40">·</span>
						<a href="/legal" class="hover:text-primary transition">
							{m.nav_legal()}
						</a>
					</div>
				</div>
			</footer>
		</div>

		<!-- Sidebar -->
		<div class="drawer-side">
			<label for="main-drawer" class="drawer-overlay" aria-label={m.nav_close_menu()}></label>
			<aside class="bg-base-300 z-50 flex min-h-dvh w-80 max-w-[85vw] flex-col p-4 pt-14 lg:pt-4">
				<!-- Logo/Titre -->
				<div class="mb-6 flex items-center justify-between">
					<a href="/" class="flex items-center gap-2">
						<img src="/favicon.svg" alt="Oupla planning" class="size-8" />
						<h1 class="text-lg font-bold sm:text-xl">Oupla Planning</h1>
					</a>

					<!-- Toggle thème -->
					<label class="swap swap-rotate btn btn-ghost btn-circle sm:btn-sm">
						<input
							type="checkbox"
							checked={userStore.appPreferences.theme === "nord-dark"}
							onchange={toggleTheme}
						/>
						<Sun class="swap-off" size={20} />
						<Moon class="swap-on" size={20} />
					</label>
				</div>

				<!-- Navigation -->
				<nav class="mb-4 flex-1 space-y-2">
					<a
						href="/new"
						class="btn btn-primary w-full justify-start"
						onclick={() => modalStore.closeNavDrawer()}
					>
						<CalendarPlus size={18} />
						{m.nav_new_planning()}
					</a>

					<!-- Plannings sauvegardés - UNIQUEMENT si connecté -->
					{#if userStore.isLoggedIn && planningStore.activeMasters.length > 0}
						<div class="divider"></div>
						<p class="text-base-content/60 px-2 text-sm font-semibold">
							{m.nav_saved_plannings()}
						</p>
						<div class="space-y-2">
							{#each planningStore.activeMasters.filter((m) => !m.participants.some((p) => p.userId === userStore.pbUser?.id && p.hasQuit)) as master (master.id)}
								<button
									class="btn w-full justify-start {planningStore.activeMasterId === master.id
										? 'ring-primary ring-2'
										: ''}"
									onclick={() => {
										modalStore.closeNavDrawer();
										goto(`/p/${master.participantToken}`);
									}}
								>
									<span class="truncate">{master.title}</span>
									<div class="ms-auto flex items-center gap-1">
										{#if commentStateStore.getUnreadCount(master.id) > 0}
											<div class="bg-info/20 rounded-full">
												<MessageSquareWarning size={20} class="p-1 opacity-70" />
											</div>
										{/if}
										{#if master.adminToken}
											<span class="badge badge-primary badge-xs">{m.home_badge_admin()}</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}
					{#if userStore.isLoggedIn && planningStore.deletedMasters.length > 0}
						<div class="divider"></div>
						<p class="text-base-content/50 px-2 text-sm font-semibold">
							{m.nav_deleted_plannings()}
						</p>
						<div class="space-y-1">
							{#each planningStore.deletedMasters as master (master.id)}
								<button
									class="btn btn-sm btn-ghost w-full justify-start"
									onclick={() => {
										modalStore.closeNavDrawer();
										goto(`/p/${master.participantToken}`);
									}}
								>
									<span class="text-base-content/70 truncate line-through">{master.title}</span>
									<span class="badge badge-error badge-soft badge-xs ms-auto"
										>{m.nav_deleted_badge()}</span
									>
								</button>
							{/each}
						</div>
						<button
							class="btn btn-ghost btn-sm mt-1 w-full text-xs"
							onclick={() => planningStore.cleanDeletedPlannings()}
						>
							<Trash2 size={14} />
							{m.nav_clean_deleted()}
						</button>
					{/if}
				</nav>

				<!-- Footer sidebar -->
				<div>
					{#if userStore.isLoggedIn && userStore.pbUser}
						<!-- User authentifié → lien vers /settings + déconnexion -->
						<div class="flex gap-2">
							<button
								onclick={() => {
									modalStore.closeNavDrawer();
									goto("/settings");
								}}
								class="btn btn-accent flex flex-1 items-center justify-start gap-2 text-left"
							>
								<Settings class="size-5 opacity-70" />
								<div class="flex flex-col items-start py-0.5 text-left">
									<div class="text-sm font-medium">{userStore.pbUser.name}</div>
									<div class="text-base-content/60 text-xs">
										{userStore.pbUser.email}
									</div>
								</div>
							</button>

							<button
								class="btn btn-square btn-ghost"
								onclick={() => (showLogoutConfirm = true)}
								aria-label={m.nav_logout()}
							>
								<LogOut size={18} />
							</button>
						</div>
					{:else}
						<!-- Guest : Alerte avantages compte + bouton connexion -->
						<div class="flex flex-1 py-4">
							<AccountBenefitsSidebar />
						</div>
						<button
							class="btn btn-accent w-full justify-start"
							onclick={() => (showAccountModal = true)}
						>
							{m.nav_sign_in()}
						</button>
					{/if}
				</div>
			</aside>
		</div>
	</div>

	<IdentifyModal
		open={userStore.authModal.open}
		masterId={userStore.authModal.masterId}
		existingParticipants={userStore.authModal.existingParticipants || []}
		initialName={userStore.authModal.initialName}
		hideExistingParticipants={userStore.authModal.hideExistingParticipants}
		currentIdentity={userStore.authModal.currentIdentity}
		onClose={() => (userStore.authModal = { ...userStore.authModal, open: false })}
		onPlanningIdentify={userStore.authModal.onPlanningIdentify}
	/>

	<AccountModal
		bind:open={showAccountModal}
		onClose={() => (showAccountModal = false)}
		onSuccess={() => {
			showAccountModal = false;
		}}
		defaultMode="register"
	/>

	<!-- Confirmation de déconnexion : l'action est destructrice dans tous les
	     contextes (données locales vidées) ; la ligne mur n'apparaît que dans
	     l'app installée, où la déconnexion ramène à l'authentification. -->
	<Modal
		open={showLogoutConfirm}
		onClose={() => (showLogoutConfirm = false)}
		title={m.common_logout_confirm_title()}
		size="sm"
	>
		<div class="space-y-6">
			<div class="space-y-2 text-sm">
				<p>{m.common_logout_confirm_body()}</p>
				{#if installStore.isInstalled}
					<p class="text-warning">{m.settings_logout_wall_hint()}</p>
				{/if}
			</div>
			<div class="flex justify-end gap-2">
				<button class="btn btn-ghost" onclick={() => (showLogoutConfirm = false)}>
					{m.common_cancel()}
				</button>
				<button class="btn btn-error" onclick={confirmLogout}>
					{m.nav_logout()}
				</button>
			</div>
		</div>
	</Modal>

	<!-- Drawer Global pour les Commentaires -->
	{#key drawerKey}
		<Drawer bind:open={drawerStore.open} portal={true} direction="right">
			<DrawerOverlay class="fixed bg-black/40" />
			<DrawerContent
				class="bg-base-100 fixed top-0 right-0 bottom-0 z-50 h-dvh w-dvw shadow-2xl sm:w-120 sm:max-w-[85vw]"
			>
				{#if drawerStore.open}
					<CommentSection />
				{/if}
			</DrawerContent>
		</Drawer>
	{/key}
{/if}

<Toaster
	position="bottom-right"
	toastOptions={{
		classes: {
			error: "border-l-4! border-error!",
			warning: "border-l-4! border-warning!",
			info: "border-l-4! border-info!",
		},
	}}
/>

<NetworkIndicator />
