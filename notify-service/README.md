# Notify Service

Service Web Push pour Oupla Planning - Envoie les notifications push aux navigateurs utilisateurs.

## 🚀 Fonctionnement

Ce service reçoit des demandes de notification via HTTP et utilise le protocole Web Push avec VAPID pour les envoyer aux navigateurs.

## 📦 Dépendances

- **Bun** - Runtime JavaScript ultra-rapide
- **web-push** - Bibliothèque Web Push avec support VAPID

## 🔧 Variables d'environnement

Copiez `.env.example` vers `.env` et configurez :

```bash
cp .env.example .env
```

### Variables requises

- `VAPID_PUBLIC_KEY` - Clé publique VAPID (générée avec `npx web-push generate-vapid-keys`)
- `VAPID_PRIVATE_KEY` - Clé privée VAPID (générée avec `npx web-push generate-vapid-keys`)

### Variables optionnelles

- `PORT` - Port d'écoute (défaut: `3001`)

## 🏃 Développement local

### 1. Installer les dépendances

```bash
bun install
```

### 2. Configurer les clés VAPID

```bash
npx web-push generate-vapid-keys
```

Ajoutez les clés générées dans `.env` :

```env
VAPID_PUBLIC_KEY=BC_...
VAPID_PRIVATE_KEY=...
```

### 3. Démarrer le serveur

```bash
# Mode développement (avec hot-reload)
bun run dev

# Mode production
bun run start
```

Le service démarre sur `http://localhost:3001`

## 📡 Endpoints API

### POST /notify

Envoie une notification push.

**Body :**

```json
{
	"subscription": {
		"endpoint": "https://fcm.googleapis.com/...",
		"keys": {
			"p256dh": "...",
			"auth": "..."
		}
	},
	"title": "Titre de la notification",
	"body": "Corps de la notification",
	"url": "https://planning.oupla.net/p/abc123",
	"icon": "https://planning.oupla.net/icon-192.png"
}
```

**Réponse :**

- `200 OK` - Notification envoyée avec succès
- `400 Bad Request` - Champs manquants
- `410 Gone` - Subscription expirée ou invalide
- `500 Internal Server Error` - Erreur lors de l'envoi

### GET /health

Health check pour le monitoring.

**Réponse :**

```json
{
	"status": "healthy",
	"service": "notify-service",
	"version": "1.0.0"
}
```

### GET /

Informations sur le service.

**Réponse :**

```json
{
	"service": "Oupla Notify Service",
	"version": "1.0.0",
	"endpoints": {
		"POST /notify": "Send a push notification",
		"GET /health": "Health check"
	}
}
```

## 🐳 Docker

### Build

```bash
docker build -t notify-service .
```

### Run

```bash
docker run -p 3001:3001 --env-file .env notify-service
```

## 🔗 Intégration PocketBase

Les hooks PocketBase appellent ce service via `$http.send()` :

```javascript
$http.send({
	method: 'POST',
	url: 'http://notify-service:3001/notify',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({
		subscription: user.get('push_subscription'),
		title: 'Rappel — Événement',
		body: 'Vous avez un événement demain',
		url: `https://planning.oupla.net/p/${token}`
	})
});
```

## 📝 Logs

Le service log les requêtes et erreurs :

- `📨 POST /notify` - Notification reçue
- `✅ Notification sent successfully` - Succès
- `⚠️  Subscription expirée ou invalide` - Subscription à supprimer
- `❌ Erreur envoi notification` - Erreur technique

## 🔒 Sécurité

- Le service **ne doit pas être exposé publiquement** sur Internet
- Seul PocketBase (en interne via Docker) doit pouvoir lui parler
- Les clés VAPID privées ne sont **jamais commitées** dans git
