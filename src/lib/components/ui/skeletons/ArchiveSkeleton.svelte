<script lang="ts">
	/**
	 * Skeleton loader pour la page archives
	 * Reprend la structure de l'historique des événements passés
	 */
</script>

<div class="bg-base-200 min-h-screen px-4 py-8 sm:px-6 lg:px-8">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<div class="mb-8">
			<!-- Bouton retour -->
			<div class="skeleton rounded-btn mb-4 h-10 w-40"></div>

			<div class="flex flex-col justify-between gap-4 md:flex-row md:items-end">
				<div>
					<div class="mb-2 flex items-center gap-3">
						<!-- Icône -->
						<div class="skeleton h-14 w-14 rounded-xl"></div>
						<!-- Titre -->
						<div class="skeleton h-9 w-48"></div>
					</div>
					<div class="skeleton h-5 w-56"></div>
				</div>

				<!-- Badge participant -->
				<div class="skeleton rounded-badge h-10 w-52"></div>
			</div>
		</div>

		<!-- Alert info -->
		<div class="skeleton mb-8 h-14 w-full rounded-lg"></div>

		<!-- Liste des occurrences passées -->
		<div class="space-y-6">
			{#each Array(3) as _, i (i)}
				<div class="card border-base-content/5 bg-base-100 border shadow-xl">
					<div class="card-body">
						<div class="flex items-start gap-4">
							<!-- Date badge -->
							<div class="skeleton h-16 w-16 shrink-0 rounded-xl"></div>

							<!-- Content -->
							<div class="min-w-0 flex-1 space-y-3">
								<div class="flex items-start justify-between gap-2">
									<div class="skeleton h-6 w-32"></div>
									<div class="skeleton rounded-badge h-8 w-24"></div>
								</div>
								<div class="skeleton h-4 w-48"></div>
								<div class="flex gap-2">
									<div class="skeleton rounded-badge h-6 w-20"></div>
									<div class="skeleton rounded-badge h-6 w-16"></div>
								</div>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
