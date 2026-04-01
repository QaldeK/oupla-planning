// === Réponses ===
export type ResponseType = 'present' | 'if_needed' | 'maybe' | 'absent';

// === Participant ===
export interface Participant {
	id: string;
	name: string;
	email?: string;
	isAdmin: boolean;
	createdAt: string;
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

// === Occurrence ===
export type OccurrenceStatus = 'pending' | 'confirmed' | 'canceled';

export interface PlanningOccurrence {
	id: string;
	master: string; // Relation vers planning_masters (ID)
	masterId?: string; // Alias pour compatibilité (peut être dérivé de master)
	date: string; // YYYY-MM-DD
	startTime: string; // HH:MM
	endTime: string; // HH:MM
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
	// Dates finales sélectionnées (peut être un sous-ensemble des dates générées)
	recurrenceDates?: string[];
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
}

// === Comment State (local-only, Dexie) ===

export interface CommentState {
	occurrenceId: string;
	masterId: string;
	isUserInConversation: boolean;
	lastReadAt: string;
}
