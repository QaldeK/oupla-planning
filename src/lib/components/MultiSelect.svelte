<script lang="ts">
	interface Option {
		value: number;
		label: string;
	}

	interface Props {
		selectedValues: number[];
		options: Option[];
		placeholder?: string;
	}

	let {
		selectedValues = $bindable([]),
		options,
		placeholder = 'Sélectionner des options'
	}: Props = $props();

	let isOpen = $state(false);

	function toggleDropdown() {
		isOpen = !isOpen;
	}

	function toggleOption(value: number) {
		if (selectedValues.includes(value)) {
			selectedValues = selectedValues.filter((v) => v !== value);
		} else {
			selectedValues = [...selectedValues, value].sort((a, b) => a - b);
		}
	}

	function removeOption(value: number) {
		selectedValues = selectedValues.filter((v) => v !== value);
	}

	function getLabelForValue(value: number): string {
		const option = options.find((opt) => opt.value === value);
		return option ? option.label : '';
	}

	// Fermer le dropdown si on clique en dehors
	function handleClickOutside(e: MouseEvent) {
		if (!e.target) return;
		const target = e.target as HTMLElement;
		if (!target.closest('.multiselect-container')) {
			isOpen = false;
		}
	}

	// Ajouter le listener global au mount
	$effect(() => {
		document.addEventListener('click', handleClickOutside);
		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});
</script>

<div class="multiselect-container relative">
	<!-- Zone d'affichage des sélections -->
	<div
		class="input input-bordered flex min-h-12 cursor-pointer flex-wrap gap-2"
		onclick={toggleDropdown}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggleDropdown();
			}
		}}
		role="combobox"
		aria-expanded={isOpen}
		aria-controls="dropdown-options"
		tabindex="0"
	>
		{#if selectedValues.length > 0}
			{#each selectedValues as value (value)}
				<span class="badge badge-primary gap-1">
					{getLabelForValue(value)}
					<button
						type="button"
						class="btn btn-circle btn-ghost btn-xs hover:btn-error"
						onclick={(e) => {
							e.stopPropagation();
							removeOption(value);
						}}
						aria-label="Supprimer {getLabelForValue(value)}"
					>
						×
					</button>
				</span>
			{/each}
		{:else}
			<span class="text-base-content/50">{placeholder}</span>
		{/if}
	</div>

	<!-- Dropdown des options -->
	{#if isOpen}
		<div
			id="dropdown-options"
			class="border-base-300 bg-base-100 absolute z-10 mt-1 w-full rounded-lg border shadow-xl"
		>
			{#each options as option (option.value)}
				<label
					class="hover:bg-base-200 flex cursor-pointer items-center gap-2 px-4 py-2"
					class:bg-base-300={selectedValues.includes(option.value)}
				>
					<input
						type="checkbox"
						class="checkbox checkbox-sm"
						checked={selectedValues.includes(option.value)}
						onchange={(e) => {
							const checkbox = e.target as HTMLInputElement;
							if (checkbox.checked) {
								if (!selectedValues.includes(option.value)) {
									selectedValues = [...selectedValues, option.value].sort((a, b) => a - b);
								}
							} else {
								selectedValues = selectedValues.filter((v) => v !== option.value);
							}
						}}
					/>
					<span>{option.label}</span>
				</label>
			{/each}
		</div>
	{/if}
</div>
