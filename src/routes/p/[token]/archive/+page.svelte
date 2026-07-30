<script lang="ts">
import { ArrowLeft, Calendar, History, Info, Trash2 } from "@lucide/svelte";
import { fade } from "svelte/transition";
import { page } from "$app/state";
import OccurrenceView from "$lib/components/occurrences/views/OccurrenceView.svelte";
import { ArchiveSkeleton } from "$lib/components/ui/skeletons";
import * as m from "$lib/paraglide/messages.js";
import { guestStateStore } from "$lib/stores/guestStateStore.svelte";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import { resolveActorIdentity } from "$lib/utils/identityResolution";

const token = page.params.token;

let master = $derived(planningStore.master);
let allOccurrences = $derived(planningStore.occurrences);
let isLoading = $derived(planningStore.isLoading);

const today = $derived(new Date().toISOString().split("T")[0]);
const occurrences = $derived(allOccurrences.filter((o) => o.date < today));
const currentUserId = $derived(
	master
		? resolveActorIdentity({
				pbUser: userStore.pbUser,
				guestIdentity: guestStateStore.getGuestIdentity(master.id)
			})?.id
		: undefined
);

// Nom du participant pour l'affichage (depuis le store local)
const currentParticipantName = $derived.by(() => {
	if (!master || !currentUserId) return "";
	const p = master.participants.find((p) => p.id === currentUserId);
	return p?.name || "";
});
</script>

<svelte:head>
  <title
    >{m.archive_title_prefix()} {master?.title || m.archive_loading()}</title
  >
</svelte:head>

<div class="bg-base-200 min-h-screen px-4 py-8 sm:px-6 lg:px-8">
  <div class="mx-auto max-w-4xl">
    {#if planningStore.error?.type === "deleted"}
      <div class="flex min-h-[50vh] items-center justify-center">
        <div class="max-w-md text-center">
          <div
            class="bg-warning/10 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full p-4"
          >
            <Trash2 size={40} class="text-warning" />
          </div>
          <h2 class="mb-2 text-2xl font-bold">{m.archive_deleted_heading()}</h2>
          <p class="text-base-content/70 mb-6">
            {m.archive_deleted_message()}
          </p>
          <a href="/" class="btn btn-primary">{m.common_back_to_home()}</a>
        </div>
      </div>
    {:else}
      <!-- Header -->
      <div class="mb-8">
        <a href="/p/{token}" class="btn btn-ghost sm:btn-sm mb-4 gap-2">
          <ArrowLeft size={18} />
          {m.archive_back_to_planning()}
        </a>

        <div
          class="flex flex-col justify-between gap-4 md:flex-row md:items-end"
        >
          <div>
            <div class="mb-2 flex items-center gap-3">
              <div class="bg-primary/10 text-primary rounded-xl p-3">
                <History size={32} />
              </div>
              <h1 class="text-3xl font-semibold tracking-tight">
                {master?.title || m.archive_loading()}
              </h1>
            </div>
            <p class="text-base-content/60 font-medium">
              {m.archive_subtitle()}
            </p>
          </div>

          {#if currentParticipantName}
            <div class="badge badge-lg badge-outline gap-2 py-4">
              <span class="text-base-content/50">{m.archive_viewing_as()}</span>
              <span class="font-bold">{currentParticipantName}</span>
            </div>
          {/if}
        </div>
      </div>

      {#if isLoading}
        <ArchiveSkeleton />
      {:else}
        <div in:fade={{ duration: 300 }}>
          {#if occurrences.length === 0}
            <div class="card bg-base-100 border-base-200 border shadow-xl">
              <div class="card-body items-center py-16 text-center">
                <div class="bg-base-200 mb-4 rounded-full p-6">
                  <Calendar size={48} class="text-base-content/20" />
                </div>
                <h2 class="card-title text-2xl">{m.archive_empty_title()}</h2>
                <p class="text-base-content/60 max-w-sm">
                  {m.archive_empty_message()}
                </p>
                <div class="card-actions mt-6">
                  <a href="/p/{token}" class="btn btn-primary"
                    >{m.archive_view_current()}</a
                  >
                </div>
              </div>
            </div>
          {:else}
            <div class="alert alert-info mb-8 shadow-sm">
              <Info size={20} />
              <span class="text-sm">{m.archive_readonly_notice()}</span>
            </div>

            <div class="space-y-6">
              {#each occurrences as occurrence (occurrence.id)}
                {#if master}
                  <OccurrenceView
                    {occurrence}
                    {master}
                    participants={master.participants}
                    {currentUserId}
                    isAdmin={false}
                    readOnly={true}
                  />
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
