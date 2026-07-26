import {
	format,
	startOfMonth,
	endOfMonth,
	addDays,
	getDay,
	addWeeks,
	addMonths,
	parse,
	isBefore,
	isAfter
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { RecurrenceType, RecurrenceConfig } from '$lib/types/planning.types';

/**
 * Vrai si `d` tombe le dernier jour de son mois. Comparaison par `getDate()`
 * (pas par `isEqual`) — `endOfMonth` renvoie un Date à 23:59:59.999, donc la
 * comparaison temporelle stricte échouerait sur le jour-même.
 */
export function isLastDayOfMonth(d: Date): boolean {
	return d.getDate() === endOfMonth(d).getDate();
}

export function getNthDayOfMonth(date: Date, dayOfWeek: number, occurrence: number) {
	let currentDay = startOfMonth(date);
	const end = endOfMonth(date);

	let count = 0;
	while (currentDay <= end) {
		if (getDay(currentDay) === dayOfWeek) {
			count++;
			if (count === occurrence) {
				// Check if the found date is within the month of the original date
				if (currentDay.getMonth() === date.getMonth()) {
					return currentDay;
				} else {
					// If it crosses month boundary, the Nth occurrence doesn't exist for that month
					return null;
				}
			}
		}
		// Ensure we don't infinite loop if start is already end of month
		if (currentDay.getTime() === end.getTime()) break;
		currentDay = addDays(currentDay, 1);
	}
	return null; // Nth occurrence not found
}

export function getLastDayOfWeekInMonth(date: Date, dayOfWeek: number) {
	let currentDay = endOfMonth(date);

	// Go back max 6 days to find the last occurrence
	for (let i = 0; i < 7; i++) {
		if (getDay(currentDay) === dayOfWeek) {
			return currentDay;
		}
		if (currentDay.getDate() === 1) break; // Stop if we reach the beginning of the month
		currentDay = addDays(currentDay, -1);
	}
	return null;
}

export function getOccurrenceInMonth(date: Date) {
	const dayOfWeek = getDay(date);
	const monthStart = startOfMonth(date);
	const monthEnd = endOfMonth(date);
	let currentDay = monthStart;
	let count = 0;
	while (currentDay <= date) {
		if (getDay(currentDay) === dayOfWeek) {
			count++;
		}
		if (currentDay.getTime() === date.getTime()) break;
		if (currentDay >= monthEnd) break;
		currentDay = addDays(currentDay, 1);
	}
	// Vérifier si c'est la dernière occurrence du mois
	const nextOccurrence = addWeeks(date, 1);
	const isLast = nextOccurrence.getMonth() !== date.getMonth();

	return isLast ? 5 : count; // 5 pour 'Dernier'
}

function getOccurrenceLabel(occurrence: number): string {
	switch (occurrence) {
		case 1:
			return '1er';
		case 2:
			return '2ème';
		case 3:
			return '3ème';
		case 4:
			return '4ème';
		case 5:
			return 'Dernier';
		default:
			return '';
	}
}

export function getFormattedLabel(occurrence: number, date: string) {
	if (!occurrence || !date) return '';
	try {
		return `${getOccurrenceLabel(occurrence)} ${format(date, 'EEEE', { locale: fr })}`;
	} catch {
		return '';
	}
}

export const formatRecurrence = (recurrence: RecurrenceConfig): string => {
	const recurrenceTypes: Record<RecurrenceType, string> = {
		DAILY: 'Quotidienne',
		WEEKLY: 'Hebdomadaire',
		BIWEEKLY: 'Bi-hebdomadaire',
		MONTHLY_BY_DATE: 'Mensuel (date fixe)',
		MONTHLY_BY_DAY: 'Mensuel',
		CUSTOM: 'Choix libre des dates'
	};

	return recurrenceTypes[recurrence.type] || recurrence.type;
};

/**
 * Génère une description lisible de la récurrence
 * @param recurrence - L'objet de récurrence à décrire
 * @returns Une chaîne décrivant la récurrence de manière lisible
 */
export function getRecurrenceLabel(recurrence: RecurrenceConfig): string {
	if (!recurrence.firstDate || !recurrence.type) return '';

	try {
		const firstDate =
			typeof recurrence.firstDate === 'string'
				? parse(recurrence.firstDate, 'yyyy-MM-dd', new Date())
				: new Date(recurrence.firstDate);

		const weekdayName = format(firstDate, 'EEEE', { locale: fr });
		const dateNumber = format(firstDate, 'd', { locale: fr });

		switch (recurrence.type) {
			case 'DAILY':
				return `Tous les jours`;

			case 'WEEKLY':
				return `Tous les ${weekdayName}s`;

			case 'BIWEEKLY':
				return `Un ${weekdayName} sur deux`;

			case 'MONTHLY_BY_DATE':
				if (recurrence.monthlyByDateMode === 'last-day') {
					return `Le dernier jour du mois`;
				}
				return `Tous les ${dateNumber} du mois`;

			case 'MONTHLY_BY_DAY': {
				const occurrences = recurrence.monthlyByDayOccurrences;
				if (!occurrences?.length) {
					return `Tous les ${weekdayName}s du mois`;
				}

				if (occurrences.length === 1) {
					return getFormattedLabel(occurrences[0], recurrence.firstDate);
				}

				const ordinals = occurrences.map((occurrence) => getOccurrenceLabel(occurrence)).sort();
				const formatter = new Intl.ListFormat('fr', { style: 'long', type: 'conjunction' });
				return `Les ${formatter.format(ordinals)} ${weekdayName}s du mois`;
			}

			case 'CUSTOM': {
				return 'Dates sélectionnées librement';
			}

			default:
				return '';
		}
	} catch (error) {
		console.error('Error formatting recurrence label:', error);
		return '';
	}
}

/**
 * Génère les dates de récurrence selon la configuration
 * @param recurrence - Configuration de récurrence
 * @returns Array de dates au format YYYY-MM-DD
 */
export function generateRecurrenceDates(recurrence: RecurrenceConfig): string[] {
	// Mode CUSTOM : pas de génération automatique (les occurrences sont la source
	// unique de vérité, portées par OccurrenceTarget côté formulaire).
	if (recurrence.type === 'CUSTOM') {
		return [];
	}

	const dates: string[] = [];
	const firstDate = parse(recurrence.firstDate || '', 'yyyy-MM-dd', new Date());
	const lastDate = parse(recurrence.lastDate || '', 'yyyy-MM-dd', new Date());

	if (isNaN(firstDate.getTime()) || isNaN(lastDate.getTime())) {
		return [];
	}

	// Cas spécial: MONTHLY_BY_DAY avec plusieurs occurrences par mois
	if (recurrence.type === 'MONTHLY_BY_DAY') {
		const dayOfWeek = getDay(firstDate);
		const occurrences = recurrence.monthlyByDayOccurrences || [getOccurrenceInMonth(firstDate)];

		// Parcourir tous les mois entre firstDate et lastDate
		let currentMonth = startOfMonth(firstDate);

		while (currentMonth <= endOfMonth(lastDate)) {
			// Pour chaque occurrence demandée, générer la date
			for (const occurrence of occurrences) {
				let dateForOccurrence: Date | null;

				if (occurrence === 5) {
					// 'Dernier' (5 = dernier)
					dateForOccurrence = getLastDayOfWeekInMonth(currentMonth, dayOfWeek);
				} else {
					// N-ième occurrence (1, 2, 3, 4)
					dateForOccurrence = getNthDayOfMonth(currentMonth, dayOfWeek, occurrence);
				}

				// Vérifier que la date est valide et dans l'intervalle
				if (
					dateForOccurrence &&
					!isBefore(dateForOccurrence, firstDate) &&
					!isAfter(dateForOccurrence, lastDate)
				) {
					const formattedDate = format(dateForOccurrence, 'yyyy-MM-dd');
					if (!dates.includes(formattedDate)) {
						dates.push(formattedDate);
					}
				}
			}

			// Passer au mois suivant
			currentMonth = addMonths(currentMonth, 1);
		}

		// Trier les dates par ordre chronologique
		dates.sort((a, b) => {
			const dateA = parse(a, 'yyyy-MM-dd', new Date());
			const dateB = parse(b, 'yyyy-MM-dd', new Date());
			return dateA.getTime() - dateB.getTime();
		});

		return dates;
	}

	// Cas spécial: MONTHLY_BY_DATE — calcul depuis firstDate (pas de réaffectation
	// de currentDate) pour éviter le clamp composé d'addMonths. Deux modes :
	//  - 'last-day' (uniquement si firstDate est dernier de son mois) : chaque
	//    occurrence tombe en fin de mois via endOfMonth.
	//  - 'fixed-day' (défaut, ou inertie implicite quand firstDate n'est pas
	//    dernier de mois) : on ne pousse que les dates dont le jour == firstDate.getDate().
	//    Les mois sans ce jour sont skip (RFC 5545).
	if (recurrence.type === 'MONTHLY_BY_DATE') {
		const useLastDay = recurrence.monthlyByDateMode === 'last-day' && isLastDayOfMonth(firstDate);

		let n = 0;
		while (true) {
			const candidate = useLastDay ? endOfMonth(addMonths(firstDate, n)) : addMonths(firstDate, n);
			// Comparaison sur la date calendaire : endOfMonth renvoie 23:59:59.999,
			// ce qui serait > à tout lastDate parsé à minuit.
			if (format(candidate, 'yyyy-MM-dd') > format(lastDate, 'yyyy-MM-dd')) break;

			if (useLastDay || candidate.getDate() === firstDate.getDate()) {
				dates.push(format(candidate, 'yyyy-MM-dd'));
			}
			n++;
			// Garde-fou défensif contre une boucle infinie en cas de logique cassée.
			if (n > 12 * 200) break;
		}
		return dates;
	}

	// Cas standards: WEEKLY, BIWEEKLY
	let currentDate = firstDate;

	while (currentDate <= lastDate) {
		dates.push(format(currentDate, 'yyyy-MM-dd'));

		switch (recurrence.type) {
			case 'DAILY':
				currentDate = addDays(currentDate, 1);
				break;

			case 'WEEKLY':
				currentDate = addWeeks(currentDate, 1);
				break;

			case 'BIWEEKLY':
				currentDate = addWeeks(currentDate, 2);
				break;

			default:
				// Unknown recurrence type, stop
				return dates;
		}
	}

	return dates;
}
