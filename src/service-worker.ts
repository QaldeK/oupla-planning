/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// Installation du Service Worker
self.addEventListener('install', (event) => {
	console.log('📦 Service Worker installé');
	// Skip waiting pour activer immédiatement le nouveau SW
	self.skipWaiting();
});

// Activation du Service Worker
self.addEventListener('activate', (event) => {
	console.log('✅ Service Worker activé');
	// Prend le contrôle de toutes les pages immédiatement
	event.waitUntil(self.clients.claim());
});

// Gestion des notifications push
self.addEventListener('push', (event) => {
	const data = event.data?.json() ?? {};
	console.log('📬 Notification push reçue:', data);

	event.waitUntil(
		self.registration.showNotification(data.title ?? 'Oupla Planning', {
			body: data.body,
			icon: '/icon-192.png',
			badge: '/badge-72.png',
			data: { url: data.url ?? '/' },
			requireInteraction: false
		})
	);
});

// Clic sur une notification → ouvre l'URL correspondante
self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const urlToOpen = event.notification.data?.url ?? '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
			// Réutiliser un onglet existant si possible
			for (const client of clientList) {
				if ('navigate' in client && client.url === urlToOpen) {
					(client as WindowClient).focus();
					return;
				}
				if ('navigate' in client) {
					(client as WindowClient).focus();
					(client as WindowClient).navigate(urlToOpen);
					return;
				}
			}
			// Sinon ouvrir une nouvelle fenêtre
			return self.clients.openWindow(urlToOpen);
		})
	);
});
