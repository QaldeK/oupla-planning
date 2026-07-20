<script lang="ts">
	import { page } from '$app/state';
	import { recoverAllData } from '$lib/utils/recover';
	import { AlertTriangle, RefreshCw, Trash2 } from '@lucide/svelte';

	let isRecovering = $state(false);

	const isInternalServerError = $derived(page.status >= 500);
	const isNotFound = $derived(page.status === 404);

	async function handleRecover() {
		if (isRecovering) return;
		isRecovering = true;
		try {
			await recoverAllData();
		} catch (err) {
			console.error('[error] recoverAllData failed:', err);
			isRecovering = false;
		}
	}

	function reloadPage() {
		window.location.reload();
	}
</script>

<svelte:head>
	<title>{isNotFound ? 'Page introuvable' : 'Erreur'} · Oupla Planning</title>
</svelte:head>

<div class="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-6 text-center">
	<div
		class="flex size-20 items-center justify-center rounded-full {isInternalServerError
			? 'bg-error/10'
			: 'bg-warning/10'}"
	>
		<AlertTriangle class="size-10 {isInternalServerError ? 'text-error' : 'text-warning'}" />
	</div>

	<div class="max-w-md space-y-2">
		<h1 class="text-3xl font-bold">
			{isNotFound ? 'Page introuvable' : isInternalServerError ? 'Une erreur est survenue' : 'Oups'}
		</h1>
		<p class="text-base-content/70">
			{#if isNotFound}
				La page que vous cherchez n'existe pas ou a été déplacée.
			{:else if isInternalServerError}
				L'application n'a pas pu se charger correctement. Cela peut venir d'une mise à jour récente
				ou de données locales incompatibles.
			{:else}
				{page.error?.message ?? 'Une erreur inattendue est survenue.'}
			{/if}
		</p>
		{#if isInternalServerError && import.meta.env.DEV && page.error?.message}
			<details class="text-left">
				<summary class="text-base-content/50 cursor-pointer text-sm">Détails techniques</summary>
				<pre class="bg-base-300 mt-2 overflow-x-auto rounded p-3 text-xs">{page.error.message}</pre>
			</details>
		{/if}
	</div>

	<div class="flex flex-wrap items-center justify-center gap-3">
		<a href="/" class="btn btn-primary">
			<RefreshCw size={18} />
			Accueil
		</a>
		{#if isInternalServerError}
			<button class="btn btn-outline btn-error" onclick={handleRecover} disabled={isRecovering}>
				<Trash2 size={18} />
				{isRecovering ? 'Nettoyage…' : 'Effacer les données locales'}
			</button>
		{/if}
		<button class="btn btn-ghost" onclick={reloadPage}>
			<RefreshCw size={16} />
			Réessayer
		</button>
	</div>

	{#if isInternalServerError}
		<p class="text-base-content/50 max-w-sm text-xs">
			« Effacer les données locales » supprime le cache hors-ligne, les identités guest et les
			préférences. Vos plannings côté serveur ne sont pas affectés.
		</p>
	{/if}
</div>
