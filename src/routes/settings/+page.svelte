<script lang="ts">
import { Lock, LogOut, Mail, ShieldCheck, Trash2, User } from "@lucide/svelte";
import { toast } from "svelte-sonner";
import { goto } from "$app/navigation";
import Modal from "$lib/components/ui/Modal.svelte";
import * as m from "$lib/paraglide/messages.js";
import { getLocale } from "$lib/paraglide/runtime";
import { pb } from "$lib/pocketbase/pb";
import { userStore } from "$lib/stores/userStore.svelte";

// Vérifier que l'utilisateur est connecté
if (!userStore.isLoggedIn) {
	goto("/");
}

// Locale actuelle pour le radio group
let currentLocale = $state<"fr" | "en">(getLocale());

// État du formulaire profil
let name = $state(userStore.pbUser?.name || "");
let email = $state(userStore.pbUser?.email || "");

// État du formulaire mot de passe
let currentPassword = $state("");
let newPassword = $state("");
let confirmPassword = $state("");

// État UI
let isSaving = $state(false);
let showPasswordModal = $state(false);

// État suppression de compte
let showDeleteModal = $state(false);
let deletePassword = $state("");
let isDeleting = $state(false);

async function handleProfileUpdate() {
	if (!name.trim()) {
		toast.error(m.settings_name_required());
		return;
	}

	isSaving = true;
	try {
		await pb.collection("users").update(pb.authStore.record!.id, {
			name: name.trim(),
			email: email.trim() || undefined
		});

		await pb.collection("users").authRefresh();

		toast.success(m.settings_profile_updated());
	} catch (error) {
		console.error("Error updating profile:", error);
		toast.error(m.settings_profile_update_error());
	} finally {
		isSaving = false;
	}
}

async function handlePasswordChange() {
	if (!currentPassword || !newPassword || !confirmPassword) {
		toast.error(m.settings_all_fields_required());
		return;
	}

	if (newPassword !== confirmPassword) {
		toast.error(m.settings_passwords_mismatch());
		return;
	}

	if (newPassword.length < 8) {
		toast.error(m.settings_password_min_length());
		return;
	}

	isSaving = true;
	try {
		try {
			await pb.collection("users").authWithPassword(pb.authStore.record!.email, currentPassword);
		} catch {
			toast.error(m.settings_incorrect_password());
			isSaving = false;
			return;
		}

		await pb.collection("users").update(pb.authStore.record!.id, {
			password: newPassword,
			passwordConfirm: confirmPassword
		});

		toast.success(m.settings_password_updated());

		currentPassword = "";
		newPassword = "";
		confirmPassword = "";
		showPasswordModal = false;
	} catch (error) {
		console.error("Error changing password:", error);
		toast.error(m.settings_password_change_error());
	} finally {
		isSaving = false;
	}
}

async function handleLogout() {
	await userStore.logout();
}

/**
 * Suppression définitive du compte. Le mot de passe est vérifié côté client
 * (pattern handlePasswordChange) AVANT l'endpoint : un 400 ne peut venir que
 * de cette étape, donc il est attribué sans ambiguïté à "mot de passe erroné".
 * En cas de succès, deleteAccount() nettoie l'état local et redirige vers "/".
 */
async function handleDeleteAccount() {
	if (!deletePassword) return;

	isDeleting = true;
	try {
		await pb.collection("users").authWithPassword(pb.authStore.record!.email, deletePassword);
	} catch {
		toast.error(m.settings_incorrect_password());
		isDeleting = false;
		return;
	}

	try {
		await userStore.deleteAccount();
	} catch (error) {
		console.error("Error deleting account:", error);
		toast.error(m.settings_delete_error());
		isDeleting = false;
	}
}
</script>

