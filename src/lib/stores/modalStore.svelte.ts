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
		localName: '',
		remoteName: '',
		onBackupAndReplace: async () => {},
		onReplaceOnly: async () => {}
	});

	// Ouvre le modal de collision
	openCollision(options: Omit<CollisionState, 'open'>) {
		this.collision = { open: true, ...options };
	}

	// Ferme le modal de collision
	closeCollision() {
		this.collision.open = false;
	}
}

export const modalStore = new ModalStore();
