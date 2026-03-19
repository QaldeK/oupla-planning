import { pb } from '$lib/pocketbase/pb';
import { toast } from 'svelte-sonner';
import { userStore } from '$lib/stores/userStore.svelte';
import type { PlanningMaster, PlanningOccurrence, SavedPlanning } from '$lib/types/planning.types';
import { withPocketBaseTimeout } from '$lib/stores/networkStore.svelte';

/**
 * Structure des événements PocketBase Realtime
 */
interface RealtimeEvent {
	action: 'create' | 'update' | 'delete';
	record: any;
	[key: string]: any;
}

/**
 * Service de gestion des abonnements PocketBase Realtime
 *
 * Gère deux subscriptions :
 * - Une pour le planning master (record spécifique)
 * - Une pour toutes les occurrences liées au master (filtré par query params)
 *
 * Pattern class-based store avec Svelte 5 runes ($state)
 */
class RealtimeService {
	// État des abonnements actifs (per-page - ancien système)
	private masterUnsub: (() => Promise<void>) | null = null;
	private occurrencesUnsub: (() => Promise<void>) | null = null;
	private currentMasterId: string | null = null;
	private currentToken: string | null = null;

	// NEW: Global subscription unsubscribers
	private mastersGlobalUnsub: (() => Promise<void>) | null = null;
	private occurrencesGlobalUnsub: (() => Promise<void>) | null = null;

	// NEW: Track current subscriptions
	subscribedTokens = $state<Set<string>>(new Set());
	subscribedMasterIds = $state<Set<string>>(new Set());

	// Callbacks pour les événements realtime
	private callbacks = {
		onMasterChange: null as ((action: string, record: PlanningMaster) => void) | null,
		onOccurrenceChange: null as ((action: string, record: PlanningOccurrence) => void) | null,
		onReconnect: null as (() => void) | null
	};

	/**
	 * S'abonner aux changements d'un master et ses occurrences
	 *
	 * @param masterId - ID du planning master
	 * @param token - Token d'authentification (admin ou participant)
	 * @param callbacks - Callbacks pour les différents événements
	 */
	async subscribeToMaster(
		masterId: string,
		token: string,
		callbacks: {
			onMasterChange?: (action: string, record: PlanningMaster) => void;
			onOccurrenceChange?: (action: string, record: PlanningOccurrence) => void;
			onReconnect?: () => void;
		}
	) {
		// Si déjà abonné au même master avec le même token, juste mettre à jour les callbacks
		if (this.currentMasterId === masterId && this.currentToken === token) {
			console.log('🔄 Realtime: Déjà abonné à ce master, mise à jour des callbacks uniquement');
			this.callbacks = {
				onMasterChange: callbacks.onMasterChange || null,
				onOccurrenceChange: callbacks.onOccurrenceChange || null,
				onReconnect: callbacks.onReconnect || null
			};
			return;
		}

		// Se désabonner des connexions précédentes si nécessaire
		if (this.masterUnsub || this.occurrencesUnsub) {
			await this.unsubscribe();
		}

		this.currentMasterId = masterId;
		this.currentToken = token;
		this.callbacks = {
			onMasterChange: callbacks.onMasterChange || null,
			onOccurrenceChange: callbacks.onOccurrenceChange || null,
			onReconnect: callbacks.onReconnect || null
		};

		try {
			// 1. S'abonner au master (record spécifique)
			await this.subscribeToMasterRecord(masterId, token);

			// 2. S'abonner aux occurrences (collection avec filtre)
			await this.subscribeToOccurrencesCollection(masterId, token);

			console.log('✅ Realtime: Abonnements actifs pour master', masterId);
		} catch (error) {
			console.error('❌ Realtime: Erreur lors de la souscription:', error);
			toast.error('Erreur de connexion temps réel');
			throw error;
		}
	}

	/**
	 * Subscribe to all user's plannings globally
	 * Replaces per-page subscriptions with 2 global subscriptions
	 *
	 * @param savedPlannings - List of user's saved plannings
	 */
	async subscribeGlobally(savedPlannings: SavedPlanning[]): Promise<void> {
		const participantTokens = savedPlannings.map((p) => p.participantToken);
		const masterIds = savedPlannings.map((p) => p.masterId);

		// Construction des filtres IN avec syntaxe ?=
		const tokensFilter = `participantToken ?= ${JSON.stringify(participantTokens)}`;
		const mastersFilter = `master ?= ${JSON.stringify(masterIds)}`;

		try {
			// 1. Abonnement unique à planning_masters
			this.mastersGlobalUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe('planning_masters', (e) => this.handleMasterChangeGlobal(e), {
					query: {
						filter: tokensFilter
					},
					fields: 'id,title,description,place,defaultStartTime'
				}),
				8000
			);

			// 2. Abonnement unique à planning_occurrences
			this.occurrencesGlobalUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe('planning_occurrences', (e) => this.handleOccurrenceChangeGlobal(e), {
					query: {
						filter: mastersFilter
					},
					fields: 'id,master,date,startTime,endTime,place,comments,isConfirmed,isCanceled'
				}),
				8000
			);

