import webPush from 'web-push';

// 🔍 DEBUG: Logger toutes les variables d'environnement AVANT toute vérification
console.log('🔍 [DEBUG] Démarrage du service...');
console.log("🔍 [DEBUG] Variables d'environnement:");
console.log(
	'  - VAPID_PUBLIC_KEY:',
	process.env.VAPID_PUBLIC_KEY
		? `${process.env.VAPID_PUBLIC_KEY.substring(0, 20)}...`
		: '❌ NON DÉFINIE'
);
console.log(
	'  - VAPID_PRIVATE_KEY:',
	process.env.VAPID_PRIVATE_KEY
		? 'Définie (longueur: ' + process.env.VAPID_PRIVATE_KEY.length + ')'
		: '❌ NON DÉFINIE'
);
console.log('  - VAPID_SUBJECT:', process.env.VAPID_SUBJECT || '❌ NON DÉFINIE');
console.log('  - PORT:', process.env.PORT || '3001 (défaut)');
console.log('🔍 [DEBUG] Node version:', process.version);
console.log('🔍 [DEBUG] Platform:', process.platform);
console.log('🔍 [DEBUG] CWD:', process.cwd());

// Configuration VAPID
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const port = parseInt(process.env.PORT || '3001');

if (!vapidPublicKey || !vapidPrivateKey) {
	console.error('❌ ERREUR: VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY doivent être définis');
	console.error('❌ [DEBUG] VAPID_PUBLIC_KEY existe:', !!vapidPublicKey);
	console.error('❌ [DEBUG] VAPID_PRIVATE_KEY existe:', !!vapidPrivateKey);
	process.exit(1);
}

webPush.setVapidDetails('mailto:contact@oupla.net', vapidPublicKey, vapidPrivateKey);

console.log('✅ Service de notifications Web Push initialisé');
console.log(`📡 Port: ${port}`);
console.log(`🔑 VAPID Public Key: ${vapidPublicKey.substring(0, 20)}...`);

// Interface pour le payload de notification
interface NotificationPayload {
	subscription: webPush.PushSubscription;
	title: string;
	body: string;
	url?: string;
	icon?: string;
}

// Handler pour le endpoint POST /notify
async function handleNotify(request: Request): Promise<Response> {
	try {
		// Parser le body
		const payload: NotificationPayload = await request.json();

		// Validation basique
		if (!payload.subscription || !payload.title || !payload.body) {
			return new Response(
				JSON.stringify({
					error: 'Missing required fields: subscription, title, body'
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Préparer les données de notification
		const notificationData = {
			title: payload.title,
			body: payload.body,
			url: payload.url || 'https://planning.oupla.net',
			icon: payload.icon || 'https://planning.oupla.net/icon-192.png'
		};

		// Envoyer la notification
		await webPush.sendNotification(payload.subscription, JSON.stringify(notificationData));

		return new Response(
			JSON.stringify({
				success: true,
				message: 'Notification sent successfully'
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		// Gérer les erreurs Web Push
		const err = error as { statusCode?: number; body?: string; message?: string };

		// Erreur commune: subscription expirée ou invalide
		if (err.statusCode === 410 || err.statusCode === 404) {
			console.warn('⚠️  Subscription expirée ou invalide:', err.body);
			return new Response(
				JSON.stringify({
					error: 'Subscription expired or invalid',
					statusCode: err.statusCode
				}),
				{ status: 410, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Autres erreurs
		console.error('❌ Erreur envoi notification:', err.message || err);
		return new Response(
			JSON.stringify({
				error: 'Failed to send notification',
				details: err.message || err
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

// Handler pour le health check
function handleHealthCheck(): Response {
	return new Response(
		JSON.stringify({
			status: 'healthy',
			service: 'notify-service',
			version: '1.0.0'
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

// Handler racine
function handleRoot(): Response {
	return new Response(
		JSON.stringify({
			service: 'Oupla Notify Service',
			version: '1.0.0',
			endpoints: {
				'POST /notify': 'Send a push notification',
				'GET /health': 'Health check'
			}
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

// Serveur HTTP principal
export default {
	port,
	fetch(request: Request): Promise<Response> | Response {
		const url = new URL(request.url);

		// Logger les requêtes
		console.log(`📨 ${request.method} ${url.pathname}`);

		// Router
		if (request.method === 'POST' && url.pathname === '/notify') {
			return handleNotify(request);
		}

		if (request.method === 'GET' && url.pathname === '/health') {
			return handleHealthCheck();
		}

		if (request.method === 'GET' && url.pathname === '/') {
			return handleRoot();
		}

		// 404
		return new Response(JSON.stringify({ error: 'Not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
