import Dexie, { type Table } from 'dexie';
import type {
	PlanningMaster,
	PlanningOccurrence,
	SavedPlanning,
	CommentState
} from '$lib/types/planning.types';

export class AppDB extends Dexie {
	masters!: Table<PlanningMaster>;
	occurrences!: Table<PlanningOccurrence>;
	deletions!: Table<{ id: string; collection: string; recordId: string; deletedAt: string }>;
	localMeta!: Table<SavedPlanning, string>;
	commentState!: Table<CommentState>;

	constructor() {
		super('appDB');
		this.version(1).stores({
			masters: 'id, updated, participantToken, adminToken, deleted',
			occurrences: 'id, updated, master, deleted',
			deletions: 'id, collection, deletedAt, recordId'
		});
		this.version(2).stores({
			masters: 'id, updated, participantToken, adminToken, deleted',
			occurrences: 'id, updated, master, date, deleted',
			deletions: 'id, collection, deletedAt, recordId'
		});
		this.version(3).stores({
			masters: 'id, updated, participantToken, adminToken, deleted',
			occurrences: 'id, updated, master, date, deleted',
			deletions: 'id, collection, deletedAt, recordId',
			localMeta: 'masterId'
		});
		this.version(4).stores({
			commentState: 'occurrenceId, masterId, isUserInConversation, lastReadAt'
		});
		this.version(5).upgrade((tx) => {
			return tx
				.table('localMeta')
				.toCollection()
				.modify((record) => {
					delete record.title;
					delete record.adminToken;
					delete record.participantToken;
					delete record.lastAccessed;
					delete record.deletedAt;
				});
		});
	}
}

export const db = new AppDB();

// Strip Svelte 5 $state Proxy objects before Dexie writes.
// IndexedDB uses structuredClone internally, which cannot handle Proxy objects.
db.use({
	stack: 'dbcore',
	name: 'stripSvelteProxies',
	create(downlevelDatabase) {
		return {
			...downlevelDatabase,
			table(tableName) {
				const table = downlevelDatabase.table(tableName);
				return {
					...table,
					mutate(req) {
						if (req.type === 'put' || req.type === 'add') {
							req = {
								...req,
								values: req.values.map((v: unknown) =>
									JSON.parse(JSON.stringify(v as Record<string, unknown>))
								)
							};
						}
						return table.mutate(req);
					}
				};
			}
		};
	}
});