			// Track subscriptions
			this.subscribedTokens = new Set(participantTokens);
			this.subscribedMasterIds = new Set(masterIds);

			console.log(
				'✅ Realtime: Global subscriptions active for',
				savedPlannings.length,
				'plannings'
			);
		} catch (error) {
			console.error('❌ Realtime: Error during global subscription:', error);
			toast.error('Erreur de connexion temps réel');
			throw error;
		}
	}

	/**
	 * S'abonner aux changements du master record
	 */
	private async subscribeToMasterRecord(masterId: string, token: string) {
		try {
			// Utiliser pb.realtime.subscribe avec le topic du record spécifique

			this.masterUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe(
					`planning_masters/${masterId}`,
					(e) => {
						console.log('📡 Realtime EVENT (Master):', e.action, e.record.id);
						this.handleMasterChange(e.action, e.record);
					},
					{
						query: { _token: token },
						fields:
							'id,title,description,place,defaultStartTime,defaultEndTime,recurrence,tasks,participants,allowResponses,toConfirm,minPresentRequired,lastModifiedBy,created,updated'
					}
				),
				8000 // 8 secondes timeout
			);

			console.log('✅ Realtime: Abonné au master', masterId);
		} catch (error) {
			console.error('❌ Realtime: Erreur subscription master:', error);
			throw error;
		}
	}

	/**
	 * S'abonner aux changements des occurrences (filtré par master)
	 */
	private async subscribeToOccurrencesCollection(masterId: string, token: string) {
		try {
			this.occurrencesUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe(
					`planning_occurrences`,
					(e) => {
						this.handleOccurrenceChange(e.action, e.record);
					},
					{
						query: {
							master: masterId,
							_token: token
						},
						fields:
							'id,master,date,startTime,endTime,place,description,tasks,responses,comments,isConfirmed,isCanceled,minPresentRequired,lastModifiedBy,created,updated'
					}
				),
				8000 // 8 secondes timeout
			);

			console.log('✅ Realtime: Abonné aux occurrences du master', masterId);
		} catch (error) {
			console.error('❌ Realtime: Erreur subscription occurrences:', error);
			throw error;
		}
	}

	/**
	 * Gérer les changements du master
	 */
	private handleMasterChange(action: string, record: any) {
		console.log('🔔 handleMasterChange called:', action, record.title);
		if (!this.callbacks.onMasterChange) {
			console.warn('⚠️ No onMasterChange callback registered!');
			return;
		}

		try {
			// Mapper les types PocketBase vers nos types de manière concise
			const master: PlanningMaster = {
				...record,
				tasks: record.tasks || [],
				participants: record.participants || []
			};

			this.callbacks.onMasterChange(action, master);

			// Afficher un toast pour les actions pertinentes (uniquement si ce n'est pas nous)
			if (action === 'update' && record.lastModifiedBy !== userStore.globalProfile?.id) {
				toast.info('Planning mis à jour');
			}
		} catch (error) {
			console.error('❌ Realtime: Erreur traitement master change:', error);
		}
	}

	/**
	 * Gérer les changements des occurrences
	 */
	private handleOccurrenceChange(action: string, record: any) {
		if (!this.callbacks.onOccurrenceChange) return;

		try {
			// Mapper les types PocketBase vers nos types de manière concise
			const occurrence: PlanningOccurrence = {
				...record,
				tasks: record.tasks || [],
				responses: record.responses || [],
				comments: record.comments || []
			};

			this.callbacks.onOccurrenceChange(action, occurrence);

			// Afficher un toast contextuel selon l'action
			this.showOccurrenceToast(action, occurrence);
		} catch (error) {
			console.error('❌ Realtime: Erreur traitement occurrence change:', error);
		}
	}

	/**
	 * Gérer les changements du master (global subscription)
	 */
	private handleMasterChangeGlobal(e: RealtimeEvent) {
		const { action, record } = e;

		// Filter: only process events for subscribed plannings
		if (action === 'update' || action === 'delete') {
			const masterId = record.id;
			if (this.subscribedMasterIds.has(masterId)) {
				// Trigger store refresh
				// TODO: Delegate to notificationStore in iteration 3
				console.log('📡 Global: Master changed:', masterId);
			}
		}
	}

	/**
	 * Gérer les changements des occurrences (global subscription)
	 */
	private handleOccurrenceChangeGlobal(e: RealtimeEvent) {
		const { action, record } = e;

		// Filter: uniquement commentaires et changements de statut
		if (action === 'update') {
			const occurrence = record;
			const hasNewComments = occurrence.comments?.length > 0;
			const isStatusChange = occurrence.isConfirmed || occurrence.isCanceled;

			if (hasNewComments || isStatusChange) {
				// TODO: Déléguer à notificationStore (itération 3)
				// Pour l'instant : ne rien faire (suppression des toasts superflus)
				console.log(
					'📡 Global: Occurrence changed:',
					occurrence.id,
					'Comments:',
					hasNewComments,
					'Status:',
					isStatusChange
				);
			}
		}
	}

	/**
	 * Afficher un toast approprié selon le type de changement
	 */
	private showOccurrenceToast(action: string, occurrence: PlanningOccurrence) {
		// Ne pas afficher de toast si c'est nous qui avons fait la modification
		if (occurrence.lastModifiedBy && occurrence.lastModifiedBy === userStore.globalProfile?.id) {
			return;
		}
		const hasNewResponses = occurrence.responses.length > 0;
		const hasNewComments = occurrence.comments && occurrence.comments.length > 0;

		switch (action) {
			case 'create':
				toast.success(`Nouvelle occurrence le ${this.formatDate(occurrence.date)}`);
				break;
			case 'update':
				// Détecter le type de mise à jour pour un message plus spécifique

				if (hasNewResponses) {
					toast.success(`Une réponse a été enregistrée`);
				} else if (hasNewComments) {
					toast.success(`Nouveau commentaire`);
				} else {
					toast.info(`Occurrence du ${this.formatDate(occurrence.date)} mise à jour`);
				}
				break;
			case 'delete':
				toast.info(`Occurrence du ${this.formatDate(occurrence.date)} supprimée`);
				break;
		}
	}

	/**
	 * Formater une date pour les toasts
	 */
	private formatDate(dateStr: string): string {
		try {
			const date = new Date(dateStr);
			return date.toLocaleDateString('fr-FR', {
				day: 'numeric',
				month: 'short'
			});
		} catch {
			return dateStr;
		}
	}

	/**
	 * Se désabonner de tous les abonnements actifs
	 */
	async unsubscribe() {
		console.log('🔌 Realtime: Désabonnement en cours...');

		try {
			if (this.masterUnsub) {
				await this.masterUnsub();
				this.masterUnsub = null;
			}
		} catch (error) {
			console.error('❌ Realtime: Erreur désabonnement master:', error);
		}

		try {
			if (this.occurrencesUnsub) {
				await this.occurrencesUnsub();
				this.occurrencesUnsub = null;
			}
		} catch (error) {
			console.error('❌ Realtime: Erreur désabonnement occurrences:', error);
		}

		this.currentMasterId = null;
		this.currentToken = null;
		this.callbacks = {
			onMasterChange: null,
			onOccurrenceChange: null,
			onReconnect: null
		};

		console.log('✅ Realtime: Désabonné');
	}

	/**
	 * Unsubscribe from global realtime subscriptions
	 */
	async unsubscribeGlobally(): Promise<void> {
		console.log('🔌 Realtime: Global unsubscription in progress...');

		try {
			if (this.mastersGlobalUnsub) {
				await this.mastersGlobalUnsub();
				this.mastersGlobalUnsub = null;
			}
		} catch (error) {
			console.error('❌ Realtime: Error unsubscribing from masters:', error);
		}

		try {
			if (this.occurrencesGlobalUnsub) {
				await this.occurrencesGlobalUnsub();
				this.occurrencesGlobalUnsub = null;
			}
		} catch (error) {
			console.error('❌ Realtime: Error unsubscribing from occurrences:', error);
		}

		this.subscribedTokens.clear();
		this.subscribedMasterIds.clear();

		console.log('✅ Realtime: Global unsubscribed');
	}
}

// Export du singleton
export const realtimeService = new RealtimeService();
