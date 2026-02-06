import { format, isValid, parse } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Formate une date au format français
 * @param date - Date string (ISO 8601: YYYY-MM-DDTHH:mm:ss.SSSZ) ou Date object
 * @param formatStr - Format de sortie (défaut: 'd MMMM yyyy')
 * @returns Date formatée
 */
export function formatDate(date: string | Date, formatStr: string = 'd MMMM yyyy'): string {
	try {
		const dateObj = typeof date === 'string' ? new Date(date) : date;
		if (!isValid(dateObj)) return '';
		return format(dateObj, formatStr, { locale: fr });
	} catch {
		return '';
	}
}

/**
 * Formate une date au format court (ex: 15 jan. 2024)
 */
export function formatDateShort(date: string | Date): string {
	return formatDate(date, 'eee d MMM');
}

/**
 * Formate une date avec le jour de la semaine (ex: Lundi 15 janvier 2024)
 */
export function formatDateWithDay(date: string | Date): string {
	return formatDate(date, 'EEEE d MMMM yyyy');
}

/**
 * Formate une heure au format HH:MM
 */
export function formatTime(time: string): string {
	// Si déjà au bon format, retourner tel quel
	if (/^\d{2}:\d{2}$/.test(time)) return time;

	try {
		const date = parse(time, 'HH:mm:ss', new Date());
		if (!isValid(date)) return time;
		return format(date, 'HH:mm');
	} catch {
		return time;
	}
}

/**
 * Formate une plage horaire (ex: 14:00 - 16:00)
 */
export function formatTimeRange(startTime: string, endTime: string): string {
	return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

/**
 * Retourne la date du jour au format YYYY-MM-DD
 */
export function getTodayString(): string {
	return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Vérifie si une date est dans le passé
 */
export function isPast(date: string | Date): boolean {
	try {
		const dateObj = typeof date === 'string' ? new Date(date) : date;
		if (!isValid(dateObj)) return false;
		return dateObj < new Date();
	} catch {
		return false;
	}
}

/**
 * Vérifie si une date est aujourd'hui
 */
export function isToday(date: string | Date): boolean {
	try {
		const dateObj = typeof date === 'string' ? new Date(date) : date;
		if (!isValid(dateObj)) return false;
		return format(dateObj, 'yyyy-MM-dd') === getTodayString();
	} catch {
		return false;
	}
}
