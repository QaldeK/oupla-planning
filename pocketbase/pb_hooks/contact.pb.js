/// <reference path="../pb_data/types.d.ts" />

// Route publique POST /api/contact.
//
// Exception assumée au pattern d'auth par token (ADR-0001/0002) : un formulaire
// de contact doit rester accessible aux visiteurs non authentifiés (la page
// /legal le désigne comme canal officiel pour exercer les droits RGPD).
//
// Flow :
//   1. Honeypot — si `website` est rempli, on répond 200 sans rien stocker
//      (silence anti-bot : le robot ne doit pas apprendre qu'il a été détecté).
//   2. Validation stricte côté serveur — les rules de la collection sont à null
//      (superuser uniquement), la route est le seul point d'écriture public.
//   3. Persistance dans `contact_messages` avec l'IP source (forensique).
//   4. Email best-effort à l'éditeur (Reply-To = email du visiteur). L'envoi
//      échoue silencieusement en log : le record est déjà persisté, rien n'est
//      perdu si SMTP tombe.
//
// Tout est inliné dans le handler : les handlers JSVM sont isolés et ne voient
// pas les fonctions top-level du fichier. Aucun helper partagé nécessaire.

routerAdd('POST', '/api/contact', (e) => {
	const body = e.requestInfo().body || {};

	// 1. Honeypot — silencieux pour ne pas instruire le bot.
	if (body.website) {
		return e.json(200, { success: true });
	}

	// 2. Validation (tous les champs trimés).
	const email = String(body.email || '').trim();
	const name = String(body.name || '').trim();
	const subject = String(body.subject || '').trim();
	const message = String(body.message || '').trim();

	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new BadRequestError('Invalid email');
	}
	if (name.length > 100) {
		throw new BadRequestError('Name too long');
	}
	if (subject.length > 150) {
		throw new BadRequestError('Subject too long');
	}
	if (message.length < 10 || message.length > 5000) {
		throw new BadRequestError('Message must be between 10 and 5000 characters');
	}

	// 3. Persistance. La collection a toutes ses rules à null ; seul $app.save
	//    côté route peut écrire — pas de createRule à respecter.
	const collection = e.app.findCollectionByNameOrId('contact_messages');
	const record = new Record(collection);
	record.set('email', email);
	record.set('name', name);
	record.set('subject', subject);
	record.set('message', message);
	record.set('ip', e.realIP());
	e.app.save(record);

	// 4. Email best-effort à l'éditeur. Try/catch large : un échec SMTP ne doit
	//    ni casser la route, ni perdre la demande — le record est déjà persisté.
	const recipient = $os.getenv('CONTACT_EMAIL') || 'admin@oupla.net';
	const settings = e.app.settings();
	const displaySubject = subject || 'Nouveau message';
	const timestamp = new Date().toISOString();
	const senderLabel = name ? `${name} <${email}>` : email;

	// Les handlers JSVM sont isolés du scope top-level du fichier : tout helper
	// doit vivre dans le handler. Échappement minimal pour le HTML du mail — le
	// message du visiteur est inséré dans une <pre>, on empêche toute balise.
	const escapeHtml = (s) => String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

	const html = [
		`<p><strong>De :</strong> ${escapeHtml(senderLabel)}</p>`,
		`<p><strong>Sujet :</strong> ${escapeHtml(displaySubject)}</p>`,
		`<p><strong>Reçu le :</strong> ${timestamp}</p>`,
		`<hr><pre>${escapeHtml(message)}</pre>`
	].join('');

	const text = [
		`De : ${senderLabel}`,
		`Sujet : ${displaySubject}`,
		`Reçu le : ${timestamp}`,
		'',
		message
	].join('\n');

	try {
		const mailMessage = new MailerMessage({
			from: {
				address: settings.meta.senderAddress,
				name: settings.meta.senderName || 'Oupla Planning'
			},
			to: [{ address: recipient }],
			subject: `[Contact] ${displaySubject}`,
			html,
			text,
			headers: { 'Reply-To': email }
		});
		e.app.newMailClient().send(mailMessage);
	} catch (err) {
		e.app.logger().error(
			'[Contact] SMTP send failed',
			'err',
			err?.message || String(err),
			'recordId',
			record.get('id'),
			'subject',
			displaySubject
		);
	}

	return e.json(200, { success: true });
});
