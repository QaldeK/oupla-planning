# Tests pour Notify Service

Cette suite de tests vérifie le bon fonctionnement du service de notifications Web Push.

## 🚀 Lancer les tests

### Prérequis

Le service notify-service doit être démarré dans un terminal séparé :

```bash
cd notify-service
bun run dev
```

### Tests basiques (sans vraie notification)

Ces tests vérifient que le service répond correctement sans envoyer de vraies notifications :

```bash
# Terminal 1: Démarrer le service
cd notify-service
bun run dev

# Terminal 2: Lancer les tests
bun run tests/test-notification.ts
```

Résultat attendu :

```
╔═══════════════════════════════════════════════════════╗
║     🧪 Notify Service - Test Suite                    ║
╚═══════════════════════════════════════════════════════╝

📍 Service URL: http://localhost:3001

📋 Test 1: Health Check
─────────────────────────────────────────────────────────
✅ Status: 200
📄 Response: { "status": "healthy", ... }

📋 Test 2: Informations du service
─────────────────────────────────────────────────────────
✅ Status: 200
📄 Response: { "service": "Oupla Notify Service", ... }

...

╔═══════════════════════════════════════════════════════╗
║     📊 Résumé des tests                               ║
╚═══════════════════════════════════════════════════════╝

✅ Health check
✅ Service info
✅ Invalid subscription
✅ Missing fields
⏭️  Real notification

──────────────────────────────────────────────────────────
Total: 4/4 tests réussis

🎉 Tous les tests ont réussi !
```

## 📱 Test avec vraie notification

Pour tester l'envoi d'une **vraie notification** à votre navigateur :

### 1. Obtenir une subscription Push

Ouvrez votre application PWA dans le navigateur et exécutez dans la console :

```javascript
navigator.serviceWorker.ready.then((reg) =>
	reg.pushManager.getSubscription().then((sub) => {
		console.log(JSON.stringify(sub));
	})
);
```

Copiez le JSON affiché (c'est votre subscription).

### 2. Lancer le test avec la subscription

```bash
SUBSCRIPTION='{"endpoint":"https://fcm.googleapis.com/...","keys":{"p256dh":"...","auth":"..."}}' \
bun run tests/test-notification.ts
```

Si tout fonctionne, vous recevrez une notification sur votre navigateur/mobile !

## 📋 Description des tests

| Test                     | Description                          | Attendu                         |
| ------------------------ | ------------------------------------ | ------------------------------- |
| **Health Check**         | Vérifie que le service est démarré   | Status 200                      |
| **Service Info**         | Récupère les informations du service | Status 200                      |
| **Invalid Subscription** | Teste la gestion des erreurs         | Status 4xx                      |
| **Missing Fields**       | Teste la validation des entrées      | Status 400                      |
| **Real Notification**    | Envoie une vraie notification        | Status 200 + notification reçue |

## 🔧 Variables d'environnement

- `SERVICE_URL` - URL du service (défaut: `http://localhost:3001`)
- `SUBSCRIPTION` - Subscription Push JSON (optionnel, pour test réel)

Exemple :

```bash
SERVICE_URL=http://localhost:3001 \
SUBSCRIPTION='{"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}' \
bun run tests/test-notification.ts
```

## 🐛 Débogage

### Le service ne démarre pas

```bash
# Vérifier que le port 3001 est libre
lsof -i :3001

# Vérifier les variables d'environnement
cat notify-service/.env
```

### Les tests échouent

```bash
# Vérifier que le service est accessible
curl http://localhost:3001/health

# Vérifier les logs du service
# (terminal où bun run dev est lancé)
```

### Notification non reçue

1. Vérifiez que les notifications sont autorisées dans le navigateur
2. Vérifiez que le service worker est actif
3. Vérifiez la clé VAPID publique dans le frontend (doit correspondre à la clé privée du service)

## 📝 Ressources

- [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [web-push npm library](https://www.npmjs.com/package/web-push)
- [VAPID keys generator](https://vapidkeys.com/)
