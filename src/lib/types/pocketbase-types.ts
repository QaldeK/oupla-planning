/**
 * This file was @generated using pocketbase-typegen
 */

import type PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';

export enum Collections {
	Authorigins = '_authOrigins',
	Externalauths = '_externalAuths',
	Mfas = '_mfas',
	Otps = '_otps',
	Superusers = '_superusers',
	PlanningMasters = 'planning_masters',
	PlanningOccurrences = 'planning_occurrences',
	PlanningParticipants = 'planning_participants',
	Users = 'users'
}

// Alias types for improved usability
export type IsoDateString = string;
export type IsoAutoDateString = string & { readonly autodate: unique symbol };
export type RecordIdString = string;
export type FileNameString = string & { readonly filename: unique symbol };
export type HTMLString = string;

type ExpandType<T> = unknown extends T
	? T extends unknown
		? { expand?: unknown }
		: { expand: T }
	: { expand: T };

// System fields
export type BaseSystemFields<T = unknown> = {
	id: RecordIdString;
	collectionId: string;
	collectionName: Collections;
} & ExpandType<T>;

export type AuthSystemFields<T = unknown> = {
	email: string;
	emailVisibility: boolean;
	username: string;
	verified: boolean;
} & BaseSystemFields<T>;

// Record types for each collection

export type AuthoriginsRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	fingerprint: string;
	id: string;
	recordRef: string;
	updated: IsoAutoDateString;
};

export type ExternalauthsRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	id: string;
	provider: string;
	providerId: string;
	recordRef: string;
	updated: IsoAutoDateString;
};

export type MfasRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	id: string;
	method: string;
	recordRef: string;
	updated: IsoAutoDateString;
};

export type OtpsRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	id: string;
	password: string;
	recordRef: string;
	sentTo?: string;
	updated: IsoAutoDateString;
};

export type SuperusersRecord = {
	created: IsoAutoDateString;
	email: string;
	emailVisibility?: boolean;
	id: string;
	password: string;
	tokenKey: string;
	updated: IsoAutoDateString;
	verified?: boolean;
};

export type PlanningMastersRecord<
	TavailableResponseTypes = unknown,
	Tparticipants = unknown,
	Trecurrence = unknown,
	Ttasks = unknown
> = {
	adminToken: string;
	allowResponses?: boolean;
	availableResponseTypes?: null | TavailableResponseTypes;
	created: IsoAutoDateString;
	defaultEndTime: string;
	defaultStartTime: string;
	description?: string;
	id: string;
	lastModifiedBy?: string;
	minPresentRequired?: number;
	participantToken: string;
	participants?: null | Tparticipants;
	place?: string;
	recurrence: null | Trecurrence;
	tasks?: null | Ttasks;
	title: string;
	toConfirm?: boolean;
	updated: IsoAutoDateString;
};

export type PlanningOccurrencesRecord<
	Tcomments = unknown,
	Tresponses = unknown,
	Ttasks = unknown
> = {
	adminToken: string;
	comments?: null | Tcomments;
	created: IsoAutoDateString;
	date: IsoDateString;
	description?: string;
	endTime: string;
	id: string;
	isCanceled?: boolean;
	isConfirmed?: boolean;
	lastModifiedBy?: string;
	master: RecordIdString;
	minPresentRequired?: number;
	participantToken: string;
	place?: string;
	responses?: null | Tresponses;
	startTime: string;
	tasks?: null | Ttasks;
	updated: IsoAutoDateString;
};

export type PlanningParticipantsRecord = {
	created: IsoAutoDateString;
	email?: boolean;
	id: string;
	missingParticipantsDays?: number;
	onCancellation?: boolean;
	onTimeChange?: boolean;
	planning?: RecordIdString;
	push?: boolean;
	reminderDays?: number;
	updated: IsoAutoDateString;
	user?: RecordIdString;
};

export type UsersRecord<Tpush_subscription = unknown> = {
	avatar?: FileNameString;
	created: IsoAutoDateString;
	email: string;
	emailVisibility?: boolean;
	id: string;
	masterId?: RecordIdString[];
	name?: string;
	password: string;
	push_subscription?: null | Tpush_subscription;
	tokenKey: string;
	updated: IsoAutoDateString;
	verified?: boolean;
};

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> &
	BaseSystemFields<Texpand>;
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> &
	BaseSystemFields<Texpand>;
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>;
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>;
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> &
	AuthSystemFields<Texpand>;
export type PlanningMastersResponse<
	TavailableResponseTypes = unknown,
	Tparticipants = unknown,
	Trecurrence = unknown,
	Ttasks = unknown,
	Texpand = unknown
> = Required<PlanningMastersRecord<TavailableResponseTypes, Tparticipants, Trecurrence, Ttasks>> &
	BaseSystemFields<Texpand>;
export type PlanningOccurrencesResponse<
	Tcomments = unknown,
	Tresponses = unknown,
	Ttasks = unknown,
	Texpand = unknown
> = Required<PlanningOccurrencesRecord<Tcomments, Tresponses, Ttasks>> & BaseSystemFields<Texpand>;
export type PlanningParticipantsResponse<Texpand = unknown> = Required<PlanningParticipantsRecord> &
	BaseSystemFields<Texpand>;
export type UsersResponse<Tpush_subscription = unknown, Texpand = unknown> = Required<
	UsersRecord<Tpush_subscription>
> &
	AuthSystemFields<Texpand>;

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
	_authOrigins: AuthoriginsRecord;
	_externalAuths: ExternalauthsRecord;
	_mfas: MfasRecord;
	_otps: OtpsRecord;
	_superusers: SuperusersRecord;
	planning_masters: PlanningMastersRecord;
	planning_occurrences: PlanningOccurrencesRecord;
	planning_participants: PlanningParticipantsRecord;
	users: UsersRecord;
};

export type CollectionResponses = {
	_authOrigins: AuthoriginsResponse;
	_externalAuths: ExternalauthsResponse;
	_mfas: MfasResponse;
	_otps: OtpsResponse;
	_superusers: SuperusersResponse;
	planning_masters: PlanningMastersResponse;
	planning_occurrences: PlanningOccurrencesResponse;
	planning_participants: PlanningParticipantsResponse;
	users: UsersResponse;
};

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<
	{
		// Omit AutoDate fields
		[K in keyof T as Extract<T[K], IsoAutoDateString> extends never
			? K
			: never]: T[K] extends infer U // Convert FileNameString to File
			? U extends FileNameString | FileNameString[]
				? U extends any[]
					? File[]
					: File
				: U
			: never;
	},
	'id'
>;

// Create type for Auth collections
export type CreateAuth<T> = {
	id?: RecordIdString;
	email: string;
	emailVisibility?: boolean;
	password: string;
	passwordConfirm: string;
	verified?: boolean;
} & ProcessCreateAndUpdateFields<T>;

// Create type for Base collections
export type CreateBase<T> = {
	id?: RecordIdString;
} & ProcessCreateAndUpdateFields<T>;

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
	email?: string;
	emailVisibility?: boolean;
	oldPassword?: string;
	password?: string;
	passwordConfirm?: string;
	verified?: boolean;
};

// Update type for Base collections
export type UpdateBase<T> = Partial<Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>>;

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? CreateAuth<CollectionRecords[T]>
		: CreateBase<CollectionRecords[T]>;

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? UpdateAuth<CollectionRecords[T]>
		: UpdateBase<CollectionRecords[T]>;

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
	collection<T extends keyof CollectionResponses>(
		idOrName: T
	): RecordService<CollectionResponses[T]>;
} & PocketBase;