<svelte:head>
  <title>{m.settings_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{m.settings_page_heading()}</h1>
    <p class="text-base-content/70 mt-2">{m.settings_page_description()}</p>
  </div>

  <!-- Section Langue -->
  <div class="card card-compact bg-base-200 shadow-xl mb-6">
    <div class="card-body">
      <h3 class="card-title text-base">{m.settings_language_title()}</h3>
      <p class="mb-2 text-sm opacity-70">
        {m.settings_language_description()}
      </p>

      <div class="flex gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="locale"
            class="radio radio-sm"
            checked={currentLocale === "fr"}
            onchange={() => userStore.setAppLocale("fr")}
          />
          <span>{m.settings_language_french()}</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="locale"
            class="radio radio-sm"
            checked={currentLocale === "en"}
            onchange={() => userStore.setAppLocale("en")}
          />
          <span>{m.settings_language_english()}</span>
        </label>
      </div>
    </div>
  </div>

  <!-- Section Profil -->
  <div class="card card-compact bg-base-200 shadow-xl mb-6">
    <div class="card-body">
      <h2 class="card-title mb-4">{m.settings_profile_title()}</h2>
      <p class="mb-6 text-sm opacity-70">
        {m.settings_profile_description()}
      </p>

      <form onsubmit={(e) => e.preventDefault()} class="space-y-4">
        <fieldset class="fieldset">
          <label class="input w-full">
            <span class="label">
              <User size={16} />
              {m.settings_display_name_label()}
            </span>
              <input
                type="text"
                class="grow"
                bind:value={name}
                placeholder={m.settings_display_name_placeholder()}
                disabled={isSaving}
              />
          </label>

          <p class="label ms-auto text-xs">
            {m.settings_display_name_hint()}
          </p>
        </fieldset>

        <fieldset class="fieldset">
          <label class="input w-full">
            <span class="label">
              <Mail size={16} />
              {m.settings_email_label()}
            </span>
              <input
                type="email"
                class="grow"
                bind:value={email}
                placeholder={m.settings_email_placeholder()}
                disabled={isSaving}
              />
          </label>
        </fieldset>

        <div class="card-actions mt-6 justify-end">
          <button
            class="btn btn-primary"
            onclick={handleProfileUpdate}
            disabled={isSaving || !name.trim()}
          >
            {#if isSaving}
              <span class="loading loading-spinner loading-xs"></span>
              {m.settings_saving_button()}
            {:else}
              {m.settings_save_button()}
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- Section Sécurité -->
  <div class="card card-compact bg-base-200 shadow-xl mb-6">
    <div class="card-body">
      <h2 class="card-title mb-4">{m.settings_security_title()}</h2>
      <p class="mb-6 text-sm opacity-70">
        {m.settings_security_description()}
      </p>

      <div class="space-y-6">
        <!-- Changement de mot de passe -->
        <div
          class="border-base-content/10 flex items-center justify-between border-b pb-6"
        >
          <div>
            <h3 class="flex items-center gap-2 font-medium">
              <Lock size={16} />
              {m.settings_password_section_title()}
            </h3>
            <p class="text-sm opacity-70">
              {m.settings_password_section_description()}
            </p>
          </div>
          <button
            class="btn btn-ghost btn-sm"
            onclick={() => (showPasswordModal = true)}
          >
            {m.settings_edit_button()}
          </button>
        </div>

        <!-- Déconnexion -->
        <div class="flex items-center justify-between">
          <div>
            <h3 class="flex items-center gap-2 font-medium">
              <LogOut size={16} />
              {m.settings_session_title()}
            </h3>
            <p class="text-sm opacity-70">
              {m.settings_session_description()}
            </p>
          </div>
          <button
            class="btn btn-error btn-ghost btn-sm"
            onclick={handleLogout}
          >
            {m.settings_logout_button()}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Zone de danger -->
  <div class="card card-compact bg-base-200 shadow-xl border-error/30">
    <div class="card-body">
      <h2 class="card-title mb-4 text-error">
        <ShieldCheck size={18} />
        {m.settings_danger_zone_title()}
      </h2>
      <p class="mb-6 text-sm opacity-70">
        {m.settings_danger_zone_description()}
      </p>

      <div
        class="border-base-content/10 flex items-center justify-between border-t pt-6"
      >
        <div>
          <h3 class="flex items-center gap-2 font-medium">
            <Trash2 size={16} />
            {m.settings_delete_account_title()}
          </h3>
          <p class="text-sm opacity-70">
            {m.settings_delete_account_description()}
          </p>
        </div>
        <button
          class="btn btn-error btn-sm"
          onclick={() => (showDeleteModal = true)}
        >
          {m.settings_delete_account_button()}
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Modal changement de mot de passe -->
<Modal
  bind:open={showPasswordModal}
  onClose={() => (showPasswordModal = false)}
  title={m.settings_password_modal_title()}
  size="sm"
>
  <div class="space-y-4">
    <p class="text-sm opacity-70">{m.settings_password_modal_description()}</p>

    <form onsubmit={(e) => e.preventDefault()} class="space-y-4">
      <fieldset class="fieldset">
        <label class="input w-full">
          <span class="label">
            {m.settings_current_password_label()}
          </span>
          <input
            id="current-password"
            type="password"
            class="grow"
            bind:value={currentPassword}
            placeholder="••••••••"
            disabled={isSaving}
          />
        </label>
      </fieldset>

      <fieldset class="fieldset">
        <label class="input w-full">
          <span class="label">
            {m.settings_new_password_label()}
          </span>
          <input
            id="new-password"
            type="password"
            class="grow"
            bind:value={newPassword}
            placeholder={m.settings_new_password_placeholder()}
            disabled={isSaving}
          />
        </label>
      </fieldset>

      <fieldset class="fieldset">
        <label class="input w-full">
          <span class="label">
            {m.settings_confirm_password_label()}
          </span>
          <input
            id="confirm-password"
            type="password"
            class="grow"
            bind:value={confirmPassword}
            placeholder="••••••••"
            disabled={isSaving}
          />
        </label>
      </fieldset>

      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={() => (showPasswordModal = false)}
        >
          {m.settings_cancel_button()}
        </button>
        <button
          class="btn btn-primary"
          onclick={handlePasswordChange}
          disabled={isSaving ||
            !currentPassword ||
            !newPassword ||
            !confirmPassword}
        >
          {#if isSaving}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            {m.settings_change_button()}
          {/if}
        </button>
      </div>
    </form>
  </div>
</Modal>

<!-- Modal suppression de compte (non-fermable : choix explicite requis) -->
<Modal
  bind:open={showDeleteModal}
  onClose={() => (showDeleteModal = false)}
  title={m.settings_delete_modal_title()}
  size="sm"
  closable={false}
>
  <div class="space-y-4">
    <p class="text-sm font-semibold">{m.settings_delete_modal_irreversible()}</p>

    <ul class="text-sm space-y-3">
      <li>
        <p class="font-medium">{m.settings_delete_modal_plannings_kept_title()}</p>
        <p class="opacity-80">{m.settings_delete_modal_plannings_kept_text()}</p>
      </li>
      <li>
        <p class="font-medium">{m.settings_delete_modal_quit_title()}</p>
        <p class="opacity-80">{m.settings_delete_modal_quit_text()}</p>
      </li>
    </ul>

    <p class="text-sm opacity-70">{m.settings_delete_modal_confirm_hint()}</p>

    <form onsubmit={(e) => e.preventDefault()} class="space-y-4">
      <fieldset class="fieldset">
        <label class="input w-full">
          <span class="label">
            {m.settings_current_password_label()}
          </span>
          <input
            id="delete-account-password"
            type="password"
            class="grow"
            bind:value={deletePassword}
            placeholder="••••••••"
            disabled={isDeleting}
          />
        </label>
      </fieldset>

      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={() => (showDeleteModal = false)}
          disabled={isDeleting}
        >
          {m.settings_cancel_button()}
        </button>
        <button
          class="btn btn-error"
          onclick={handleDeleteAccount}
          disabled={isDeleting || !deletePassword}
        >
          {#if isDeleting}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            {m.settings_delete_confirm_button()}
          {/if}
        </button>
      </div>
    </form>
  </div>
</Modal>
