import type { LucideIcon } from '@lucide/svelte';

// === Réponses ===
export type ResponseType = 'present' | 'if_needed' | 'maybe' | 'absent';

// === Participant ===
export interface Participant {
	id: string;
	name: string;
	email?: string;
	isAdmin: boolean;
	createdAt: string;
	hasQuit?: boolean;
	/**
	 * ID du compte PocketBase lié à ce participant.
	 * Présent uniquement si l'utilisateur s'est authentifié et a revendiqué/créé cette identité.
	 * Permet la migration guest → auth sans doublon.
	 * Note : c'est une simple string dans le JSON, pas une relation PB.
	 */
	userId?: string;
	/**
	 * Timestamp ISO du moment où ce participant a été revendiqué par un user auth
	 * (via /api/claim-participant-identity). Sert de marqueur « une seule revendication
	 * par planning » : si l'auth possède déjà un participant avec `claimedAt`, toute
	 * nouvelle revendication est rejetée (409). Absent pour les participants auto-ajoutés
	 * (CAS C) tant qu'aucune revendication n'a eu lieu.
	 */
	claimedAt?: string;
}

// === Réponse par occurrence ===
export interface ParticipantResponse {
	participantId: string;
	response: ResponseType;
	tasks: string[];
	comment?: string;
	respondedAt: string;
}

// === Commentaire ===
export interface OccurrenceComment {
	id: string;
	participantId: string;
	content: string;
	createdAt: string;
}

// === Tâche ===
export type TaskType = 'beforeEvent' | 'onEvent' | 'afterEvent';

export interface Task {
	id: string;
	name: string;
	description?: string;
	requiredVolunteers: number;
	type: TaskType;
}

// === Créneaux horaires (multi-slots) ===

/**
 * Template de créneau horaire, défini au niveau du master.
 * Sert de préset pour générer/configurer rapidement les occurrences.
 * Les occurrences peuvent diverger (override) — le slot n'est pas une contrainte stricte.
 */
export interface TimeSlot {
	/**
	 * Identifiant court et stable (type `s1`, `s2`). Sert de FK vers
	 * `PlanningOccurrence.slotId` : sa stabilité préserve l'identité d'une occurrence
	 * à travers les changements d'horaires de son template (nécessaire pour ne pas
	 * perdre responses/comments lors d'un pencil/apply en édition master).
	 * Les masters legacy non nettoyés peuvent encore porter des UUID ; les nouveaux
	 * slots utilisent `generateTimeSlotId()` (`planningActions.ts`).
	 */
	id: string;
	startTime: string; // HH:MM
	endTime: string; // HH:MM
}

/**
 * Combinaison date + créneau, unité de sélection dans le formulaire de récurrence.
 * `slotId` est optionnel : présent si la combinaison provient d'un template,
 * absent si l'horaire a été saisi librement (édition inline, Phase 2).
 */
export interface DateSlot {
	date: string; // YYYY-MM-DD
	startTime: string; // HH:MM
	endTime: string; // HH:MM
	slotId?: string; // optionnel : référence au template d'origine
}

/**
 * Occurrence cible : unifie création (virtuelle, sans `id`) et édition (réelle, avec `id`).
 * Porte l'état « voulu par l'admin » avant persistance — c'est le contrat formulaire↔service
 * (source unique de vérité côté UI). Les overrides d'horaires y sont portés tels quels ;
 * le service apply un diff contre les occurrences existantes sans re-dériver.
 */
export interface OccurrenceTarget {
	id?: string; // présent si occurrence réelle existante (filé au service pour le match par id)
	date: string; // YYYY-MM-DD
	startTime: string; // HH:MM (horaires voulus : template ou override)
	endTime: string; // HH:MM
	slotId?: string; // template d'origine (id court type s1)
	// Overrides optionnels (thin override / édition inline, Temps 3) :
	place?: string;
	tasks?: Task[] | null;
	minPresentRequired?: number;
}

// === Occurrence ===
export type OccurrenceStatus = 'pending' | 'confirmed' | 'canceled';

