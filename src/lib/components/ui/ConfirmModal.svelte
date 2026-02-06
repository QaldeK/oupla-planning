<script lang="ts">
	import Modal from './Modal.svelte';
	import { AlertTriangle, Info, AlertCircle, CheckCircle2 } from 'lucide-svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onConfirm: () => void;
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'danger' | 'warning' | 'info' | 'success';
		isSubmitting?: boolean;
		description?: string;
	}

	let {
		open = $bindable(false),
		onClose,
		onConfirm,
		title,
		message,
		confirmLabel = 'Confirmer',
		cancelLabel = 'Annuler',
		variant = 'info',
		isSubmitting = false,
		description
	}: Props = $props();

	const variantConfig = {
		danger: {
			icon: AlertCircle,
			btnClass: 'btn-error',
			bgClass: 'bg-error/10',
			iconClass: 'text-error'
		},
		warning: {
			icon: AlertTriangle,
			btnClass: 'btn-warning',
			bgClass: 'bg-warning/10',
			iconClass: 'text-warning'
		},
		success: {
			icon: CheckCircle2,
			btnClass: 'btn-success',
			bgClass: 'bg-success/10',
			iconClass: 'text-success'
		},
		info: {
			icon: Info,
			btnClass: 'btn-primary',
			bgClass: 'bg-primary/10',
			iconClass: 'text-primary'
		}
	};

	const config = $derived(variantConfig[variant]);
</script>

<Modal {open} {onClose} {title} size="sm">
	<div class="space-y-4 py-2">
		<div class="flex items-start gap-4">
			<div class="rounded-full p-2 {config.bgClass}">
				<config.icon size={24} class={config.iconClass} />
			</div>
			<div class="flex-1">
				<p class="text-base leading-relaxed font-semibold">{message}</p>
				{#if description}
					<p class="text-base-content/60 mt-2 text-sm leading-relaxed">
						{description}
					</p>
				{/if}
			</div>
		</div>

		<div class="modal-action mt-6 gap-2">
			<button type="button" class="btn btn-ghost" onclick={onClose} disabled={isSubmitting}>
				{cancelLabel}
			</button>
			<button
				type="button"
				class="btn {config.btnClass} min-w-[100px]"
				onclick={() => {
					onConfirm();
				}}
				disabled={isSubmitting}
			>
				{#if isSubmitting}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				{confirmLabel}
			</button>
		</div>
	</div>
</Modal>
