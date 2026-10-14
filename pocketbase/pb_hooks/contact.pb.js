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
//   4. Email best-effort à l'éditeur (Reply-To = email du visiteur), précédé
//      d'une sonde de joignabilité bornée : send() est synchrone sans timeout,
//      un SMTP qui droppe ferait pendre la requête ~2 min. Sonde qui consomme
//      son timeout → skip (log error), le record est déjà persisté, rien n'est
//      perdu.
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

	// 4. Email best-effort à l'éditeur (Reply-To = email du visiteur), précédé
	//    d'une sonde de joignabilité bornée : send() est un appel Go synchrone
	//    SANS timeout configurable — un SMTP qui droppe silencieusement ferait
	//    pendre la requête ~2 min (pool de runtimes JSVM saturable). Décision
	//    par durée écoulée, pas par message d'erreur (le wording Go varie entre
	//    versions) : un SMTP sain fait échouer la sonde en quelques ms (bannière
	//    SMTP ≠ HTTP) et c'est justement le cas où l'envoi doit avoir lieu —
	//    seules les sondes qui consomment leur timeout déclenchent le skip.
	//    Le record est déjà persisté : rien n'est perdu si le mail est sauté.
	const PROBE_TIMEOUT_S = 3;
	const PROBE_SKIP_TTL_MS = 60000;

	const settings = e.app.settings();
	const smtp = settings.smtp || {};
	const recipient = $os.getenv('CONTACT_EMAIL') || 'admin@oupla.net';
	const displaySubject = subject || 'Nouveau message';

	// Cache négatif : les handlers sont isolés du scope du fichier, mais
	// globalThis persiste sur le runtime réutilisé du pool — pendant une panne,
	// une seule sonde par runtime par fenêtre au lieu d'une par requête.
	let mailSkipped = !smtp.enabled || !smtp.host;
	if (!mailSkipped) {
		const cached = globalThis.__smtpProbeSkip;
		if (cached && cached.skip && Date.now() - cached.at < PROBE_SKIP_TTL_MS) {
			mailSkipped = true;
		} else {
			const t0 = Date.now();
			try {
				$http.send({
					method: 'GET',
					url: 'http://' + smtp.host + ':' + (smtp.port || 587) + '/',
					timeout: PROBE_TIMEOUT_S
				});
			} catch (_err) {
				// toute issue de la sonde est acceptable : seule la durée décide
			}
			mailSkipped = Date.now() - t0 >= PROBE_TIMEOUT_S * 1000;
			if (mailSkipped) {
				globalThis.__smtpProbeSkip = { at: Date.now(), skip: true };
			}
		}
	}

	if (mailSkipped) {
		// Un SMTP volontairement non configuré (dev local) est un état attendu :
		// info. Une sonde qui consomme son timeout en prod est anormale : error.
		const notConfigured = !smtp.enabled || !smtp.host;
		if (notConfigured) {
			e.app.logger().info(
				'[Contact] SMTP not configured, mail skipped',
				'recordId',
				record.get('id'),
				'subject',
				displaySubject
			);
		} else {
			e.app.logger().error(
				'[Contact] SMTP unreachable, mail skipped',
				'recordId',
				record.get('id'),
				'subject',
				displaySubject
			);
		}
		return e.json(200, { success: true });
	}

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
