> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: `debt` · Urgence: `conditional` · Source: code-review du fix 403 · Ancre: `resolveWriteToken()` ; `planningStore.svelte.ts:630` et `:656`

- La règle « adminToken détenu, sinon token de la page » vit en trois endroits aux formes divergentes : `resolveWriteToken()` (écritures, adressage par index de token), `planningStore.svelte.ts:630` et `:656` (lectures, adressage par `activeMasterId` + coalescence). Un changement de règle exigerait trois éditions et les deux formes peuvent dériver ; extraire la règle ou assumer et documenter la divergence. Le JSDoc de `resolveWriteToken` renvoie à `refreshActive` : cette équivalence est documentaire, pas garantie par le code.
