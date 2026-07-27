/**
* This file was @generated using pocketbase-typegen
*/

import type PocketBase from 'pocketbase'
import type { RecordService } from 'pocketbase'

export const Collections = {
	Authorigins: "_authOrigins",
	Externalauths: "_externalAuths",
	Mfas: "_mfas",
	Otps: "_otps",
	Superusers: "_superusers",
	NotificationEvents: "notification_events",
	PlanningLocks: "planning_locks",
	PlanningMasters: "planning_masters",
	PlanningOccurrences: "planning_occurrences",
	PlanningParticipants: "planning_participants",
	Users: "users",
} as const
export type Collections = typeof Collections[keyof typeof Collections]

// Alias types for improved usability
export type IsoDateString = string
export type IsoAutoDateString = string & { readonly autodate: unique symbol }
export type RecordIdString = string
export type FileNameString = string & { readonly filename: unique symbol }
export type HTMLString = string

type ExpandType<T> = unknown extends T
	? T extends unknown
		? { expand?: unknown }
		: { expand: T }
	: { expand: T }

// System fields
export type BaseSystemFields<T = unknown> = {
	id: RecordIdString
	collectionId: string
	collectionName: Collections
} & ExpandType<T>

export type AuthSystemFields<T = unknown> = {
	email: string
	emailVisibility: boolean
	username: string
	verified: boolean
} & BaseSystemFields<T>

// Record types for each collection

export type AuthoriginsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	fingerprint: string
	id: string
	recordRef: string
	updated: IsoAutoDateString
}

export type ExternalauthsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	provider: string
	providerId: string
	recordRef: string
	updated: IsoAutoDateString
}

export type MfasRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	method: string
	recordRef: string
	updated: IsoAutoDateString
}

export type OtpsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	password: string
	recordRef: string
	sentTo?: string
	updated: IsoAutoDateString
}

