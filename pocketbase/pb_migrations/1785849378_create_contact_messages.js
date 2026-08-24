/// <reference path="../pb_data/types.d.ts" />

// Collection `contact_messages` — formulaire de contact public.
//
// Sécurité : toutes les API Rules à `null` (superuser uniquement). La création
// passe exclusivement par la route POST /api/contact (cf. pb_hooks/contact.pb.js),
// qui valide et persiste via $app.save — non soumis aux rules. Aucune lecture /
// écriture publique directe : les emails et messages des visiteurs ne fuient
// jamais via l'API. L'IP source est stockée sur un champ `hidden` (forensique
// anti-spam, jamais exposé dans une réponse API).

migrate((app) => {
	const collection = new Collection({
		type: 'base',
		name: 'contact_messages',
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
		fields: [
			{ name: 'email', type: 'email', required: true },
			{ name: 'name', type: 'text', max: 100 },
			{ name: 'subject', type: 'text', max: 150 },
			// Texte brut (pas editor) : le contenu est restitué dans l'email à
			// l'éditeur — un champ editor stockerait du HTML rendu (XSS mail).
			{ name: 'message', type: 'text', required: true, min: 10, max: 5000 },
			// Forensique anti-spam post-hoc. `hidden` = omis des réponses API.
			{ name: 'ip', type: 'text', hidden: true },
			// Champs système de traçabilité. PB 0.39 ne les ajoute pas
			// automatiquement : ils doivent être déclarés explicitement.
			{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false, system: true },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true, system: true }
		]
	});

	app.save(collection);
}, (app) => {
	const collection = app.findCollectionByNameOrId('contact_messages');
	app.delete(collection);
});
