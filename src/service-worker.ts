/// <reference lib="webworker" />

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Précache tous les assets statiques générés par Vite
precacheAndRoute(self.__WB_MANIFEST);

// SPA : toutes les navigations retournent index.html
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Gestion des notifications push
self.addEventListener('push', (e) => {
	const data = e.data?.json() ?? {};
	e.waitUntil(
		self.registration.showNotification(data.title ?? 'Oupla Planning', {
			body: data.body,
			icon: '/icon-192.png',
			badge: '/badge-72.png',
			data: { url: data.url ?? '/' }
		})
	);
});

// Clic sur une notification → ouvre l'URL correspondante
self.addEventListener('notificationclick', (e) => {
	e.notification.close();
	e.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
			// Réutiliser un onglet existant si possible
			for (const client of list) {
				if ('navigate' in client) {
					(client as WindowClient).focus();
					(client as WindowClient).navigate(e.notification.data.url);
					return;
				}
			}
			self.clients.openWindow(e.notification.data.url);
		})
	);
});
