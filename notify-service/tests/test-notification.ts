#!/usr/bin/env bun
/**
 * Script de test pour notify-service
 *
 * Ce script teste l'envoi de notifications Web Push via le service.
 *
 * Usage:
 *   bun run tests/test-notification.ts
 *
 * Prérequis:
 *   - Le service notify-service doit être démarré (bun run dev)
 *   - Vous devez avoir une vraie subscription Push d'un navigateur
 */

interface NotificationPayload {
	subscription: {
		endpoint: string;
		keys: {
			p256dh: string;
			auth: string;
		};
	};
	title: string;
	body: string;
	url?: string;
	icon?: string;
}

interface TestResponse {
	success?: boolean;
	message?: string;
	error?: string;
	details?: string;
	statusCode?: number;
}

// Configuration
const SERVICE_URL = process.env.SERVICE_URL || 'http://localhost:3001';

/**
 * Test 1: Health check
 */
async function testHealthCheck(): Promise<boolean> {
	console.log('\n📋 Test 1: Health Check');
	console.log('─'.repeat(50));

	try {
		const response = await fetch(`${SERVICE_URL}/health`);
		const data = await response.json();

		console.log('✅ Status:', response.status);
		console.log('📄 Response:', JSON.stringify(data, null, 2));

		return response.status === 200 && data.status === 'healthy';
	} catch (error) {
		console.error('❌ Erreur:', error);
		return false;
	}
}

/**
 * Test 2: Informations du service
 */
async function testServiceInfo(): Promise<boolean> {
	console.log('\n📋 Test 2: Informations du service');
	console.log('─'.repeat(50));

	try {
		const response = await fetch(`${SERVICE_URL}/`);
		const data = await response.json();

		console.log('✅ Status:', response.status);
		console.log('📄 Response:', JSON.stringify(data, null, 2));

		return response.status === 200;
	} catch (error) {
		console.error('❌ Erreur:', error);
		return false;
	}
}

/**
 * Test 3: Notification avec subscription invalide (doit échouer gracieusement)
 */
async function testInvalidSubscription(): Promise<boolean> {
	console.log('\n📋 Test 3: Notification avec subscription invalide');
	console.log('─'.repeat(50));

	const payload: NotificationPayload = {
		subscription: {
			endpoint: 'https://invalid.endpoint.com/test',
			keys: {
				p256dh: 'invalid_key',
				auth: 'invalid_auth'
			}
		},
		title: 'Test Notification',
		body: 'Ceci est un test de notification',
		url: 'https://planning.oupla.net'
	};

	try {
		const response = await fetch(`${SERVICE_URL}/notify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		const data: TestResponse = await response.json();

		console.log('✅ Status:', response.status);
		console.log('📄 Response:', JSON.stringify(data, null, 2));

		// Le test passe si le service gère l'erreur gracieusement
		return response.status >= 400 && response.status < 500;
	} catch (error) {
		console.error('❌ Erreur:', error);
		return false;
	}
}

/**
 * Test 4: Notification avec payload manquant (doit retourner 400)
 */
async function testMissingFields(): Promise<boolean> {
	console.log('\n📋 Test 4: Notification avec champs manquants');
	console.log('─'.repeat(50));

	const invalidPayload = {
		subscription: {
			endpoint: 'https://test.com'
			// Manque: keys, title, body
		}
	};

	try {
		const response = await fetch(`${SERVICE_URL}/notify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(invalidPayload)
		});

		const data: TestResponse = await response.json();

		console.log('✅ Status:', response.status);
		console.log('📄 Response:', JSON.stringify(data, null, 2));

		return response.status === 400;
	} catch (error) {
		console.error('❌ Erreur:', error);
		return false;
	}
}

/**
 * Test 5: Notification réelle (optionnel - nécessite une vraie subscription)
 */
async function testRealNotification(subscriptionString?: string): Promise<boolean> {
	if (!subscriptionString) {
		console.log('\n📋 Test 5: Notification réelle');
		console.log('─'.repeat(50));
		console.log('⏭️  Skip: Pas de subscription fournie');
		console.log('\n💡 Pour tester une vraie notification:');
		console.log('   1. Ouvrez votre application PWA dans un navigateur');
		console.log('   2. Activez les notifications push');
		console.log('   3. Copiez la subscription PushSubscription dans la console:');
		console.log('      navigator.serviceWorker.ready.then(reg => ');
		console.log('        reg.pushManager.getSubscription().then(sub => ');
		console.log('          console.log(JSON.stringify(sub))');
		console.log('        )');
		console.log('      )');
		console.log('   4. Relancez ce script avec:');
		console.log('      SUBSCRIPTION="..." bun run tests/test-notification.ts');
		return true;
	}

	console.log('\n📋 Test 5: Notification réelle');
	console.log('─'.repeat(50));

	try {
		const subscription = JSON.parse(subscriptionString);
		const payload: NotificationPayload = {
			subscription: subscription,
			title: '🧪 Test Notification',
			body: 'Si vous voyez ceci, le service fonctionne !',
			url: 'https://planning.oupla.net',
			icon: 'https://planning.oupla.net/icon-192.png'
		};

		console.log('📤 Envoi de la notification...');
		const response = await fetch(`${SERVICE_URL}/notify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		const data: TestResponse = await response.json();

		console.log('✅ Status:', response.status);
		console.log('📄 Response:', JSON.stringify(data, null, 2));

		if (response.status === 200) {
			console.log('\n🎉 Notification envoyée avec succès !');
			console.log('📱 Vérifiez votre navigateur/mobile.');
		}

		return response.status === 200;
	} catch (error) {
		console.error('❌ Erreur:', error);
		return false;
	}
}

/**
 * Main test runner
 */
async function main() {
	console.log('╔═══════════════════════════════════════════════════════╗');
	console.log('║     🧪 Notify Service - Test Suite                    ║');
	console.log('╚═══════════════════════════════════════════════════════╝');
	console.log(`\n📍 Service URL: ${SERVICE_URL}`);

	const subscription = process.env.SUBSCRIPTION;

	const results = {
		healthCheck: await testHealthCheck(),
		serviceInfo: await testServiceInfo(),
		invalidSubscription: await testInvalidSubscription(),
		missingFields: await testMissingFields(),
		realNotification: await testRealNotification(subscription)
	};

	// Résumé
	console.log('\n╔═══════════════════════════════════════════════════════╗');
	console.log('║     📊 Résumé des tests                               ║');
	console.log('╚═══════════════════════════════════════════════════════╝');

	const tests = Object.entries(results);
	const passed = tests.filter(([_, result]) => result).length;
	const total = tests.length;

	tests.forEach(([name, result]) => {
		const icon = result ? '✅' : '❌';
		const label = name.replace(/([A-Z])/g, ' $1').toLowerCase();
		console.log(`${icon} ${label.charAt(0).toUpperCase() + label.slice(1)}`);
	});

	console.log('\n' + '─'.repeat(50));
	console.log(`Total: ${passed}/${total} tests réussis`);

	if (passed === total) {
		console.log('\n🎉 Tous les tests ont réussi !');
		process.exit(0);
	} else {
		console.log('\n⚠️  Certains tests ont échoué');
		process.exit(1);
	}
}

// Run tests
main();
