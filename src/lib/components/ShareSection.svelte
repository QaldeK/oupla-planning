<script lang="ts">
	import CopyLinksButtons from '$lib/components/CopyLinksButtons.svelte';
	import { Info, Settings, Share2, Users } from 'lucide-svelte';

	interface Props {
		isAdmin: boolean;
		adminToken: string | null;
		token: string;
		allowResponses: boolean | undefined;
		tasksCount: number;
	}

	let { isAdmin, adminToken, token, allowResponses, tasksCount }: Props = $props();
</script>

<div class="card card-sm bg-base-300 border-primary/10 my-8 border-2 shadow-md">
	<div class="card-body">
		<h3 class="mb-4 flex items-center gap-2 text-base font-semibold">
			<Share2 size={22} class="text-primary" />
			Partager ce planning
		</h3>

		<div class="grid gap-8 md:grid-cols-2">
			<!-- Lien Public -->
			<div class="flex flex-col justify-between gap-4">
				<div class="space-y-2">
					<div class="text-content-primary flex items-center gap-2 font-bold">
						<Users size={18} />
						Lien Public
					</div>
					<p class="text-sm opacity-80">
						Partagez ce lien avec les participants pour qu'ils puissent
						{#if allowResponses}déclarer leur présence,{/if}
						{#if tasksCount > 0}s'inscrire aux tâches,{/if}
						et ajouter des commentaires.
					</p>
				</div>
				<CopyLinksButtons size="md" participantToken={token} />
			</div>

			<!-- Lien Admin -->
			<div
				class="border-base-content/10 flex flex-col justify-between gap-4 border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8"
			>
				<div class="space-y-2">
					<div class="text-content-warning flex items-center gap-2 font-bold">
						<Settings size={18} />
						Lien Administrateur
					</div>
					<p class="text-sm opacity-80">
						Permet la modification du planning et des occurrences, ainsi que la confirmation ou
						l'annulation des événements.
					</p>
				</div>
				{#if isAdmin}
					<CopyLinksButtons size="md" adminToken={adminToken ?? undefined} />
				{:else}
					<div class="alert alert-info alert-soft text-xs">
						<Info size={14} />
						<span>Seuls les administrateurs ont accès à ce lien de gestion.</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
