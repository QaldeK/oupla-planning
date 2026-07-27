<script lang="ts">
  import {
    ArrowRight,
    Check,
    Info,
    LoaderCircle,
    LogOut,
    User,
    UserCheck,
    Users,
  } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { fade, slide } from "svelte/transition";
  import { toast } from "svelte-sonner";
  import Modal from "$lib/components/ui/Modal.svelte";
  import { RESPONSE_TYPE_CONFIG, RESPONSE_TYPE_LABELS } from "$lib/constants";
  import * as m from "$lib/paraglide/messages.js";
  import {
    addParticipant,
    type ClaimIdentityStats,
    claimParticipantIdentity,
    updateParticipant,
  } from "$lib/services/planningActions";
  import { ensurePlanningParticipant } from "$lib/services/planningParticipants";
  import { userStore } from "$lib/stores/userStore.svelte";
  import type {
    Participant,
    PlanningIdentity,
    PlanningMaster,
    PlanningOccurrence,
    ResponseType,
  } from "$lib/types/planning.types";
  import { formatDateShort } from "$lib/utils/date";

  interface Props {
    open: boolean;
    onClose: () => void;
    mode: "new" | "manage";
    master: PlanningMaster;
    pbUser: { id: string; name: string; email: string };
    token: string;
    occurrences: PlanningOccurrence[];
    /** Callback appelé après un changement d'identité réussi (ajout, rename, claim) */
    onIdentityChanged?: (identity: PlanningIdentity) => void;
    /** Participant proposé au claim direct à l'ouverture (flux de transition guest → auth). */
    suggestionParticipant?: Participant | null;
    /** Callback quand l'user refuse la suggestion (le parent peut auto-add si pas de conflit). */
    onDeclineSuggestion?: () => void;
  }

  let {
    open = $bindable(false),
    onClose,
    mode,
    master,
    pbUser,
    token,
    occurrences,
    onIdentityChanged,
    suggestionParticipant = null,
    onDeclineSuggestion,
  }: Props = $props();

  // === Est-ce que l'utilisateur courant est admin de ce planning ? ===
  let isAdmin = $derived(!!master.adminToken);

  // === Identifiant le participant auth actuel (mode "manage") ===
  let authParticipant = $derived(
    master.participants.find((p) => p.userId === pbUser.id && !p.hasQuit),
  );

  // === Nom saisi dans l'input ===
  let name = $state("");

  // True tant que l'user n'a pas répondu à la suggestion. Permet de basculer
  // de l'étape suggestion vers l'étape principale sans appeler onClose.
  let suggestionDeclined = $state(false);

  // Re-init quand le modal s'ouvre. `untrack` sinon
  // l'$effect dépendrait de `authParticipant` (dérivé de `master.participants`)
  // et se redéclencherait sur tout push realtime, écrasant la saisie de
  // l'utilisateur (cf. scénario : un autre participant répond pendant que
  // l'user tape son nom).
  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = authParticipant?.name ?? pbUser.name ?? "";
      pendingClaimParticipant = null;
      pendingMergeStats = null;
      suggestionDeclined = false;
    });
  });

  // === Liste des participants non-liés à revendiquer ===
  let claimableParticipants = $derived(
    master.participants.filter(
      (p) => !p.userId && !p.hasQuit && p.id !== authParticipant?.id,
    ),
  );

  // === Conflit de nom ===
  let trimmedName = $derived(name.trim());
  let normalizedName = $derived(trimmedName.toLowerCase());

  let nameConflictParticipant = $derived.by(() => {
    if (!normalizedName) return null;
    return (
      master.participants.find(
        (p) =>
          p.name.toLowerCase() === normalizedName &&
          p.id !== authParticipant?.id &&
          !p.hasQuit,
      ) ?? null
    );
  });

  let nameConflictIsClaimable = $derived(
    nameConflictParticipant !== null &&
      !nameConflictParticipant.userId &&
      !nameConflictParticipant.hasQuit,
  );

  // === États de soumission ===
  let isSubmitting = $state(false);
  let pendingClaimParticipant = $state<Participant | null>(null);
  let pendingMergeStats = $state<ClaimIdentityStats | null>(null);

  let canSubmitName = $derived(
    trimmedName.length > 0 && !nameConflictParticipant && !isSubmitting,
  );

  // Aperçu pré-calculé pour le participant en cours de revendication
  let pendingClaimPreview = $derived(
    pendingClaimParticipant
      ? getFutureResponsesPreview(pendingClaimParticipant.id)
      : null,
  );

  // Aperçu pré-calculé pour l'étape suggestion
  let suggestionPreview = $derived(
    suggestionParticipant
      ? getFutureResponsesPreview(suggestionParticipant.id)
      : null,
  );

  // Étape courante du modal. La confirmation (claim manuel) est prioritaire sur
  // tout ; la suggestion est prioritaire sur l'étape principale tant que l'user
  // n'a pas répondu.
  let currentStep = $derived<"confirmation" | "suggestion" | "main">(
    pendingClaimParticipant
      ? "confirmation"
      : suggestionParticipant && !suggestionDeclined
        ? "suggestion"
        : "main",
  );

  // Fermable seulement sur l'étape principale, avec une identité liée valide et
  // aucun conflit sur le nom saisi. Suggestion et confirmation exigent un choix.
  let closable = $derived(
    currentStep === "main" && !!authParticipant && !nameConflictParticipant,
  );

  // === Aperçu des réponses futures d'un participant ===
  interface ResponsePreviewItem {
    date: string;
    startTime: string;
    response: ResponseType;
  }

  interface ResponsePreview {
    items: ResponsePreviewItem[];
    totalCount: number;
    remaining: number;
  }

  function getFutureResponsesPreview(participantId: string): ResponsePreview {
    const today = new Date().toISOString().split("T")[0];
    const future = occurrences
      .filter((o) => o.date >= today && !o.isCanceled)
      .sort((a, b) => a.date.localeCompare(b.date));

    const withResponse: ResponsePreviewItem[] = [];
    for (const occ of future) {
      const r = (occ.responses || []).find(
        (x) => x.participantId === participantId,
      );
      if (r) {
        withResponse.push({
          date: occ.date,
          startTime: occ.startTime,
          response: r.response,
        });
      }
    }

    const limit = 5;
    return {
      items: withResponse.slice(0, limit),
      totalCount: withResponse.length,
      remaining: Math.max(0, withResponse.length - limit),
    };
  }

  // === Calcul du merge preview (mode manage uniquement) ===
  function computeMergePreview(guestParticipantId: string): ClaimIdentityStats {
    const stats: ClaimIdentityStats = {
      identical: 0,
      conflict: 0,
      migrated: 0,
      commentsMigrated: 0,
    };

    if (!authParticipant) return stats;

    for (const occ of occurrences) {
      const responses = occ.responses || [];
      const guestResp = responses.find(
        (r) => r.participantId === guestParticipantId,
      );
      const authResp = responses.find(
        (r) => r.participantId === authParticipant.id,
      );

      if (guestResp && authResp) {
        if (
          JSON.stringify(guestResp.response) ===
          JSON.stringify(authResp.response)
        ) {
          stats.identical++;
        } else {
          stats.conflict++;
        }
      } else if (guestResp) {
        stats.migrated++;
      }

      const guestComments = (occ.comments || []).filter(
        (c) => c.participantId === guestParticipantId,
      );
      stats.commentsMigrated += guestComments.length;
    }

    return stats;
  }

  // === Actions ===

  /**
   * Enregistrer le nom : soit ajouter un nouveau participant (mode "new"),
   * soit mettre à jour le nom du participant auth existant (mode "manage").
   */
  async function handleSaveName() {
    if (!canSubmitName) return;

    isSubmitting = true;
    try {
      if (mode === "new") {
        // Créer nouveau participant avec userId = pbUser.id
        await addParticipant(
          master.id,
          {
            id: pbUser.id,
            name: trimmedName,
            isAdmin: false,
            userId: pbUser.id,
          },
          token,
        );
        try {
          await ensurePlanningParticipant(
            master.id,
            pbUser.id,
            master.recurrence.type,
            isAdmin,
          );
        } catch (err) {
          console.error("ensurePlanningParticipant failed:", err);
        }
        onIdentityChanged?.({
          id: pbUser.id,
          name: trimmedName,
          email: pbUser.email,
        });
        toast.success(m.claim_welcome({ name: trimmedName }));
      } else {
        // Mettre à jour le nom du participant auth
        if (!authParticipant) {
          console.error("authParticipant introuvable en mode manage");
          return;
        }
        await updateParticipant(
          master.id,
          authParticipant.id,
          { name: trimmedName },
          token,
          master,
        );
        onIdentityChanged?.({
          id: authParticipant.id,
          name: trimmedName,
          email: pbUser.email,
        });
        toast.success(m.claim_name_updated());
      }
      open = false;
    } catch (err) {
      console.error("Error saving name:", err);
      toast.error(m.claim_update_error());
    } finally {
      isSubmitting = false;
    }
  }

  /** Démarrer la revendication d'une identité guest */
  function handleStartClaim(p: Participant) {
    pendingClaimParticipant = p;
    // En mode "manage", l'auth a peut-être des réponses à fusionner
    pendingMergeStats = authParticipant ? computeMergePreview(p.id) : null;
  }

  /** Annuler la revendication en cours */
  function handleCancelClaim() {
    pendingClaimParticipant = null;
    pendingMergeStats = null;
  }

  /**
   * Échappatoire : se déconnecter pour participer sous un autre compte.
   * Reste sur le planning courant (pas de goto('/')) ; l'$effect de la page
   * rouvrira IdentifyModal une fois l'identité absente.
   */
  async function handleLogoutSwitch() {
    isSubmitting = true;
    try {
      await userStore.logoutAndStayOnPlanning(token);
      onClose();
    } catch (err) {
      console.error("logoutAndStayOnPlanning failed:", err);
      toast.error(m.claim_logout_error());
    } finally {
      isSubmitting = false;
    }
  }

  /** Confirmer la revendication (appel endpoint PB). `target` explicite pour le claim direct depuis l'étape suggestion (sinon fallback sur `pendingClaimParticipant`). */
  async function handleConfirmClaim(target?: Participant) {
    const participant = target ?? pendingClaimParticipant;
    if (!participant) return;

    isSubmitting = true;
    try {
      const result = await claimParticipantIdentity(
        master.id,
        participant.id,
        token,
      );

      // Construire la nouvelle identité
      const newIdentity: PlanningIdentity = {
        id: result.authParticipantId,
        name: participant.name,
        email: pbUser.email,
      };

      // S'assurer que l'entrée planning_participants existe
      try {
        await ensurePlanningParticipant(
          master.id,
          pbUser.id,
          master.recurrence.type,
          isAdmin,
        );
      } catch (err) {
        console.error("ensurePlanningParticipant failed:", err);
      }

      onIdentityChanged?.(newIdentity);

      // Toast bilan
      const parts: string[] = [];
      if (result.stats.migrated > 0) {
        parts.push(`${result.stats.migrated} ${m.claim_response_migrated()}`);
      }
      if (result.stats.conflict > 0) {
        parts.push(`${result.stats.conflict} ${m.claim_conflict_resolved()}`);
      }
      if (result.stats.commentsMigrated > 0) {
        parts.push(
          `${result.stats.commentsMigrated} ${m.claim_comment_migrated()}`,
        );
      }

      if (parts.length > 0) {
        toast.success(m.claim_identity_claimed({ details: parts.join(", ") }));
      } else {
        toast.success(m.claim_welcome({ name: participant.name }));
      }

      open = false;
    } catch (err: unknown) {
      console.error("Error claiming identity:", err);
      const status = (err as { status?: number })?.status ?? 0;
      if (status === 409) {
        toast.error(m.claim_already_claimed());
      } else if (status === 403) {
        toast.error(m.claim_invalid_token());
      } else if (status === 404) {
        toast.error(m.claim_participant_not_found());
      } else {
        toast.error(m.claim_error());
      }
    } finally {
      isSubmitting = false;
      pendingClaimParticipant = null;
      pendingMergeStats = null;
    }
  }

  /** Refuser la suggestion : bascule sur l'étape principale. Le parent décide (via `onDeclineSuggestion`) s'il auto-add le nom du compte. */
  function handleDeclineSuggestion() {
    suggestionDeclined = true;
    onDeclineSuggestion?.();
  }

  /** L'user a participé sous un autre nom : bascule sur l'étape principale sans auto-add (il utilisera la liste des claimables). */
  function handleSuggestionOtherName() {
    suggestionDeclined = true;
  }
