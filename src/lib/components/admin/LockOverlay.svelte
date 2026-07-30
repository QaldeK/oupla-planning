<script lang="ts">
import { AlertTriangle, ArrowLeft, Lock, RotateCcw } from "@lucide/svelte";
import { goto } from "$app/navigation";
import * as m from "$lib/paraglide/messages.js";
import type { LockInfo } from "$lib/services/lockService";

interface Props {
	/** 'locked-by-other' : un autre admin détient le lock (overlay read-only). */
	/** 'lock-lost' : on a perdu le lock (inactivité / retour d'arrière-plan). */
	mode: "locked-by-other" | "lock-lost";
	/** Détails du détenteur courant (mode 'locked-by-other' uniquement). */
	lockInfo?: LockInfo | null;
	/** URL /p/{participantToken} pour revenir au planning. */
	returnUrl: string;
	/** Reprendre l'édition : recharge la page (master frais + ré-acquisition au mount). */
	onRetry?: () => void;
}

let { mode, lockInfo, returnUrl, onRetry }: Props = $props();

function navigateBack() {
	goto(returnUrl);
}
</script>

<!-- Overlay bloquant plein écran : backdrop semi-opaque + boîte centrée non
     fermable (premier arrivé gagne, pas de fermeture accidentelle). Le
     formulaire reste monté en dessous, l'overlay se superpose seulement. -->
<div
  class="modal modal-open"
  style:z-index="60"
  role="dialog"
  aria-modal="true"
  aria-label={m.lock_edit_title()}
>
  <div class="modal-box max-w-sm space-y-5 py-8 text-center">
    <div
      class="bg-warning/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full"
    >
      {#if mode === "locked-by-other"}
        <Lock class="text-warning" size={32} />
      {:else}
        <AlertTriangle class="text-warning" size={32} />
      {/if}
    </div>

    <div class="space-y-1">
      <h3 class="text-lg font-semibold">
        {mode === "locked-by-other"
          ? m.lock_locked_by_other_title()
          : m.lock_lost_title()}
      </h3>
      {#if mode === "locked-by-other"}
        <p class="text-base-content/70 text-sm">
          {m.lock_locked_by_other_message()}
        </p>
        {#if lockInfo?.lockedByName}
          <p class="text-base-content/50 text-xs">
            {m.lock_locked_by_other_by_name({ name: lockInfo.lockedByName })}
          </p>
        {/if}
      {:else}
        <p class="text-base-content/70 text-sm">{m.lock_lost_message()}</p>
      {/if}
    </div>

    <div class="flex flex-col items-stretch gap-2 pt-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm gap-2"
        onclick={navigateBack}
      >
        <ArrowLeft size={16} />
        {m.archive_back_to_planning()}
      </button>
      {#if onRetry}
        <button
          type="button"
          class="btn btn-primary btn-sm gap-2"
          onclick={onRetry}
        >
          <RotateCcw size={16} />
          {mode === "lock-lost" ? m.lock_retry_continue() : m.common_retry()}
        </button>
      {/if}
    </div>
  </div>
</div>
