<script lang="ts">
	import { Bell, MonitorSmartphone } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import * as m from "$lib/paraglide/messages.js";
	import { db } from "$lib/pb-sync/db";
	import { authTransition } from "$lib/stores/authTransition.svelte";
	import { isPortageCandidate } from "$lib/services/claimPlannings";
	import { getPlanningTitleByToken } from "$lib/services/planningReads";
	import AuthPanel from "./AuthPanel.svelte";

	// Titre du planning derrière un lien capturé (participant ou admin) :
	// undefined tant que non résolu ou sans lien dans l'URL — le bloc de
	// contexte ne s'affiche que lorsqu'un titre a été trouvé.
	let planningTitle = $state<string | undefined>(undefined);

	let mode = $state<"register" | "login">("register");

	// Portage des plannings locaux : candidats = masters non supprimés en
	// Dexie. Lecture unique au montage — derrière le mur, aucune surface
	// n'écrit (stockage isolé type iOS → 0 candidat, bascule absente).
	let attachableCount = $state(0);
	let attachPlannings = $state(true);

	onMount(() => {
		void (async () => {
			const masters = await db.masters.toArray();
			attachableCount = masters.filter(isPortageCandidate).length;
		})();
	});

	// Même définition de candidat que la transition (isPortageCandidate) :
	// la bascule ne doit pas s'afficher pour ce que le claim batch ignorerait.
	const showAttachToggle = $derived(mode === "register" && attachableCount > 0);

	// Consentement réactif, consommé une fois par la transition (voir
	// authTransition.wallPortageConsent). Posé AVANT submit : onChange tire
	// pendant authWithPassword, dans la même tâche que cet état.
	$effect(() => {
		authTransition.wallPortageConsent = showAttachToggle && attachPlannings;
	});

	$effect(() => {
		const token = page.params.token as string | undefined;
		planningTitle = undefined;
		if (!token) return;
		let alive = true;
		void getPlanningTitleByToken(token).then((title) => {
			if (alive && title) planningTitle = title;
		});
		return () => {
			alive = false;
		};
	});
</script>

<!-- Mur d'authentification : app installée (standalone) sans session. Remplace
     toute surface de l'app, sans contournement — la conversion (connexion ou
     création) est l'unique issue ; le login déclenche la transition auth
     existante (claim du planning + fusion d'identité), complétée au mode
     création par le portage des plannings locaux (claim batch + clear
     sélectif). -->
<main
	class="bg-base-200 flex min-h-dvh flex-col items-center justify-center gap-6 overflow-y-auto p-4"
>
	<div class="flex items-center gap-2">
		<img src="/favicon.svg" alt="Oupla planning" class="size-10" />
		<h1 class="text-2xl font-bold">Oupla Planning</h1>
	</div>

	<div class="card bg-base-100 w-full max-w-md shadow-xl">
		<div class="card-body gap-4">
			<h2 class="card-title justify-center">{m.auth_wall_title()}</h2>
			<p class="text-center text-sm opacity-80">{m.auth_wall_intro()}</p>

			<ul class="space-y-2 text-sm">
				<li class="flex items-center gap-2">
					<Bell size={16} class="text-info shrink-0" />
					{m.auth_wall_benefit_alerts()}
				</li>
				<li class="flex items-center gap-2">
					<MonitorSmartphone size={16} class="text-info shrink-0" />
					{m.auth_wall_benefit_devices()}
				</li>
			</ul>

			{#if planningTitle !== undefined}
				<div class="alert alert-info alert-soft text-sm">
					{m.auth_wall_context_title({ title: planningTitle })}
				</div>
			{/if}

			<AuthPanel bind:mode>
				{#snippet children()}
					{#if showAttachToggle}
						<label class="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="checkbox"
								name="attachPlannings"
								class="checkbox checkbox-sm mt-0.5"
								bind:checked={attachPlannings}
							/>
							<span>
								{m.auth_wall_attach_label()}
								<span class="block text-xs opacity-70">{m.auth_wall_attach_hint()}</span>
							</span>
						</label>
					{/if}
				{/snippet}
			</AuthPanel>
		</div>
	</div>
</main>
