<script lang="ts">
	/**
	 * Skeleton loader pour la page admin
	 * Reprend la structure du formulaire de configuration
	 */
</script>

<div class="mx-auto max-w-6xl py-2 md:px-4 md:py-8">
	<!-- Bouton retour -->
	<div class="mb-4 flex justify-start">
		<div class="skeleton rounded-btn h-10 w-40"></div>
	</div>

	<!-- Contenu principal -->
	<div class="mx-auto max-w-4xl">
		<!-- Titre -->
		<div class="mb-8 space-y-2 text-center">
			<div class="skeleton mx-auto h-8 w-64"></div>
			<div class="skeleton mx-auto h-4 w-80"></div>
		</div>

		<!-- Formulaire skeleton -->
		<div class="space-y-6">
			<!-- Section: Informations générales -->
			<div class="card border-base-content/5 bg-base-200 border shadow-sm">
				<div class="card-body">
					<div class="skeleton mb-4 h-6 w-48"></div>

					<!-- Titre du planning -->
					<div class="form-control mb-4">
						<div class="skeleton mb-2 h-4 w-32"></div>
						<div class="skeleton h-12 w-full rounded-lg"></div>
					</div>

					<!-- Lieu -->
					<div class="form-control mb-4">
						<div class="skeleton mb-2 h-4 w-20"></div>
						<div class="skeleton h-12 w-full rounded-lg"></div>
					</div>

					<!-- Description -->
					<div class="form-control">
						<div class="skeleton mb-2 h-4 w-28"></div>
						<div class="skeleton h-24 w-full rounded-lg"></div>
					</div>
				</div>
			</div>

			<!-- Section: Récurrence -->
			<div class="card border-base-content/5 bg-base-200 border shadow-sm">
				<div class="card-body">
					<div class="skeleton mb-4 h-6 w-32"></div>

					<div class="grid gap-4 md:grid-cols-2">
						<div>
							<div class="skeleton mb-2 h-4 w-28"></div>
							<div class="skeleton h-12 w-full rounded-lg"></div>
						</div>
						<div>
							<div class="skeleton mb-2 h-4 w-24"></div>
							<div class="skeleton h-12 w-full rounded-lg"></div>
						</div>
					</div>
				</div>
			</div>

			<!-- Section: Horaires -->
			<div class="card border-base-content/5 bg-base-200 border shadow-sm">
				<div class="card-body">
					<div class="skeleton mb-4 h-6 w-24"></div>

					<div class="grid gap-4 md:grid-cols-2">
						<div>
							<div class="skeleton mb-2 h-4 w-20"></div>
							<div class="skeleton h-12 w-full rounded-lg"></div>
						</div>
						<div>
							<div class="skeleton mb-2 h-4 w-28"></div>
							<div class="skeleton h-12 w-full rounded-lg"></div>
						</div>
					</div>
				</div>
			</div>

			<!-- Boutons d'action -->
			<div class="flex justify-end gap-3">
				<div class="skeleton rounded-btn h-12 w-28"></div>
				<div class="skeleton rounded-btn h-12 w-36"></div>
			</div>
		</div>
	</div>
</div>
