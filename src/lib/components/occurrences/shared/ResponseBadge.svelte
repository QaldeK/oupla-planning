<script lang="ts">
	interface Props {
		present: number;
		required: number;
		size?: "sm" | "md";
	}

	let { present, required, size = "sm" }: Props = $props();

	const isComplete = $derived(present >= required);
</script>

<span
	class="badge font-semibold {size === 'sm' ? 'badge-sm' : 'badge-md'} {isComplete
		? 'badge-success'
		: 'badge-warning'}"
>
	{present}/{required}
</span>
