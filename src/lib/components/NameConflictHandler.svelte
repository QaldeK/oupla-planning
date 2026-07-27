 <script lang="ts">
import { CircleAlert, InfoIcon } from "@lucide/svelte";
import { slide } from "svelte/transition";
import * as m from "$lib/paraglide/messages.js";
import type { Participant } from "$lib/types/planning.types";
</script>

{#if hasConflict && matchedParticipant}
	<!-- Conflit : alerte + bouton "C'est moi" pour revendiquer l'identité existante.
	     Le bouton submit du formulaire parent est désactivé tant que le conflit
	     n'est pas résolu (soit revendication, soit changement de nom). -->
	<div
		class="alert alert-warning alert-soft text-base-content animate-in fade-in slide-in-from-top-2 mt-4 duration-300"
		transition:slide
	>
		<CircleAlert size={20} class="shrink-0" />
		<div class="flex-1 text-sm">
			<p class="font-medium">{m.nameconflict_name_taken({name: matchedParticipant.name})}</p>
			<p class="mt-1 opacity-80">
				{m.nameconflict_hint()}
			</p>
		</div>
		<button
			type="button"
			class="btn btn-primary btn-sm gap-1"
			onclick={() => attemptIdentifyAs(matchedParticipant)}
			disabled={isSubmitting}
		>
			{m.nameconflict_its_me()}
		</button>
	</div>
{/if}

{#if existingParticipants.length > 0 && !hideExistingParticipants}
	<div class="card card-xs bg-accent/20 mt-4">
		<div class="card-body">
			<span class="text-accent-content/70 flex items-center gap-1 text-sm italic">
				<InfoIcon class="inline size-4 shrink-0 opacity-80" />
				{m.nameconflict_already_participated()}
			</span>
			<div class="flex max-h-40 flex-wrap gap-2 overflow-y-auto p-1">
				{#each existingParticipants as p (p.id)}
					<button
						type="button"
						class="btn btn-accent btn-sm {matchedParticipant?.id === p.id ? 'btn-primary ' : ''}"
						onclick={() => attemptIdentifyAs(p)}
						disabled={isSubmitting}
					>
						{p.name}
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}
