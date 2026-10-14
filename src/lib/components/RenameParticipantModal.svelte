<script lang="ts">
	import { ArrowRight, User } from "@lucide/svelte";
	import { fade } from "svelte/transition";
	import * as m from "$lib/paraglide/messages.js";
	import type { Participant } from "$lib/types/planning.types";
	import Modal from "./ui/Modal.svelte";

	interface Props {
		open: boolean;
		onClose: () => void;
		/** Nom actuel du participant sur ce planning (préremplit l'input). */
		currentName: string;
		/** Titre du planning, rappelé pour expliciter la portée locale du nom. */
		planningTitle: string;
		existingParticipants?: Participant[];
		currentIdentityId?: string;
		/** Effectue le rename côté parent (serveur + identité locale). */
		onRename: (newName: string) => Promise<void>;
	}

	let {
		open = $bindable(false),
		onClose,
		currentName,
		planningTitle,
		existingParticipants = [],
		currentIdentityId,
		onRename,
	}: Props = $props();

	let newName = $state("");
	let isSubmitting = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);

	// Conflit : nom déjà porté par un autre participant actif. Le rename ne
	// revendique jamais — l'utilisateur doit passer par « Changer de participant ».
	let hasNameConflict = $derived.by(() => {
		const trimmed = newName.trim().toLowerCase();
		if (!trimmed) return false;
		return existingParticipants.some(
			(p) => p.name.toLowerCase() === trimmed && p.id !== currentIdentityId,
		);
	});

	// Inchangé ou vide → submit désactivé (évite un update serveur inutile).
	let isUnchanged = $derived(!newName.trim() || newName.trim() === currentName.trim());

	function resetForm() {
		newName = "";
		isSubmitting = false;
	}

	function closeModal() {
		resetForm();
		onClose();
	}

	// Préremplit l'input à chaque ouverture (pas de dépendance au contenu saisi :
	// l'effect ne lit que `open` et `currentName`).
	$effect(() => {
		if (open) {
			newName = currentName;
			if (inputRef) {
				setTimeout(() => inputRef?.focus(), 50);
			}
		}
	});

	async function handleSubmit() {
		if (isUnchanged || hasNameConflict || isSubmitting) return;
		isSubmitting = true;
		try {
			await onRename(newName.trim());
			closeModal();
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Modal {open} onClose={closeModal} title={m.rename_title()} size="sm">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		class="space-y-5"
		in:fade
	>
		<p class="text-sm opacity-80">
			{m.rename_desc({ title: planningTitle })}
		</p>

		<fieldset>
			<label class="input w-full" class:border-error={hasNameConflict}>
				<span class="label">
					<User size={18} class="opacity-40" />
					{m.identify_name_label()}
				</span>
				<input
					bind:this={inputRef}
					type="text"
					bind:value={newName}
					class="grow"
					placeholder={m.identify_name_placeholder()}
					required
					disabled={isSubmitting}
					maxlength="36"
				/>
			</label>
			{#if hasNameConflict}
				<div class="alert alert-warning alert-soft mt-2 p-2 text-sm">
					{m.rename_name_taken()}
				</div>
			{/if}
		</fieldset>

		<div class="modal-action">
			<button
				type="submit"
				class="btn btn-primary btn-block gap-2"
				disabled={isSubmitting || isUnchanged || hasNameConflict}
			>
				{#if isSubmitting}
					<span class="loading loading-spinner loading-xs"></span>
					{m.identify_processing()}
				{:else}
					{m.claim_save()}
					<ArrowRight size={18} />
				{/if}
			</button>
		</div>
	</form>
</Modal>