</script>

<Modal
  {open}
  {onClose}
  title={mode === "new" ? m.claim_your_identity() : m.claim_change_identity()}
  size="md"
  {closable}
>
  <div class="space-y-6">
    {#if pendingClaimParticipant}
      <!-- ============ ÉTAPE CONFIRMATION DE REVENDICATION ============ -->
      <div class="space-y-4" in:fade out:slide={{ duration: 200 }}>
        {#if pendingMergeStats && (pendingMergeStats.conflict > 0 || pendingMergeStats.migrated > 0 || pendingMergeStats.identical > 0 || pendingMergeStats.commentsMigrated > 0)}
          <!-- Cas avec merge (mode manage + réponses) -->
          <div class="alert alert-warning alert-soft">
            <Info size={20} class="shrink-0" />
            <div class="flex-1 text-sm">
              <p class="font-medium">{m.claim_merge_title()}</p>
              {m.claim_merge_desc()}
            </div>
          </div>

          <div class="bg-base-200 rounded-lg p-3 text-sm">
            <p class="mb-2 font-medium">{m.claim_merge_summary()}</p>
            <ul class="space-y-1.5">
              {#if pendingMergeStats.identical > 0}
                <li class="flex items-center gap-2">
                  <Check size={16} class="text-success shrink-0" />
                  <span>
                    {pendingMergeStats.identical}
                    {m.claim_identical_response()}
                  </span>
                </li>
              {/if}
              {#if pendingMergeStats.conflict > 0}
                <li class="flex items-center gap-2">
                  <Info size={16} class="text-warning shrink-0" />
                  <span>
                    {pendingMergeStats.conflict}
                    {m.claim_conflict()} —
                    <strong>{m.claim_your_recent_choice_will_be_kept()}</strong>
                  </span>
                </li>
              {/if}
              {#if pendingMergeStats.migrated > 0}
                <li class="flex items-center gap-2">
                  <ArrowRight size={16} class="text-info shrink-0" />
                  <span>
                    {pendingMergeStats.migrated}
                    {m.claim_response()} de
                    {pendingClaimParticipant.name}
                    {m.claim_migrated()}
                    {m.claim_to_your_account()}
                  </span>
                </li>
              {/if}
              {#if pendingMergeStats.commentsMigrated > 0}
                <li class="flex items-center gap-2">
                  <ArrowRight size={16} class="text-info shrink-0" />
                  <span>
                    {pendingMergeStats.commentsMigrated}
                    {m.claim_comment()} de {pendingClaimParticipant.name}
                    {m.claim_migrated()}
                    {m.claim_to_your_account()}
                  </span>
                </li>
              {/if}
            </ul>
          </div>
        {:else}
          <!-- Cas simple (mode new OU manage sans réponses) -->
          <div class="alert alert-info alert-soft">
            <User size={20} class="shrink-0" />
            <div class="flex-1 text-sm">
              {m.claim_you_will_merge_identity()}
            </div>
          </div>
        {/if}

        <!-- Aperçu des réponses futures de l'identité revendiquée -->
        {#if pendingClaimPreview && pendingClaimPreview.totalCount > 0}
          <div class="bg-base-200 rounded-lg p-3">
            <p
              class="mb-2 text-xs font-medium tracking-wide uppercase opacity-60"
            >
              {m.claim_responses_pending({
                name: pendingClaimParticipant.name,
                count: pendingClaimPreview.totalCount,
              })}
            </p>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
              {#each pendingClaimPreview.items as item (item.date)}
                <div class="flex items-center justify-between gap-2">
                  <span
                    class="badge {RESPONSE_TYPE_CONFIG[item.response]
                      .badgeClass} font-medium"
                  >
                    <span class="opacity-80">
                      {formatDateShort(item.date)} · {item.startTime} |
                    </span>
                    {RESPONSE_TYPE_LABELS[item.response]()}
                  </span>
                </div>
              {/each}
              {#if pendingClaimPreview.remaining > 0}
                <li class="pt-1 text-xs opacity-60">
                  + {pendingClaimPreview.remaining}
                  {m.claim_more_response({
                    count: pendingClaimPreview.remaining,
                  })}
                </li>
              {/if}
            </div>
          </div>
        {/if}

        <div class="alert alert-error alert-soft">
          <Info size={20} class="shrink-0" />
          <div class="flex-1 text-sm">
            <p class="font-medium">{m.claim_irreversible()}</p>
            {m.claim_identity_will_be_linked()}
          </div>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={handleCancelClaim}
            disabled={isSubmitting}
          >
            {m.claim_cancel()}
          </button>
          <button
            type="button"
            class="btn btn-primary gap-2"
            onclick={() => handleConfirmClaim()}
            disabled={isSubmitting}
          >
            {#if isSubmitting}
              <LoaderCircle class="animate-spin" size={18} />
              {m.claim_processing()}
            {:else}
              <Check size={18} />
              {m.claim_confirm_merge()}
            {/if}
          </button>
        </div>
      </div>
    {:else if currentStep === "suggestion"}
      <!-- ============ ÉTAPE SUGGESTION (flux de transition guest → auth) ============ -->
      <div class="space-y-4" in:fade out:slide={{ duration: 200 }}>
        <div class="alert alert-info alert-soft">
          <UserCheck size={20} class="shrink-0" />
          <div class="flex-1">
            <p class="font-medium">
              {m.claim_are_you_sure({ name: suggestionParticipant!.name })}
              {#if suggestionPreview && suggestionPreview.totalCount > 0}
                {m.claim_with_these_responses()}
              {/if}
            </p>
            {#if pbUser.name.toLowerCase() !== suggestionParticipant!.name.toLowerCase()}
              <!-- Situation 3 (nom différent) : clarifier que le nom guest est conservé. -->
              <p>
                {m.claim_you_will_keep_name({
                  name: suggestionParticipant!.name,
                })}
              </p>
            {/if}
          </div>
        </div>

        {#if suggestionPreview && suggestionPreview.totalCount > 0}
          <div class="bg-base-200 rounded-lg p-3">
            <p
              class="mb-2 text-xs font-medium tracking-wide uppercase opacity-60"
            >
              {m.claim_responses_pending({
                name: "…",
                count: suggestionPreview.totalCount,
              })}
            </p>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
              {#each suggestionPreview.items as item (item.date)}
                <span
                  class="badge {RESPONSE_TYPE_CONFIG[item.response]
                    .badgeClass} font-medium"
                >
                  <span class="opacity-80">
                    {formatDateShort(item.date)} · {item.startTime} |
                  </span>
                  {RESPONSE_TYPE_LABELS[item.response]()}
                </span>
              {/each}
              {#if suggestionPreview.remaining > 0}
                <span class="self-center text-xs opacity-60">
                  + {suggestionPreview.remaining}
                  {m.claim_more_responses({
                    count: suggestionPreview.remaining,
                  })}
                </span>
              {/if}
            </div>
          </div>
        {:else}
          <div class="text-xs opacity-60">{m.claim_no_pending_responses()}</div>
        {/if}

        <div class="modal-action flex-col">
          <button
            type="button"
            class="btn btn-primary btn-block gap-2"
            onclick={() => handleConfirmClaim(suggestionParticipant!)}
            disabled={isSubmitting}
          >
            {#if isSubmitting}
              <LoaderCircle class="animate-spin" size={18} />
              {m.claim_processing()}
            {:else}
              <Check size={18} />
              {m.claim_yes_this_is_me()}
            {/if}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-block"
            onclick={handleDeclineSuggestion}
            disabled={isSubmitting}
          >
            {m.claim_no()}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-link btn-block text-sm opacity-70"
            onclick={handleSuggestionOtherName}
            disabled={isSubmitting}
          >
            {m.claim_other_name()}
          </button>
        </div>
      </div>
    {:else}
      <!-- ============ ÉTAPE PRINCIPALE ============ -->
      <!-- Section : Mon nom -->
      <div class="space-y-3">
        <div class="flex items-center gap-2 text-sm font-medium">
          <User size={16} />
          {m.claim_your_identity_on_this_planning()}
        </div>

        <fieldset>
          <label
            class="input w-full"
            class:border-error={nameConflictParticipant}
          >
            <input
              type="text"
              bind:value={name}
              class="grow"
              placeholder={m.claim_name_placeholder()}
              maxlength="36"
              disabled={isSubmitting}
            />
          </label>
        </fieldset>

        {#if nameConflictParticipant}
          {#if nameConflictIsClaimable}
            {@const conflictPreview = getFutureResponsesPreview(
              nameConflictParticipant.id,
            )}
            <div
              class="border-warning bg-base-200 space-y-2 rounded-l-none rounded-r-lg border-l-4 p-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-start gap-2">
                    <Info size={16} class="text-warning mt-0.5 shrink-0" />
                    <div>
                      <p class="font-medium">
                        {m.claim_name_conflict({ name: trimmedName })}
                      </p>
                      <p class="text-sm opacity-80">
                        {m.claim_is_this_you()}
                      </p>
                    </div>
                  </div>
                  {#if conflictPreview.totalCount > 0}
                    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                      <p>
                        Réponses déjà enregistrées sous le nom <strong
                          >{trimmedName}</strong
                        > :
                      </p>
                      {#each conflictPreview.items.slice(0, 3) as item (item.date)}
                        <span
                          class="badge {RESPONSE_TYPE_CONFIG[item.response]
                            .badgeClass} font-medium"
                        >
                          <span class="opacity-80">
                            {formatDateShort(item.date)} · {item.startTime} |
                          </span>
                          {RESPONSE_TYPE_LABELS[item.response]()}
                        </span>
                      {/each}
                      {#if conflictPreview.totalCount > 3}
                        <span class="self-center text-xs opacity-60">
                          + {conflictPreview.totalCount - 3}
                          {m.claim_more_response({
                            count: conflictPreview.totalCount - 3,
                          })}
                        </span>
                      {/if}
                    </div>
                  {:else}
                    {m.claim_no_responses_pending()}
                  {/if}
                </div>
                <button
                  type="button"
                  class="btn btn-outline btn-primary shrink-0 gap-1"
                  onclick={() => handleStartClaim(nameConflictParticipant)}
                  disabled={isSubmitting}
                >
                  {m.claim_this_is_me()}
                </button>
              </div>
            </div>
          {:else}
            <div class="alert alert-warning alert-soft p-2 text-sm">
              <Info size={16} class="shrink-0" />
              <div class="flex-1">
                {m.claim_no_participant()}
                {m.claim_choose_another()}
              </div>
            </div>
          {/if}
        {/if}

        <button
          type="button"
          class="btn btn-primary btn-block gap-2"
          onclick={handleSaveName}
          disabled={!canSubmitName}
        >
          {#if isSubmitting}
            <LoaderCircle class="animate-spin" size={18} />
            {m.claim_processing()}
          {:else}
            {#if mode === "new"}
              {m.claim_enrolling_as({ name: trimmedName || "..." })}
            {:else}
              {m.claim_save()}
            {/if}
            <ArrowRight size={18} />
          {/if}
        </button>
      </div>

      <!-- Section : Rejoindre une identité existante -->
      {#if claimableParticipants.length > 0 && !authParticipant?.claimedAt}
        <div class="divider text-xs tracking-widest uppercase opacity-50">
          {m.claim_you_have_participated()}
        </div>

        <div class="space-y-3">
          <div class="flex items-center gap-2 text-sm font-medium opacity-70">
            <Users size={16} class="shrink-0" />
            <span>
              {m.claim_participants_without_account({
                count: claimableParticipants.length,
              })}
            </span>
          </div>

          <ul class="space-y-2">
            {#each claimableParticipants as p (p.id)}
              {@const preview = getFutureResponsesPreview(p.id)}
              <li
                class="bg-base-200 hover:bg-base-300/50 border-base-300 rounded-lg border p-3 transition-colors"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <User size={16} class="shrink-0 opacity-60" />
                      <span class="truncate font-medium">{p.name}</span>
                    </div>

                    {#if preview.totalCount > 0}
                      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                        {#each preview.items.slice(0, 3) as item (item.date)}
                          <div class="flex items-center justify-between gap-2">
                            <span
                              class="badge {RESPONSE_TYPE_CONFIG[item.response]
                                .badgeClass} font-medium"
                            >
                              <span class="opacity-80">
                                {formatDateShort(item.date)} · {item.startTime} |
                              </span>
                              {RESPONSE_TYPE_LABELS[item.response]()}
                            </span>
                          </div>
                        {/each}
                        {#if preview.totalCount > 3}
                          <div class="mt-1 opacity-60">
                            + {preview.totalCount - 3} autre{preview.totalCount -
                              3 >
                            1
                              ? "s"
                              : ""}
                          </div>
                        {/if}
                      </div>
                    {:else}
                      {m.claim_no_responses_pending()}
                    {/if}
                  </div>

                  <button
                    type="button"
                    class="btn btn-sm btn-outline btn-primary shrink-0 gap-1"
                    onclick={() => handleStartClaim(p)}
                    disabled={isSubmitting}
                  >
                    {m.claim_this_is_me()}
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Échappatoire : changer de compte -->
      <div class="pt-2">
        <button
          type="button"
          class="btn btn-ghost btn-link btn-block gap-1 text-sm opacity-70"
          onclick={handleLogoutSwitch}
          disabled={isSubmitting}
        >
          <LogOut size={15} />
          {m.claim_switch_account()}
        </button>
      </div>
    {/if}
  </div>
</Modal>
