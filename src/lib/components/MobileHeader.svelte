<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { CalendarPlus, User } from 'lucide-svelte';
	import { userStore } from '$lib/stores/userStore.svelte';

	// État du header
	let isHeaderVisible = $state(true);
	let lastScrollY = $state(0);
	let isScrolling = $state(false);
	let scrollTimeout: ReturnType<typeof setTimeout>;

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

	// Ouvrir le modal d'identification
	function openUserModal() {
		userStore.authModal = {
			open: true,
			mode: userStore.globalProfile ? 'edit-global' : 'homepage'
		};
	}

	onMount(() => {
		lastScrollY = window.scrollY;
		window.addEventListener('scroll', handleScroll, { passive: true });
	});

	onDestroy(() => {
		window.removeEventListener('scroll', handleScroll);
		clearTimeout(scrollTimeout);
	});
</script>

<!-- Header fixe avec z-index inférieur aux modals (z-40) -->
<header
	class="fixed top-0 right-0 left-0 z-40 transition-transform duration-300 lg:hidden"
	class:translate-y-0={isHeaderVisible}
	class:-translate-y-full={!isHeaderVisible}
>
	<nav class="bg-base-100/95 border-base-300 border-b px-4 py-2 shadow-sm backdrop-blur">
		<div class="flex items-center gap-2">
			<!-- Bouton +Planning -->
			<a href="/new" class="btn btn-primary btn-sm" aria-label="Créer un nouveau planning">
				<CalendarPlus size={18} />
				<span>+Planning</span>
			</a>

			<!-- Bouton User -->
			<button
				class="btn btn-ghost btn-sm"
				onclick={openUserModal}
				aria-label="Ouvrir le profil utilisateur"
			>
				<User size={18} />
			</button>
		</div>
	</nav>
</header>

<!-- Espaceur pour compenser le header fixe quand visible -->
<div class="h-14 lg:hidden" class:opacity-0={!isHeaderVisible}></div>
