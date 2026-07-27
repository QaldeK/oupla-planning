 <script lang="ts">
import { LogIn } from "@lucide/svelte";
import { toast } from "svelte-sonner";
import { goto } from "$app/navigation";
import Modal from "$lib/components/ui/Modal.svelte";
import { updateParticipant } from "$lib/services/planningActions";
import { guestStateStore } from "$lib/stores/guestStateStore.svelte";
import * as m from "$lib/paraglide/messages.js";
import { userStore } from "$lib/stores/userStore.svelte";
import type { PlanningMaster } from "$lib/types/planning.types";

interface Props {
	open: boolean;
	onClose: () => void;
	master: PlanningMaster;
	token: string;
	/** ID du participant quit à restaurer */
	quitParticipantId: string;
	/** Callback après rejoindre réussi */
	onRejoined?: () => void;
}

let {
	open = $bindable(false),
	onClose,
	master,
	token,
	quitParticipantId,
	onRejoined
}: Props = $props();

let isSubmitting = $state(false);

/**
 * Rejoindre le planning : retire le flag hasQuit sur le participant.
 * Pour les guests, réinitialise aussi l'identité locale dans localMeta.
 * Après l'appel, pb-sync / realtime mettra Dexie à jour et le
 * $effect de la page détectera le changement.
 */
async function handleRejoin() {
	isSubmitting = true;
	try {
		await updateParticipant(master.id, quitParticipantId, { hasQuit: false }, token);

		// Guest : réinitialiser l'identité locale
		const participant = master.participants.find((p) => p.id === quitParticipantId);
		if (participant && !userStore.isLoggedIn) {
			await guestStateStore.setGuestIdentity(master.id, {
				id: participant.id,
				name: participant.name
			});
		}

		toast.success(m.quit_rejoin_success());
		onRejoined?.();
		open = false;
	} catch (err) {
		console.error("Error rejoining:", err);
		toast.error(m.quit_rejoin_error());
	} finally {
		isSubmitting = false;
	}
}

/**
 * Quitter définitivement : redirige vers l'accueil.
 * Le flag hasQuit: true est déjà côté serveur (inchangé).
 */
function handleDefinitiveQuit() {
	goto("/");
}
</script>

<Modal {open} {onClose} title={m.quit_planning_left()} size="sm" closable={false}>
	<div class="space-y-4">
		<p class="text-sm">{m.quit_previously_left()}</p>
		<p class="text-sm opacity-80">{m.quit_rejoin_prompt()}</p>
		<div class="modal-action">
			<button
				type="button"
				class="btn btn-ghost gap-2"
				onclick={handleDefinitiveQuit}
				disabled={isSubmitting}
			>
				{m.common_cancel()}
			</button>
			<button
				type="button"
				class="btn btn-primary gap-2"
				onclick={handleRejoin}
				disabled={isSubmitting}
			>
				<LogIn size={18} />
				{m.quit_rejoin()}
			</button>
		</div>
	</div>
</Modal>

