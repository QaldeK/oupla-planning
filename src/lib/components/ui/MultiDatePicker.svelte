<script lang="ts">
	import {
		startOfMonth,
		endOfMonth,
		startOfWeek,
		endOfWeek,
		eachDayOfInterval,
		format,
		isSameDay,
		isSameMonth,
		isToday,
		addMonths,
		subMonths,
		isBefore,
		isAfter,
		parse
	} from 'date-fns';
	import { fr } from 'date-fns/locale';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import type { ClassValue } from 'svelte/elements';

	/**
	 * MultiDatePicker - Composant de sélection multiple de dates
	 * Utilise des strings en format "yyyy-MM-dd" pour la compatibilité avec l'app
	 * @component
	 */

	interface Props {
		selectedDates: string[]; // Dates sélectionnées en format "yyyy-MM-dd"
		excludeDates?: string[]; // Dates à exclure (désactivées) en format "yyyy-MM-dd"
		maxSelection?: number; // Nombre maximum de dates sélectionnables
		onChange: (dates: string[]) => void; // Callback quand la sélection change
		minDate?: string; // Date minimum autorisée (format "yyyy-MM-dd")
		maxDate?: string; // Date maximum autorisée (format "yyyy-MM-dd")
		class?: ClassValue;
	}

	let {
		selectedDates,
		excludeDates = [],
		maxSelection = 100,
		onChange,
		minDate,
		maxDate,
		class: className = ''
	}: Props = $props();

	// État local
	let currentMonth = $state(new Date());

	// Conversion des strings vers Date pour la logique interne
	const selectedDatesAsDate = $derived(
		selectedDates.map((d) => parse(d, 'yyyy-MM-dd', new Date()))
	);
	const excludedDatesAsDate = $derived(excludeDates.map((d) => parse(d, 'yyyy-MM-dd', new Date())));
	const minDateParsed = $derived(minDate ? parse(minDate, 'yyyy-MM-dd', new Date()) : null);
	const maxDateParsed = $derived(maxDate ? parse(maxDate, 'yyyy-MM-dd', new Date()) : null);

	// Jours de la semaine (lun-dim)
	const daysOfWeek = $derived(() => {
		const start = startOfWeek(new Date(), { locale: fr, weekStartsOn: 1 });
		return eachDayOfInterval({ start, end: addMonths(start, 0).setDate(start.getDate() + 6) }).map(
			(day) => format(day, 'EEEEEE', { locale: fr })
		); // Format court (Lu, Ma, etc.)
	});

	// Titre du mois
	const monthYear = $derived(format(currentMonth, 'MMMM yyyy', { locale: fr }));

	// Génération des jours du calendrier
	const calendarDays = $derived(() => {
		const monthStart = startOfMonth(currentMonth);
		const monthEnd = endOfMonth(currentMonth);
		const calendarStart = startOfWeek(monthStart, { locale: fr, weekStartsOn: 1 });
		const calendarEnd = endOfWeek(monthEnd, { locale: fr, weekStartsOn: 1 });

		return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
	});

	// Fonctions utilitaires
	function isSelected(date: Date): boolean {
		return selectedDatesAsDate.some((d) => isSameDay(d, date));
	}

	function isDisabled(date: Date): boolean {
		if (minDateParsed && isBefore(date, minDateParsed)) return true;
		if (maxDateParsed && isAfter(date, maxDateParsed)) return true;
		return excludedDatesAsDate.some((d) => isSameDay(d, date));
	}

	function isCurrentMonthDay(date: Date): boolean {
		return isSameMonth(date, currentMonth);
	}

	// Actions
	function selectDate(date: Date) {
		if (isDisabled(date)) return;

		const dateString = format(date, 'yyyy-MM-dd');
		const index = selectedDates.findIndex((d) => d === dateString);

		let newDates: string[];
		if (index > -1) {
			// Désélectionner
			newDates = selectedDates.filter((_, i) => i !== index);
		} else {
			// Vérifier la limite maxSelection
			if (selectedDates.length >= maxSelection) {
				return; // Ne pas ajouter si la limite est atteinte
			}
			// Sélectionner
			newDates = [...selectedDates, dateString].sort();
		}

		// Notifier le parent
		onChange(newDates);
	}

	function previousMonth() {
		currentMonth = subMonths(currentMonth, 1);
	}

	function nextMonth() {
		currentMonth = addMonths(currentMonth, 1);
	}

	function goToToday() {
		currentMonth = new Date();
	}
</script>

<div class="card bg-base-100 mx-auto w-full max-w-md shadow-xl {className}">
	<div class="card-body p-4 sm:p-6">
		<!-- En-tête avec navigation -->
		<div class="mb-4 flex items-center justify-between">
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-circle"
				onclick={previousMonth}
				aria-label="Mois précédent"
			>
				<ChevronLeft size={20} />
			</button>

			<button
				type="button"
				class="btn btn-ghost btn-sm text-base font-semibold normal-case"
				onclick={goToToday}
			>
				{monthYear}
			</button>

			<button
				type="button"
				class="btn btn-ghost btn-sm btn-circle"
				onclick={nextMonth}
				aria-label="Mois suivant"
			>
				<ChevronRight size={20} />
			</button>
		</div>

		<!-- Jours de la semaine -->
		<div class="mb-2 grid grid-cols-7 gap-1">
			{#each daysOfWeek() as day (day)}
				<div class="text-base-content/70 py-2 text-center text-xs font-semibold uppercase">
					{day}
				</div>
			{/each}
		</div>

		<!-- Grille des jours -->
		<div class="grid grid-cols-7 gap-1">
			{#each calendarDays() as date (date)}
				{@const selected = isSelected(date)}
				{@const disabled = isDisabled(date)}
				{@const today = isToday(date)}
				{@const currentMonthDay = isCurrentMonthDay(date)}

				<button
					type="button"
					class="
						flex aspect-square h-auto min-h-0
						items-center justify-center rounded-lg
						p-0 text-sm
						transition-all duration-200
						{currentMonthDay ? 'text-base-content' : 'text-base-content/30'}
						{selected ? 'bg-primary/50 font-bold' : 'hover:bg-base-200'}
						{today && !selected ? 'ring-primary ring-offset-base-100 ring-2 ring-offset-2' : ''}
						{disabled ? 'cursor-not-allowed opacity-30' : ''}
					"
					onclick={() => selectDate(date)}
					{disabled}
					aria-label={format(date, 'PPP', { locale: fr })}
					aria-pressed={selected}
				>
					{format(date, 'd')}
				</button>
			{/each}
		</div>
	</div>
</div>