export type SuperusersRecord = {
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	password: string
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

export const NotificationEventsTypeOptions = {
	"schedule_change": "schedule_change",
	"status_canceled": "status_canceled",
	"status_deleted": "status_deleted",
	"status_confirmed": "status_confirmed",
	"quorum_missing": "quorum_missing",
	"task_unassigned": "task_unassigned",
	"reminder": "reminder",
	"confirmation_needed": "confirmation_needed",
	"new_comment": "new_comment",
} as const
export type NotificationEventsTypeOptions = typeof NotificationEventsTypeOptions[keyof typeof NotificationEventsTypeOptions]
export type NotificationEventsRecord<Tpayload = unknown> = {
	attempts?: number
	changedBy?: string
	created: IsoAutoDateString
	id: string
	master: RecordIdString
	occurrence: RecordIdString
	payload?: null | Tpayload
	processedAt?: IsoDateString
	reminderValue?: number
	type: NotificationEventsTypeOptions
}

export type PlanningLocksRecord = {
	created: IsoAutoDateString
	id: string
	lockedAt: IsoAutoDateString
	lockedBy?: string
	lockedByName?: string
	master: RecordIdString
	updated: IsoAutoDateString
}

export type PlanningMastersRecord<TavailableResponseTypes = unknown, Tparticipants = unknown, Trecurrence = unknown, Ttasks = unknown, TtimeSlots = unknown> = {
	adminToken: string
	allowResponses?: boolean
	availableResponseTypes?: null | TavailableResponseTypes
	created: IsoAutoDateString
	defaultEndTime: string
	defaultStartTime: string
	deleted?: boolean
	description?: HTMLString
	id: string
	lastModifiedBy?: string
	locked?: boolean
	minPresentRequired?: number
	participantToken: string
	participants?: null | Tparticipants
	place?: string
	recurrence: null | Trecurrence
	tasks?: null | Ttasks
	timeSlots?: null | TtimeSlots
	title: string
	toConfirm?: boolean
	updated: IsoAutoDateString
}

export type PlanningOccurrencesRecord<Tcomments = unknown, Tresponses = unknown, Ttasks = unknown> = {
	comments?: null | Tcomments
	created: IsoAutoDateString
	date: IsoDateString
	deleted?: boolean
	description?: HTMLString
	endTime: string
	id: string
	isCanceled?: boolean
	isConfirmed?: boolean
	lastModifiedBy?: string
	master: RecordIdString
	minPresentRequired?: number
	place?: string
	responses?: null | Tresponses
	slotId?: string
	startTime: string
	tasks?: null | Ttasks
	updated: IsoAutoDateString
}

export const PlanningParticipantsReminderDaysOptions = {
	"E1": "1",
	"E3": "3",
	"E7": "7",
} as const
export type PlanningParticipantsReminderDaysOptions = typeof PlanningParticipantsReminderDaysOptions[keyof typeof PlanningParticipantsReminderDaysOptions]

export const PlanningParticipantsMissingDaysOptions = {
	"E1": "1",
	"E3": "3",
	"E7": "7",
	"E15": "15",
} as const
export type PlanningParticipantsMissingDaysOptions = typeof PlanningParticipantsMissingDaysOptions[keyof typeof PlanningParticipantsMissingDaysOptions]

export const PlanningParticipantsNewCommentScopeOptions = {
	"off": "off",
	"concerned": "concerned",
	"all": "all",
} as const
export type PlanningParticipantsNewCommentScopeOptions = typeof PlanningParticipantsNewCommentScopeOptions[keyof typeof PlanningParticipantsNewCommentScopeOptions]
export type PlanningParticipantsRecord<TcommentReadState = unknown> = {
	commentReadState?: null | TcommentReadState
	created: IsoAutoDateString
	email?: boolean
	id: string
	missingDays?: PlanningParticipantsMissingDaysOptions[]
	newCommentScope?: PlanningParticipantsNewCommentScopeOptions
	onConfirmationNeeded?: boolean
	onOccurrenceChange?: boolean
	planning?: RecordIdString
	push?: boolean
	reminderDays?: PlanningParticipantsReminderDaysOptions[]
	updated: IsoAutoDateString
	user?: RecordIdString
}

export const UsersLocaleOptions = {
	"fr": "fr",
	"en": "en",
} as const
export type UsersLocaleOptions = typeof UsersLocaleOptions[keyof typeof UsersLocaleOptions]
export type UsersRecord<TadminOf = unknown, Tpush_subscription = unknown> = {
	adminOf?: null | TadminOf
	avatar?: FileNameString
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	locale?: UsersLocaleOptions
	masterId?: RecordIdString[]
	name?: string
	password: string
	push_subscription?: null | Tpush_subscription
	pwa_installed?: boolean
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> & BaseSystemFields<Texpand>
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> & BaseSystemFields<Texpand>
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> & AuthSystemFields<Texpand>
export type NotificationEventsResponse<Tpayload = unknown, Texpand = unknown> = Required<NotificationEventsRecord<Tpayload>> & BaseSystemFields<Texpand>
export type PlanningLocksResponse<Texpand = unknown> = Required<PlanningLocksRecord> & BaseSystemFields<Texpand>
export type PlanningMastersResponse<TavailableResponseTypes = unknown, Tparticipants = unknown, Trecurrence = unknown, Ttasks = unknown, TtimeSlots = unknown, Texpand = unknown> = Required<PlanningMastersRecord<TavailableResponseTypes, Tparticipants, Trecurrence, Ttasks, TtimeSlots>> & BaseSystemFields<Texpand>
export type PlanningOccurrencesResponse<Tcomments = unknown, Tresponses = unknown, Ttasks = unknown, Texpand = unknown> = Required<PlanningOccurrencesRecord<Tcomments, Tresponses, Ttasks>> & BaseSystemFields<Texpand>
export type PlanningParticipantsResponse<TcommentReadState = unknown, Texpand = unknown> = Required<PlanningParticipantsRecord<TcommentReadState>> & BaseSystemFields<Texpand>
export type UsersResponse<TadminOf = unknown, Tpush_subscription = unknown, Texpand = unknown> = Required<UsersRecord<TadminOf, Tpush_subscription>> & AuthSystemFields<Texpand>

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
	_authOrigins: AuthoriginsRecord
	_externalAuths: ExternalauthsRecord
	_mfas: MfasRecord
	_otps: OtpsRecord
	_superusers: SuperusersRecord
	notification_events: NotificationEventsRecord
	planning_locks: PlanningLocksRecord
	planning_masters: PlanningMastersRecord
	planning_occurrences: PlanningOccurrencesRecord
	planning_participants: PlanningParticipantsRecord
	users: UsersRecord
}

export type CollectionResponses = {
	_authOrigins: AuthoriginsResponse
	_externalAuths: ExternalauthsResponse
	_mfas: MfasResponse
	_otps: OtpsResponse
	_superusers: SuperusersResponse
	notification_events: NotificationEventsResponse
	planning_locks: PlanningLocksResponse
	planning_masters: PlanningMastersResponse
	planning_occurrences: PlanningOccurrencesResponse
	planning_participants: PlanningParticipantsResponse
	users: UsersResponse
}

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<{
	// Omit AutoDate fields
	[K in keyof T as Extract<T[K], IsoAutoDateString> extends never ? K : never]: 
		// Convert FileNameString to File
		T[K] extends infer U ? 
			U extends (FileNameString | FileNameString[]) ? 
				U extends any[] ? File[] : File 
			: U
		: never
}, 'id'>

// Create type for Auth collections
export type CreateAuth<T> = {
	id?: RecordIdString
	email: string
	emailVisibility?: boolean
	password: string
	passwordConfirm: string
	verified?: boolean
} & ProcessCreateAndUpdateFields<T>

// Create type for Base collections
export type CreateBase<T> = {
	id?: RecordIdString
} & ProcessCreateAndUpdateFields<T>

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
	email?: string
	emailVisibility?: boolean
	oldPassword?: string
	password?: string
	passwordConfirm?: string
	verified?: boolean
}

// Update type for Base collections
export type UpdateBase<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>
>

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? CreateAuth<CollectionRecords[T]>
		: CreateBase<CollectionRecords[T]>

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? UpdateAuth<CollectionRecords[T]>
		: UpdateBase<CollectionRecords[T]>

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
	collection<T extends keyof CollectionResponses>(
		idOrName: T
	): RecordService<CollectionResponses[T]>
} & PocketBase
