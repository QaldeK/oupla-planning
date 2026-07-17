<script lang="ts">
	import CopyLinksButtons from '$lib/components/CopyLinksButtons.svelte';
	import { Settings, Share2, Users } from '@lucide/svelte';

	interface Props {
		isAdmin: boolean;
		adminToken: string | null;
		participantToken?: string;
		allowResponses: boolean | undefined;
		tasksCount: number;
	}

	let { isAdmin, adminToken, participantToken, allowResponses, tasksCount }: Props = $props();
</script>

{#if !isAdmin}
	<!-- Bandeau de partage léger (action secondaire pour le participant) -->
	<div class="alert alert-info alert-soft flex items-center justify-between gap-4 py-3">
		<div class="flex items-center gap-2">
			<Users size={20} class="shrink-0" />
			<span class="text-base">
				Invitez d'autres participants à
				{#if allowResponses}déclarer leur présence,{/if}
				{#if tasksCount > 0}s'inscrire aux tâches,{/if}
				et ajouter des commentaires, en leur partageance le lien du planning.
			</span>
		</div>
		<CopyLinksButtons {participantToken} />
	</div>
{:else}
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
					<CopyLinksButtons {participantToken} />
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
					<CopyLinksButtons adminToken={adminToken ?? undefined} />
				</div>
			</div>
		</div>
	</div>
{/if}
