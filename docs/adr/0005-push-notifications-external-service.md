# Push notifications via service Docker externe (JSVM ne peut pas)

Les notifications Web Push sont envoyées par un service Docker externe (`notify-service`, Node.js/Bun), et non directement depuis les hooks PocketBase JSVM. PocketBase appelle ce service en HTTP interne (`POST /notify`) depuis ses hooks (`cron-notifications.pb.js`, `notify-on-occurrence-update.pb.js`).

Ce n'est pas un choix architectural mais une contrainte technique : le JSVM de PocketBase (Goja, interpréteur JavaScript en Go) n'a pas accès à l'API Web Push (`web-push` npm), qui nécessite des primitives cryptographiques natives (VAPID, ECDSA) absentes de l'environnement Goja. Sans service externe, les notifications push seraient impossibles.

L'alternative (implémenter le push en Go dans PocketBase) aurait nécessité une extension compilée, ce qui va à l'encontre de l'architecture JSVM choisie pour la simplicité de déploiement. Les emails, en revanche, sont envoyés directement par PocketBase via son `MailerMessage` natif — pas de service externe nécessaire.
