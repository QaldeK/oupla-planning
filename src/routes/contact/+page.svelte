<script lang="ts">
import { toast } from "svelte-sonner";
import * as m from "$lib/paraglide/messages.js";
import { pb } from "$lib/pocketbase/pb";

// Route publique, aucun _token requis (canal officiel des droits RGPD).
let name = $state("");
let email = $state("");
let subject = $state("");
let message = $state("");
// Honeypot anti-bot : doit rester vide. Tout remplissage → silence serveur.
let website = $state("");
let isSending = $state(false);
// Le toast seul passait inaperçu : la confirmation occupe la place du formulaire.
let showSuccess = $state(false);

function resetForm() {
	name = "";
	email = "";
	subject = "";
	message = "";
	website = "";
}

function startNewMessage() {
	showSuccess = false;
}

async function handleContactSubmit() {
	if (isSending) return;
	isSending = true;
	try {
		await pb.send("/api/contact", {
			method: "POST",
			body: { name, email, subject, message, website }
		});
		resetForm();
		showSuccess = true;
	} catch (error) {
		console.error("Contact form send failed:", error);
		toast.error(m.contact_error());
	} finally {
		isSending = false;
	}
}
</script>

<svelte:head>
  <title>{m.contact_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8">
  <h1 class="mb-2 text-3xl font-bold">{m.contact_page_heading()}</h1>
  <p class="text-base-content/70 mb-8 text-sm">{m.contact_intro()}</p>

  {#if showSuccess}
    <div role="status" aria-live="polite" class="alert alert-success flex flex-col items-stretch gap-4">
      <div class="flex items-center gap-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="size-6 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p class="font-medium">{m.contact_success()}</p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <a href="/" class="btn btn-primary">{m.contact_success_back_home()}</a>
        <button type="button" class="btn btn-ghost" onclick={startNewMessage}>
          {m.contact_success_again()}
        </button>
      </div>
    </div>
  {:else}
  <div class="card card-compact bg-base-200 shadow-xl">
    <div class="card-body">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleContactSubmit();
        }}
        class="space-y-4"
      >
        <!-- Honeypot anti-bot : invisible aux humains. Tout remplissage
             déclenche une réponse 200 silencieuse côté serveur (aucun
             stockage). `aria-hidden` + tabindex -1 pour ne pas polluer
             l'accessibilité ni la navigation clavier. -->
        <div aria-hidden="true" class="hidden">
          <label>
            Website
            <input
              type="text"
              name="website"
              tabindex="-1"
              autocomplete="off"
              bind:value={website}
            />
          </label>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">{m.contact_name_label()}</legend>
          <label class="input w-full">
            <input
              type="text"
              class="grow"
              placeholder={m.contact_name_placeholder()}
              maxlength="100"
              bind:value={name}
            />
          </label>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">{m.contact_email_label()}</legend>
          <label class="validator input w-full">
            <input
              type="email"
              class="grow"
              placeholder={m.contact_email_placeholder()}
              required
              bind:value={email}
            />
          </label>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">{m.contact_subject_label()}</legend>
          <label class="input w-full">
            <input
              type="text"
              class="grow"
              placeholder={m.contact_subject_placeholder()}
              maxlength="150"
              bind:value={subject}
            />
          </label>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">{m.contact_message_label()}</legend>
          <textarea
            class="validator textarea w-full"
            rows="5"
            minlength="10"
            maxlength="5000"
            placeholder={m.contact_message_placeholder()}
            required
            bind:value={message}
          ></textarea>
          <p class="validator-hint">{m.contact_message_placeholder()}</p>
        </fieldset>

        <button type="submit" class="btn btn-block btn-primary" disabled={isSending}>
          {#if isSending}
            <span class="loading loading-spinner loading-sm"></span>
            {m.contact_sending()}
          {:else}
            {m.contact_submit()}
          {/if}
        </button>
      </form>

      <p class="text-xs opacity-60">
        {m.contact_privacy_note_pre()}
        <a href="/legal#confidentialite" class="link link-primary">
          {m.contact_privacy_note_link()}
        </a>
        {m.contact_privacy_note_post()}
      </p>
    </div>
  </div>
  {/if}
</div>
