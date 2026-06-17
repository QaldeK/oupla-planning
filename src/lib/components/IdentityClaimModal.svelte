<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import { RESPONSE_TYPE_CONFIG, RESPONSE_TYPE_LABELS } from '$lib/constants';
	import {
		addParticipant,
		claimParticipantIdentity,
		updateParticipant,
		type ClaimIdentityStats
	} from '$lib/services/planningActions';
	import { ensurePlanningParticipant } from '$lib/services/planningParticipants';
	import type {
		Participant,
		PlanningIdentity,
		PlanningMaster,
		PlanningOccurrence,
		ResponseType
	} from '$lib/types/planning.types';
	import { formatDateShort } from '$lib/utils/date';
	import { ArrowRight, Check, Info, LoaderCircle, LogOut, User, Users } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { untrack } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { userStore } from '$lib/stores/userStore.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		mode: 'new' | 'manage';
		master: PlanningMaster;
		pbUser: { id: string; name: string; email: string };
		token: string;
		occurrences: PlanningOccurrence[];
		/** Callback appelé après un changement d'identité réussi (ajout, rename, claim) */
		onIdentityChanged?: (identity: PlanningIdentity) => void;
	}

	let {
		open = $bindable(false),
		onClose,
		mode,
		master,
		pbUser,
		token,
		occurrences,
		onIdentityChanged
	}: Props = $props();

	// === Identifiant le participant auth actuel (mode "manage") ===
	let authParticipant = $derived(
		master.participants.find((p) => p.userId === pbUser.id && !p.hasQuit)
	);

	// === Nom saisi dans l'input ===
	let name = $state('');

	// Re-init quand le modal s'ouvre. `untrack` sinon
	// l'$effect dépendrait de `authParticipant` (dérivé de `master.participants`)
	// et se redéclencherait sur tout push realtime, écrasant la saisie de
	// l'utilisateur (cf. scénario : un autre participant répond pendant que
	// l'user tape son nom).
	$effect(() => {
		if (!open) return;
		untrack(() => {
			name = authParticipant?.name ?? pbUser.name ?? '';
			pendingClaimParticipant = null;
			pendingMergeStats = null;
		});
	});

	// === Liste des participants non-liés à revendiquer ===
	let claimableParticipants = $derived(
		master.participants.filter((p) => !p.userId && !p.hasQuit && p.id !== authParticipant?.id)
	);

	// === Conflit de nom ===
	let trimmedName = $derived(name.trim());
	let normalizedName = $derived(trimmedName.toLowerCase());

	let nameConflictParticipant = $derived.by(() => {
		if (!normalizedName) return null;
		return (
			master.participants.find(
				(p) => p.name.toLowerCase() === normalizedName && p.id !== authParticipant?.id
			) ?? null
		);
	});

	let nameConflictIsClaimable = $derived(
		nameConflictParticipant !== null &&
			!nameConflictParticipant.userId &&
			!nameConflictParticipant.hasQuit
	);

	// === États de soumission ===
	let isSubmitting = $state(false);
	let pendingClaimParticipant = $state<Participant | null>(null);
	let pendingMergeStats = $state<ClaimIdentityStats | null>(null);

	let canSubmitName = $derived(trimmedName.length > 0 && !nameConflictParticipant && !isSubmitting);

	// Aperçu pré-calculé pour le participant en cours de revendication
	let pendingClaimPreview = $derived(
		pendingClaimParticipant ? getFutureResponsesPreview(pendingClaimParticipant.id) : null
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
		const today = new Date().toISOString().split('T')[0];
		const future = occurrences
			.filter((o) => o.date >= today && !o.isCanceled)
			.sort((a, b) => a.date.localeCompare(b.date));

		const withResponse: ResponsePreviewItem[] = [];
		for (const occ of future) {
			const r = (occ.responses || []).find((x) => x.participantId === participantId);
			if (r) {
				withResponse.push({
					date: occ.date,
					startTime: occ.startTime,
					response: r.response
				});
			}
		}

		const limit = 5;
		return {
			items: withResponse.slice(0, limit),
			totalCount: withResponse.length,
			remaining: Math.max(0, withResponse.length - limit)
		};
	}

	// === Calcul du merge preview (mode manage uniquement) ===
	function computeMergePreview(guestParticipantId: string): ClaimIdentityStats {
		const stats: ClaimIdentityStats = {
			identical: 0,
			conflict: 0,
			migrated: 0,
			commentsMigrated: 0
		};

		if (!authParticipant) return stats;

		for (const occ of occurrences) {
			const responses = occ.responses || [];
			const guestResp = responses.find((r) => r.participantId === guestParticipantId);
			const authResp = responses.find((r) => r.participantId === authParticipant.id);

			if (guestResp && authResp) {
				if (JSON.stringify(guestResp.response) === JSON.stringify(authResp.response)) {
					stats.identical++;
				} else {
					stats.conflict++;
				}
			} else if (guestResp) {
				stats.migrated++;
			}

			const guestComments = (occ.comments || []).filter(
				(c) => c.participantId === guestParticipantId
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
			if (mode === 'new') {
				// Créer nouveau participant avec userId = pbUser.id
				await addParticipant(
					master.id,
					{
						id: pbUser.id,
						name: trimmedName,
						isAdmin: false,
						userId: pbUser.id
					},
					token
				);
				try {
					await ensurePlanningParticipant(master.id, pbUser.id);
				} catch (err) {
					console.error('ensurePlanningParticipant failed:', err);
				}
				onIdentityChanged?.({ id: pbUser.id, name: trimmedName, email: pbUser.email });
				toast.success(`Bienvenue, ${trimmedName} !`);
			} else {
				// Mettre à jour le nom du participant auth
				if (!authParticipant) {
					console.error('authParticipant introuvable en mode manage');
					return;
				}
				await updateParticipant(
					master.id,
					authParticipant.id,
					{ name: trimmedName },
					token,
					master
				);
				onIdentityChanged?.({
					id: authParticipant.id,
					name: trimmedName,
					email: pbUser.email
				});
				toast.success('Nom mis à jour');
			}
			open = false;
		} catch (err) {
			console.error('Error saving name:', err);
			toast.error("Erreur lors de l'enregistrement");
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
			console.error('logoutAndStayOnPlanning failed:', err);
			toast.error('Erreur lors de la déconnexion');
		} finally {
			isSubmitting = false;
		}
	}

	/** Confirmer la revendication (appel endpoint PB) */
	async function handleConfirmClaim() {
		if (!pendingClaimParticipant) return;

		isSubmitting = true;
		try {
			const result = await claimParticipantIdentity(master.id, pendingClaimParticipant.id, token);

			// Construire la nouvelle identité
			const newIdentity: PlanningIdentity = {
				id: result.authParticipantId,
				name: pendingClaimParticipant.name,
				email: pbUser.email
			};

			// S'assurer que l'entrée planning_participants existe
			try {
				await ensurePlanningParticipant(master.id, pbUser.id);
			} catch (err) {
				console.error('ensurePlanningParticipant failed:', err);
			}

			onIdentityChanged?.(newIdentity);

			// Toast bilan
			const parts: string[] = [];
			if (result.stats.migrated > 0) {
				parts.push(
					`${result.stats.migrated} réponse${result.stats.migrated > 1 ? 's' : ''} migrée${result.stats.migrated > 1 ? 's' : ''}`
				);
			}
			if (result.stats.conflict > 0) {
				parts.push(
					`${result.stats.conflict} conflit${result.stats.conflict > 1 ? 's' : ''} résolu${result.stats.conflict > 1 ? 's' : ''}`
				);
			}
			if (result.stats.commentsMigrated > 0) {
				parts.push(
					`${result.stats.commentsMigrated} commentaire${result.stats.commentsMigrated > 1 ? 's' : ''} déplacé${result.stats.commentsMigrated > 1 ? 's' : ''}`
				);
			}

			if (parts.length > 0) {
				toast.success(`Identité revendiquée (${parts.join(', ')})`);
			} else {
				toast.success(`Bienvenue, ${pendingClaimParticipant.name} !`);
			}

			open = false;
		} catch (err: unknown) {
			console.error('Error claiming identity:', err);
			const status = (err as { status?: number })?.status ?? 0;
			if (status === 409) {
				toast.error('Cette identité a déjà été revendiquée ou a quitté le planning');
			} else if (status === 403) {
				toast.error('Token invalide');
			} else if (status === 404) {
				toast.error('Participant introuvable');
			} else {
				toast.error('Erreur lors de la revendication');
			}
		} finally {
			isSubmitting = false;
			pendingClaimParticipant = null;
			pendingMergeStats = null;
		}
	}
</script>

<Modal
	{open}
	{onClose}
	title={mode === 'new' ? 'Votre identité sur ce planning' : 'Changer votre identité'}
	size="md"
	closable={mode === 'new' ? false : true}
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
							<p class="font-medium">Fusion des identités</p>
							<p class="mt-1 opacity-80">
								Vous êtes sur le point de revendiquer l'identité
								<strong>{pendingClaimParticipant.name}</strong>. Vous avez déjà des réponses sous
								votre nom actuel
								<strong>{authParticipant?.name}</strong>.
							</p>
						</div>
					</div>

					<div class="bg-base-200 rounded-lg p-3 text-sm">
						<p class="mb-2 font-medium">Bilan de la fusion :</p>
						<ul class="space-y-1.5">
							{#if pendingMergeStats.identical > 0}
								<li class="flex items-center gap-2">
									<Check size={16} class="text-success shrink-0" />
									<span>
										{pendingMergeStats.identical} réponse{pendingMergeStats.identical > 1
											? 's'
											: ''} identique{pendingMergeStats.identical > 1 ? 's' : ''} (sans impact)
									</span>
								</li>
							{/if}
							{#if pendingMergeStats.conflict > 0}
								<li class="flex items-center gap-2">
									<Info size={16} class="text-warning shrink-0" />
									<span>
										{pendingMergeStats.conflict} conflit{pendingMergeStats.conflict > 1 ? 's' : ''} —
										<strong>votre choix récent sera conservé</strong>
									</span>
								</li>
							{/if}
							{#if pendingMergeStats.migrated > 0}
								<li class="flex items-center gap-2">
									<ArrowRight size={16} class="text-info shrink-0" />
									<span>
										{pendingMergeStats.migrated} réponse{pendingMergeStats.migrated > 1 ? 's' : ''} de
										{pendingClaimParticipant.name} migrée{pendingMergeStats.migrated > 1 ? 's' : ''} vers
										votre compte
									</span>
								</li>
							{/if}
							{#if pendingMergeStats.commentsMigrated > 0}
								<li class="flex items-center gap-2">
									<ArrowRight size={16} class="text-info shrink-0" />
									<span>
										{pendingMergeStats.commentsMigrated} commentaire{pendingMergeStats.commentsMigrated >
										1
											? 's'
											: ''} de {pendingClaimParticipant.name} déplacé{pendingMergeStats.commentsMigrated >
										1
											? 's'
											: ''} vers votre compte
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
							<p>
								Vous allez fusionner votre compte avec l'identité
								<strong>{pendingClaimParticipant.name}</strong> sur ce planning. Ses réponses seront associées
								à votre compte.
							</p>
						</div>
					</div>
				{/if}

				<!-- Aperçu des réponses futures de l'identité revendiquée -->
				{#if pendingClaimPreview && pendingClaimPreview.totalCount > 0}
					<div class="bg-base-200 rounded-lg p-3">
						<p class="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">
							Réponses à venir de {pendingClaimParticipant.name} ({pendingClaimPreview.totalCount})
						</p>
						<div class="flex flex-wrap gap-x-4 gap-y-2">
							{#each pendingClaimPreview.items as item (item.date)}
								<div class="flex items-center justify-between gap-2">
									<span class="badge {RESPONSE_TYPE_CONFIG[item.response].badgeClass} font-medium">
										<span class="opacity-80">
											{formatDateShort(item.date)} · {item.startTime} |
										</span>
										{RESPONSE_TYPE_LABELS[item.response]}
									</span>
								</div>
							{/each}
							{#if pendingClaimPreview.remaining > 0}
								<li class="pt-1 text-xs opacity-60">
									+ {pendingClaimPreview.remaining} autre{pendingClaimPreview.remaining > 1
										? 's'
										: ''} réponse{pendingClaimPreview.remaining > 1 ? 's' : ''}
								</li>
							{/if}
						</div>
					</div>
				{/if}

				<div class="alert alert-error alert-soft">
					<Info size={20} class="shrink-0" />
					<div class="flex-1 text-sm">
						<p class="font-medium">Action irréversible</p>
						<p class="mt-1 opacity-80">
							L'identité sera <strong>définitivement liée à votre compte</strong> et fusionnée. Vous ne
							pourrez pas annuler ni revendiquer une autre identité sur ce planning.
						</p>
					</div>
				</div>

				<div class="modal-action">
					<button
						type="button"
						class="btn btn-ghost"
						onclick={handleCancelClaim}
						disabled={isSubmitting}
					>
						Annuler
					</button>
					<button
						type="button"
						class="btn btn-primary gap-2"
						onclick={handleConfirmClaim}
						disabled={isSubmitting}
					>
						{#if isSubmitting}
							<LoaderCircle class="animate-spin" size={18} />
							Confirmer...
						{:else}
							<Check size={18} />
							Confirmer la fusion
						{/if}
					</button>
				</div>
			</div>
		{:else}
			<!-- ============ ÉTAPE PRINCIPALE ============ -->
			<!-- Section : Mon nom -->
			<div class="space-y-3">
				<div class="flex items-center gap-2 text-sm font-medium">
					<User size={16} />
					<span>Votre nom sur ce planning</span>
				</div>

				<fieldset>
					<label class="input w-full" class:border-error={nameConflictParticipant}>
						<input
							type="text"
							bind:value={name}
							class="grow"
							placeholder="Votre nom"
							maxlength="36"
							disabled={isSubmitting}
						/>
					</label>
				</fieldset>

				{#if nameConflictParticipant}
					<div class="alert alert-warning alert-soft p-2 text-sm">
						<Info size={16} class="shrink-0" />
						<div class="flex-1">
							<span>"{trimmedName}" est déjà utilisé.</span>
							{#if nameConflictIsClaimable}
								<span class="opacity-80">
									Si c'est vous, utilisez la section ci-dessous pour revendiquer cette identité.</span
								>
							{:else}
								<span class="opacity-80">Veuillez choisir un autre nom.</span>
							{/if}
						</div>
					</div>
				{/if}

				<button
					type="button"
					class="btn btn-primary btn-block gap-2"
					onclick={handleSaveName}
					disabled={!canSubmitName}
				>
					{#if isSubmitting}
						<LoaderCircle class="animate-spin" size={18} />
						Traitement...
					{:else}
						{#if mode === 'new'}
							Rejoindre en tant que {trimmedName || '...'}
						{:else}
							Enregistrer
						{/if}
						<ArrowRight size={18} />
					{/if}
				</button>
			</div>

			<!-- Section : Rejoindre une identité existante -->
			{#if claimableParticipants.length > 0 && !authParticipant?.claimedAt}
				<div class="divider text-xs tracking-widest uppercase opacity-50">
					Vous avez déjà participé au planning ?
				</div>

				<div class="space-y-3">
					<div class="flex items-center gap-2 text-sm font-medium opacity-70">
						<Users size={16} />
						<span>
							Participants sans compte ({claimableParticipants.length}) — cliquez si l'un d'eux est
							vous
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
															{RESPONSE_TYPE_LABELS[item.response]}
														</span>
													</div>
												{/each}
												{#if preview.totalCount > 3}
													<div class="mt-1 opacity-60">
														+ {preview.totalCount - 3} autre{preview.totalCount - 3 > 1 ? 's' : ''}
													</div>
												{/if}
											</div>
										{:else}
											<div class="mt-1 text-xs opacity-60">Aucune réponse à venir</div>
										{/if}
									</div>

									<button
										type="button"
										class="btn btn-sm btn-outline btn-primary shrink-0 gap-1"
										onclick={() => handleStartClaim(p)}
										disabled={isSubmitting}
									>
										C'est moi
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
					Se déconnecter pour changer de compte
				</button>
			</div>
		{/if}
	</div>
</Modal>
