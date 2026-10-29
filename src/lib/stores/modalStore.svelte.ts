/**
 * modalStore - Gestion centralisée des modals globaux
 *
 * Version minimale (Phase 1) : CollisionModal uniquement
 */

export interface CollisionState {
	open: boolean;
	localName: string;
	remoteName: string;
	onBackupAndReplace: () => Promise<void>;
	onReplaceOnly: () => Promise<void>;
}

class ModalStore {
	// Collision modal
	collision = $state<CollisionState>({
		open: false,
		localName: "",
		remoteName: "",
		onBackupAndReplace: async () => {},
		onReplaceOnly: async () => {},
	});

	// Navigation drawer (sidebar mobile)
	drawerNavOpen = $state(false);

	// Modal « Rejoindre un planning » (sidebar + page home)
	joinPlanningOpen = $state(false);

	// Ouvre le modal de collision
	openCollision(options: Omit<CollisionState, "open">) {
		this.collision = { open: true, ...options };
	}

	// Ferme le modal de collision
	closeCollision() {
		this.collision.open = false;
	}

	// Ouvre le drawer de navigation
	openNavDrawer() {
		this.drawerNavOpen = true;
	}

	// Ferme le drawer de navigation
	closeNavDrawer() {
		this.drawerNavOpen = false;
	}

	// Toggle le drawer de navigation
	toggleNavDrawer() {
		this.drawerNavOpen = !this.drawerNavOpen;
	}

	// Ouvre le modal « Rejoindre un planning »
	openJoinPlanning() {
		this.joinPlanningOpen = true;
	}

	// Ferme le modal « Rejoindre un planning »
	closeJoinPlanning() {
		this.joinPlanningOpen = false;
	}
}

export const modalStore = new ModalStore();
