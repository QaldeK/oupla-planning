<script lang="ts">
	import { Menu, PanelLeftClose, User } from "@lucide/svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import * as m from "$lib/paraglide/messages.js";
	import { modalStore } from "$lib/stores/modalStore.svelte";
	import { planningStore } from "$lib/stores/planningStore.svelte";
	import { userStore } from "$lib/stores/userStore.svelte";
	import type { PlanningMaster } from "$lib/types/planning.types";

	// État du header
	let isHeaderVisible = $state(true);
	let lastScrollY = $state(0);
	let isScrolling = $state(false);
	let scrollTimeout: ReturnType<typeof setTimeout>;

	// Titre dynamique basé sur la route et le planning actif
	const pathname = $derived($page.url.pathname);
	const master = $derived(planningStore.master as PlanningMaster | null);

	const title = $derived(getTitle(pathname, master));

	function getTitle(path: string, master: PlanningMaster | null): string {
		if (path === "/") return m.nav_home_title();
		if (path === "/new") return m.nav_new_planning();
		if (path.includes("/archive"))
			return master?.title ? `${master.title} (${m.nav_archive_label()})` : m.nav_archive_label();
		if (path.includes("/admin/"))
			return master?.title ? `${master.title} ${m.nav_admin_label()}` : m.nav_admin_label();
		if (path.includes("/p/")) return master?.title || m.nav_default_title();
		return m.nav_home_title();
	}

	// Fonction de gestion du scroll avec requestAnimationFrame
	function handleScroll() {
		if (!isScrolling) {
			isScrolling = true;
			requestAnimationFrame(() => {
				const currentScrollY = window.scrollY;

				// Se rétracte au scroll vers le bas (scrollDown)
				// S'étend au scroll vers le haut (scrollUp)
				if (currentScrollY > lastScrollY && currentScrollY > 60) {
					// Scroll vers le bas et au-delà de 60px
					isHeaderVisible = false;
				} else if (currentScrollY < lastScrollY) {
					// Scroll vers le haut
					isHeaderVisible = true;
				}

				lastScrollY = currentScrollY;
				isScrolling = false;
			});
		}

		// Reset le timeout pour détecter la fin du scroll
		clearTimeout(scrollTimeout);
		scrollTimeout = setTimeout(() => {
			isScrolling = false;
		}, 100);
	}

	$effect(() => {
		lastScrollY = window.scrollY;
		window.addEventListener("scroll", handleScroll, { passive: true });

		return () => {
			window.removeEventListener("scroll", handleScroll);
			clearTimeout(scrollTimeout);
		};
	});
</script>

<!-- Header fixe avec z-index inférieur aux modals (z-40) -->
<header
	class={[
		"fixed top-0 right-0 left-0 z-40 transition-transform duration-300 lg:hidden",
		isHeaderVisible && "translate-y-0",
		!isHeaderVisible && "-translate-y-full",
	]}
>
	<nav class="bg-base-100/95 border-base-300 border-b px-4 py-2 shadow-sm backdrop-blur">
		<div class="flex items-center gap-2">
			<!-- Bouton Menu -->
			<button
				class="btn btn-ghost btn-sm btn-circle p-0.5"
				onclick={() => modalStore.toggleNavDrawer()}
				aria-label={m.nav_open_menu()}
			>
				{#if modalStore.drawerNavOpen}
					<PanelLeftClose />
				{:else}
					<Menu />
				{/if}
			</button>

			<!-- Bouton Home -->
			<a href="/" class="btn btn-ghost btn-sm btn-circle p-0.5" aria-label={m.nav_home_label()}>
				<img src="/favicon.svg" alt="Oupla" />
			</a>

			<!-- Titre dynamique -->
			<span class="flex-1 truncate text-base font-medium">
				{title}
			</span>

			<!-- Bouton User -->
			{#if userStore.isLoggedIn}
				<button
					class="btn btn-ghost btn-sm btn-circle"
					onclick={() => goto("/settings")}
					aria-label={m.nav_profile()}
				>
					<User size={18} />
				</button>
			{/if}
		</div>
	</nav>
</header>

<!-- Espaceur pour compenser le header fixe quand visible -->
<div class={["h-14 lg:hidden", !isHeaderVisible && "opacity-0"]}></div>