export interface PlanningOccurrence {
	id: string;
	master: string; // Relation vers planning_masters (ID)
	masterId?: string; // Alias pour compatibilité (peut être dérivé de master)
	date: string; // YYYY-MM-DD
	startTime: string; // HH:MM
	endTime: string; // HH:MM
	/**
	 * Référence au TimeSlot d'origine (id court type `s1`), utilisée comme clé de
	 * réconciliation (date|slotId) lors de l'update du master. Absent pour les
	 * occurrences legacy non migrées (slotId implicite résolu en `s1` côté service
	 * via `resolveTimeSlots`, mais non matché en réconciliation → soft-delete au save).
	 * Sert aussi de base au modèle dérivé : une occurrence est override ssi ses
	 * horaires divergent du slot référencé (cf. `isOverridden` dans planningActions).
	 */
	slotId?: string;
	place?: string;
	description?: string;
	tasks?: Task[] | null;
	responses: ParticipantResponse[];
	comments: OccurrenceComment[];
	isConfirmed: boolean;
	isCanceled: boolean;
	minPresentRequired?: number; // Nombre de présences minimum souhaité (overrides master)
	lastModifiedBy?: string; // ID de l'utilisateur ayant fait la dernière modif
	created: string;
	updated: string;
	deleted?: boolean; // Flag soft-delete (occurrence retirée du planning par l'admin)
}

// === Récurrence ===
export type RecurrenceType =
	| 'DAILY'
	| 'WEEKLY'
	| 'BIWEEKLY'
	| 'MONTHLY_BY_DATE'
	| 'MONTHLY_BY_DAY'
	| 'CUSTOM';

export interface RecurrenceConfig {
	type: RecurrenceType;
	firstDate?: string; // Optionnel pour CUSTOM
	lastDate?: string; // Optionnel pour CUSTOM
	// Pour MONTHLY_BY_DAY : quelles occurrences (1er, 2ème, 3ème, 4ème, Dernier)
	monthlyByDayOccurrences?: number[];
}

// === Planning Master ===
export interface PlanningMaster {
	id: string;
	title: string;
	description?: string;
	place?: string;
	defaultStartTime: string;
	defaultEndTime: string;
	/**
	 * Catalogue de créneaux horaires (canonical multi-slots). `defaultStartTime`/
	 * `defaultEndTime` restent en fallback pour les plannings legacy mono-créneau
	 * (et l'UI mono-slot), d'où leur conservation non-optionnelle ci-dessus.
	 */
	timeSlots?: TimeSlot[];
	toConfirm?: boolean;
	minPresentRequired: number; // Valeur par défaut pour les occurrences
	allowResponses: boolean;
	availableResponseTypes?: Exclude<ResponseType, 'no_response'>[]; // Types de réponses possibles
	recurrence: RecurrenceConfig;
	tasks: Task[];
	adminToken?: string; // 64 caractères hex (généré par le serveur)
	participantToken?: string; // 32 caractères hex (généré par le serveur)
	participants: Participant[];
	lastModifiedBy?: string; // ID de l'utilisateur ayant fait la dernière modif
	created: string;
	updated: string;
	deleted?: boolean; // Flag local Dexie (planning supprimé côté serveur)
}

export type ViewType = 'card' | 'compact' | 'minimal';
export type ThemeType = 'my' | 'nord-dark';

// === App Preferences ===

export interface AppPreferences {
	theme: ThemeType;
	occurrenceView: ViewType;
}

// === LocalStorage ===

// Identité spécifique à un planning
export interface PlanningIdentity {
	id: string; // participantId sur CE planning
	name: string; // Nom utilisé sur CE planning
	email?: string;
}

export interface SavedPlanning {
	masterId: string;
	currentUser?: PlanningIdentity;
	/** true si l'identité guest a quitté ce planning (localMeta uniquement) */
	hasQuit?: boolean;
	/**
	 * Timestamp UTC ISO du dernier fetch réussi des occurrences pour ce master.
	 * Utilisé par `planningStore` comme `since` de la delta sync `initialFetch`,
	 * pour éviter le bug du `since` global calculé via `table.orderBy('updated').last()`
	 * qui devient incohérent quand un filtre `master = X` est appliqué.
	 * Nettoyé automatiquement avec `localMeta.clear()` (logout, transitions).
	 */
	lastFetchAt?: string;
}

// === Comment State (local-only, Dexie) ===

export interface CommentState {
	occurrenceId: string;
	masterId: string;
	isUserInConversation: boolean;
	lastReadAt: string;
}

export interface ResponseTypeConfig {
	label: string;
	icon: LucideIcon;
	badgeClass: string;
	bgClass: string;
	bgClass10: string;
	btnClass: string;
	ringClass: string;
	borderClass: string;
}
