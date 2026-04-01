/**
 * Global Setup — exécuté UNE SEULE FOIS avant tous les tests d'intégration.
 *
 * Rôle :
 *   - Vérifier que PocketBase est accessible sur http://127.0.0.1:8090
 *   - Authentifier un admin de test (test@example.com / testpassword)
 *   - Bloquer le lancement des tests si PB n'est pas démarré
 *
 * Ce fichier est importé automatiquement par Vitest grâce à la config
 * `globalSetup: ['tests/integration/globalSetup.ts']`.
 *
 * Prérequis :
 *   1. PocketBase démarré : ./pocketbase serve
 *   2. Admin créé : ./pocketbase admin create test@example.com testpassword
 *
 * Note : ce fichier ne crée PAS de données de test. Le seed est géré
 * dans chaque fichier .test.ts via les helpers de seed.ts.
 */
import PocketBase from 'pocketbase';

const PB_URL = process.env.VITE_PLANNING_PB_URL || 'http://127.0.0.1:8090';

export default async function globalSetup() {
	const pb = new PocketBase(PB_URL);

	try {
		await pb.collection('_superusers').authWithPassword('test@example.com', 'testpassword');
		console.log('✅ PocketBase reachable, admin authenticated');
	} catch {
		console.error('❌ PocketBase unreachable. Start it with: ./pocketbase serve');
		console.error('   Create admin with: ./pocketbase admin create test@example.com testpassword');
		throw new Error('PocketBase not available');
	}

	return async () => {
		// Cleanup after all tests
		console.log('🧹 Integration tests finished');
	};
}
