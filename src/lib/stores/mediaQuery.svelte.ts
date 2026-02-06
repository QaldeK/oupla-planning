// mediaQuery.svelte.ts
export class MediaQueryStore {
	width = $state(0);
	height = $state(0);

	isMobile = $derived(this.width < 768);
	isTablet = $derived(this.width >= 768 && this.width < 1024);
	isDesktop = $derived(this.width >= 1024);

	init() {
		if (typeof window === 'undefined') return;

		this.width = window.innerWidth;
		this.height = window.innerHeight;

		const updateSize = () => {
			this.width = window.innerWidth;
			this.height = window.innerHeight;
		};

		window.addEventListener('resize', updateSize);
		return () => window.removeEventListener('resize', updateSize);
	}
}

export const mediaQuery = new MediaQueryStore();
