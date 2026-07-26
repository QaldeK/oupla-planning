<script lang="ts">
import { RefreshCw, Trash2, WifiOff } from "@lucide/svelte";

interface Props {
	errorType: "network" | "deleted" | "not-found" | null;
	isOffline: boolean;
}

let { errorType, isOffline }: Props = $props();
</script>

{#if errorType === 'network' || isOffline}
	{@const errorMessage = !isOffline
		? 'Le serveur est inaccessible. Réessayez dans quelques instants.'
		: 'Vous êtes hors ligne. Vérifiez votre connexion internet.'}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="max-w-md text-center">
			<div class="alert alert-error alert-soft">
				<WifiOff size={24} />
				<div>
					<h3 class="font-bold">Connexion impossible</h3>
					<div class="text-xs">
						<p>{errorMessage}</p>
					</div>
				</div>
			</div>
			<button class="btn btn-outline mt-4 gap-2" onclick={() => window.location.reload()}>
				<RefreshCw size={16} />
				Réessayer
			</button>
		</div>
	</div>
{:else if errorType === 'deleted'}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="max-w-md text-center">
			<div
				class="bg-warning/10 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full p-4"
			>
				<Trash2 size={40} class="text-warning" />
			</div>
			<h2 class="mb-2 text-2xl font-bold">Planning supprimé</h2>
			<p class="text-base-content/70 mb-6">
				Ce planning a été supprimé par son administrateur. Les données locales ont été nettoyées.
			</p>
			<a href="/" class="btn btn-primary">Retour à l'accueil</a>
		</div>
	</div>
{:else if errorType === 'not-found'}
	<div class="flex min-h-[50vh] items-center justify-center">
		<div class="max-w-md text-center">
			<h2 class="mb-2 text-2xl font-bold">Planning introuvable</h2>
			<p class="text-base-content/70">Le lien que vous avez utilisé n'est pas valide</p>
			<a href="/" class="btn btn-primary mt-4">Retour à l'accueil</a>
		</div>
	</div>
{/if}
