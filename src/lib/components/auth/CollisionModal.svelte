<script lang="ts">
	import Modal from '../ui/Modal.svelte';
	import { AlertTriangle, AlertCircle, ShieldCheck } from 'lucide-svelte';

	interface Props {
		open: boolean;
		localName: string;
		remoteName: string;
		onBackupAndReplace: () => Promise<void>;
		onReplaceOnly: () => Promise<void>;
		onCancel: () => void;
		isSubmitting?: boolean;
	}

	let {
		open = $bindable(false),
		localName,
		remoteName,
		onBackupAndReplace,
		onReplaceOnly,
		onCancel,
		isSubmitting = false
	}: Props = $props();

	let backupAndReplaceChecked = $state(true);
</script>

<Modal
	{open}
	onClose={() => {
		if (!isSubmitting) onCancel();
	}}
	title="Collision de profils détectée"
	size="sm"
>
	<div class="space-y-4 py-2">
		<div class="flex items-start gap-4">
			<div class="bg-warning/10 rounded-full p-2">
				<AlertTriangle size={24} class="text-warning" />
			</div>
			<div class="flex-1">
				<p class="text-base font-semibold">Un profil local différent existe déjà</p>
				<div class="mt-3 space-y-2 text-sm">
					<div class="flex items-center gap-2">
						<div class="badge badge-ghost badge-sm">Local</div>
						<span class="font-semibold">{localName}</span>
					</div>
					<div class="flex items-center gap-2">
						<div class="badge badge-primary badge-sm">PocketBase</div>
						<span class="font-semibold">{remoteName}</span>
					</div>
				</div>
				<p class="text-base-content/70 mt-3 text-sm">
					Vous allez vous connecter en tant que <span class="font-semibold">{remoteName}</span>, ce
					qui remplacera les données locales de {localName}.
				</p>
			</div>
		</div>

		<div class="space-y-3">
			<label
				class="border-base-300 bg-base-200/50 hover:bg-base-200 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition"
			>
				<input
					type="radio"
					class="radio radio-primary radio-sm mt-0.5"
					bind:group={backupAndReplaceChecked}
					value={true}
					disabled={isSubmitting}
				/>
				<div class="flex-1">
					<div class="flex items-center gap-2 font-semibold">
						<ShieldCheck size={16} class="text-success" />
						Sauvegarder et remplacer
					</div>
					<p class="text-base-content/60 mt-1 text-xs">
						Conserver une sauvegarde de {localName} avant de passer à {remoteName}
					</p>
				</div>
			</label>

			<label
				class="border-base-300 bg-base-200/50 hover:bg-base-200 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition"
			>
				<input
					type="radio"
					class="radio radio-error radio-sm mt-0.5"
					bind:group={backupAndReplaceChecked}
					value={false}
					disabled={isSubmitting}
				/>
				<div class="flex-1">
					<div class="flex items-center gap-2 font-semibold">
						<AlertCircle size={16} class="text-error" />
						Remplacer sans sauvegarder
					</div>
					<p class="text-base-content/60 mt-1 text-xs">
						Perdre définitivement les données locales de {localName}
					</p>
				</div>
			</label>
		</div>

		<div class="modal-action mt-4 gap-2">
			<button type="button" class="btn btn-ghost" onclick={onCancel} disabled={isSubmitting}>
				Annuler
			</button>
			<button
				type="button"
				class="btn btn-primary min-w-[140px]"
				onclick={async () => {
					if (backupAndReplaceChecked) {
						await onBackupAndReplace();
					} else {
						await onReplaceOnly();
					}
				}}
				disabled={isSubmitting}
			>
				{#if isSubmitting}
					<span class="loading loading-spinner loading-sm"></span>
					Connexion...
				{:else}
					Se connecter
				{/if}
			</button>
		</div>
	</div>
</Modal>
