<script lang="ts">
	import type { ResponseType } from '$lib/types/planning.types';
	import { RESPONSE_TYPE_CONFIG } from '$lib/constants';
	import { Minus } from 'lucide-svelte';

	interface Props {
		response: ResponseType | undefined;
		size?: 'sm' | 'md' | 'lg';
	}

	let { response, size = 'md' }: Props = $props();

	const sizeClasses = {
		sm: 'badge-sm',
		md: 'badge-md',
		lg: 'badge-lg'
	};

	const iconSizes = {
		sm: 12,
		md: 14,
		lg: 16
	};

	const responseConfig = $derived(
		response
			? RESPONSE_TYPE_CONFIG[response]
			: {
					label: 'Pas de réponse',
					badgeClass: 'badge-ghost',
					icon: Minus,
					btnClass: 'btn-ghost'
				}
	);
	const Icon = $derived(responseConfig.icon);
</script>

<div class="badge {responseConfig.badgeClass} {sizeClasses[size]} gap-1">
	<Icon size={iconSizes[size]} />
	<span>{responseConfig.label}</span>
</div>
