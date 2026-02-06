import PocketBase from 'pocketbase';
import type { TypedPocketBase } from '$lib/types/pocketbase-types';

// URL de l'instance PocketBase dédiée au planning
// À configurer selon votre environnement
const PB_URL = import.meta.env.VITE_PLANNING_PB_URL || 'http://127.0.0.1:8090';

export const pb = new PocketBase(PB_URL) as TypedPocketBase;

// Désactiver l'auto-cancel pour éviter les problèmes avec les requêtes concurrentes
pb.autoCancellation(false);

// ============================================
// Gestion du token d'authentification
// ============================================
// Note: Le token est maintenant passé directement dans le body des requêtes
// via le champ _token. Voir createOccurrence dans planningActions.ts
