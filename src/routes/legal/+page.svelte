<script lang="ts">
import * as m from "$lib/paraglide/messages.js";
</script>

<svelte:head>
  <title>{m.legal_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
  <h1 class="mb-2 text-3xl font-bold">{m.legal_page_heading()}</h1>
  <p class="text-base-content/70 mb-8 text-sm">
    {m.legal_version()} 1.0 — {m.legal_last_updated()} 4 août 2026
  </p>

  <div class="space-y-8">
    <!-- 1. Mentions légales -->
    <section id="mentions" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">1. Mentions légales</h2>
        <ul class="list-inside list-disc space-y-2 text-sm opacity-80">
          <li>
            <strong>Contact</strong> : formulaire de contact
          </li>
          <li>
            <strong>Hébergement</strong> : site statique servi par Cloudflare,
            Inc. (101 Townsend St, San Francisco, CA 94107, États-Unis) ;
            données applicatives hébergées chez Contabo GmbH (Aschauer Str.
            32a, 81549 München, Allemagne)
          </li>
          <li>
            <strong>Code source</strong> : disponible sur
            <a
              href="https://github.com/QaldeK/oupla-planning/"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-primary"
              >github.com/QaldeK/oupla-planning</a
            >
            (open source)
          </li>
        </ul>
      </div>
    </section>

    <!-- 2. Objet du service -->
    <section id="objet" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">2. Objet du service</h2>
        <p class="text-sm opacity-80">
          Oupla Planning est un service <strong>gratuit</strong> qui permet de
          créer des plannings d'activités récurrentes, de partager un lien
          d'invitation, de recueillir les réponses de disponibilité des
          participants, de gérer des tâches et d'envoyer des notifications.
        </p>
      </div>
    </section>

    <!-- 3. Accès et comptes -->
    <section id="cgu" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">3. Accès et comptes</h2>
        <ul class="list-inside list-disc space-y-2 text-sm opacity-80">
          <li>
            Le service peut être utilisé <strong>sans compte</strong> (invité,
            via le lien partagé) ou <strong>avec un compte</strong> (email, mot
            de passe, pseudo).
          </li>
          <li>
            Le service est accessible à tous, y compris aux mineurs. Pour les
            utilisateurs de <strong>moins de 15 ans</strong>, l'accord d'un
            parent ou d'un tuteur est requis pour créer un compte.
          </li>
        </ul>
      </div>
    </section>

    <!-- 4. Données personnelles, finalités et durées de conservation -->
    <section id="confidentialite" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">
          4. Données personnelles, finalités et durées de conservation
        </h2>
        <div class="overflow-x-auto">
          <table class="table table-sm text-sm">
            <thead>
              <tr>
                <th>Donnée</th>
                <th>Finalité</th>
                <th>Base légale</th>
                <th>Durée de conservation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Compte</strong> (email, mot de passe stocké de façon
                  chiffrée, pseudo)
                </td>
                <td>
                  Fournir le service (compte, plannings, réponses,
                  notifications email)
                </td>
                <td>Exécution du contrat d'utilisation</td>
                <td>
                  Tant que le compte existe ; supprimé à la demande de
                  l'utilisateur
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Contenu des plannings</strong> (titres, participants,
                  réponses, commentaires, tâches — saisi par les utilisateurs)
                </td>
                <td>Fournir le service</td>
                <td>Exécution du contrat d'utilisation</td>
                <td>
                  Tant que le planning existe ; supprimé par son administrateur
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Notifications</strong> (abonnement push du
                  navigateur, préférences)
                </td>
                <td>Envoyer des notifications push</td>
                <td>Consentement (permission du navigateur)</td>
                <td>
                  Abonnement : jusqu'à désinscription ; enregistrements de
                  notification : 60 jours
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Données techniques</strong> (journaux serveur, sans
                  adresse IP)
                </td>
                <td>Assurer la sécurité et prévenir les abus</td>
                <td>Intérêt légitime</td>
                <td>5 jours</td>
              </tr>
              <tr>
                <td>
                  <strong>Cookie technique de langue</strong>
                  (<code>PARAGLIDE_LOCALE</code>)
                </td>
                <td>Mémoriser la langue du site</td>
                <td>Intérêt légitime (cookie technique)</td>
                <td>400 jours</td>
              </tr>
              <tr>
                <td>
                  <strong>Données locales</strong> (localStorage / IndexedDB)
                </td>
                <td>Fonctionnement hors ligne</td>
                <td>Exécution du contrat d'utilisation</td>
                <td>Jusqu'à leur suppression par le navigateur</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-4 text-sm font-medium opacity-80">
          Nous ne pratiquons aucun suivi publicitaire, aucune revente de
          données, aucune analyse de comportement individuel.
        </p>
      </div>
    </section>

    <!-- 5. Destinataires et sous-traitants -->
    <section id="destinataires" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">5. Destinataires et sous-traitants</h2>
        <p class="mb-2 text-sm opacity-80">
          Les données sont traitées par l'éditeur et par les sous-traitants
          suivants, strictement pour la fourniture du service :
        </p>
        <ul class="list-inside list-disc space-y-2 text-sm opacity-80">
          <li>
            <strong>Contabo GmbH</strong> — hébergement du serveur (Allemagne,
            Union européenne)
          </li>
          <li>
            <strong>Cloudflare, Inc.</strong> — CDN, protection et distribution
            du site (société certifiée <em>Data Privacy Framework</em>
            UE-États-Unis)
          </li>
          <li>
            <strong>Stalwart Mail Server</strong> — envoi des emails de
            notification (serveur auto-hébergé sur la même infrastructure)
          </li>
          <li>
            <strong>Services push des navigateurs</strong> (Google, Apple,
            Mozilla…) — acheminement des notifications push
          </li>
        </ul>
        <p class="mt-4 text-sm font-medium opacity-80">
          Aucune autre divulgation : vos données ne sont ni vendues, ni louées,
          ni partagées à des fins publicitaires.
        </p>
      </div>
    </section>

    <!-- 6. Transferts hors Union européenne -->
    <section id="transferts" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">6. Transferts hors Union européenne</h2>
        <p class="text-sm opacity-80">
          Vos données sont hébergées dans l'Union européenne (Allemagne).
          Cloudflare peut traiter des données aux États-Unis dans le cadre de sa
          certification <em>Data Privacy Framework</em>. Les notifications push
          transitent par les services du navigateur que vous utilisez.
        </p>
      </div>
    </section>

    <!-- 7. Sécurité -->
    <section id="securite" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">7. Sécurité</h2>
        <p class="text-sm opacity-80">
          Le service utilise le chiffrement HTTPS, des mots de passe hachés, et
          des accès par liens uniques. Les données collectées sont limitées au
          strict nécessaire au fonctionnement.
        </p>
      </div>
    </section>

    <!-- 8. Vos droits (RGPD) -->
    <section id="droits" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">8. Vos droits (RGPD)</h2>
        <p class="text-sm opacity-80">
          Conformément au Règlement général sur la protection des données, vous
          disposez des droits d'<strong>accès, de rectification,
          d'effacement, de limitation, de portabilité, d'opposition</strong> et
          de <strong>retrait du consentement</strong> à tout moment.
        </p>
        <p class="text-sm opacity-80">
          Pour les exercer, utilisez le formulaire de contact. Nous répondons
          sous un mois. Vous pouvez également saisir la
          <strong>CNIL</strong> (cnil.fr) si vous estimez que vos droits ne sont
          pas respectés.
        </p>
      </div>
    </section>

    <!-- 9. Règles d'utilisation -->
    <section id="regles" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">9. Règles d'utilisation</h2>
        <p class="text-sm opacity-80">En utilisant le service, vous vous engagez à :</p>
        <ul class="list-inside list-disc space-y-2 text-sm opacity-80">
          <li>l'utiliser de façon licite et conforme à sa destination ;</li>
          <li>
            ne pas tenter d'accéder aux plannings ou données d'autrui sans
            autorisation ;
          </li>
          <li>
            ne pas publier de contenu illicite (diffamatoire, haineux, portant
            atteinte aux droits de tiers…) ;
          </li>
          <li>ne pas perturber le fonctionnement du service.</li>
        </ul>
      </div>
    </section>

    <!-- 10. Responsabilité -->
    <section id="responsabilite" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">10. Responsabilité</h2>
        <p class="text-sm opacity-80">
          Le service est fourni gratuitement, <strong>« en l'état »</strong> :
          sa disponibilité n'est pas garantie et peut être interrompue sans
          préavis. L'éditeur n'est pas responsable du contenu publié par les
          utilisateurs ni des dommages indirects liés à l'utilisation du
          service.
        </p>
      </div>
    </section>

    <!-- 11. Soutien volontaire -->
    <section id="soutien" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">11. Soutien volontaire</h2>
        <p class="text-sm opacity-80">
          Le service est gratuit. Tout soutien volontaire (par exemple « pay me
          a coffee ») est sans contrepartie et n'ouvre aucun droit particulier.
        </p>
      </div>
    </section>

    <!-- 12. Modifications -->
    <section id="modifications" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">12. Modifications</h2>
        <p class="text-sm opacity-80">
          Les présentes conditions peuvent être modifiées. En cas de changement
          important, vous en serez informé sur le site. Poursuivre l'utilisation
          du service après modification vaut acceptation des nouvelles
          conditions.
        </p>
      </div>
    </section>

    <!-- 13. Droit applicable -->
    <section id="droit" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">13. Droit applicable</h2>
        <p class="text-sm opacity-80">
          Les présentes conditions sont soumises au <strong>droit français</strong>. En
          cas de litige, les tribunaux français seront compétents.
        </p>
      </div>
    </section>

    <!-- 14. Contact -->
    <section id="contact" class="card card-compact bg-base-200 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">14. Contact</h2>
        <p class="text-sm opacity-80">
          Pour toute question : utilisez le formulaire de contact.
        </p>
      </div>
    </section>
  </div>
</div>
