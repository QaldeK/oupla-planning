<script lang="ts">
/**
 * Skeleton loader pour la page planning participant
 * Reprend la structure visuelle de la page en mode chargement
 */
</script>

<div class="mx-auto max-w-6xl md:px-4">
	<!-- En-tête skeleton -->
	<div class="mb-12">
		<div class="mb-8 flex flex-wrap items-start justify-between gap-6">
			<div class="flex flex-1 items-center gap-5">
				<!-- Icône calendar -->
				<div class="skeleton h-[72px] w-[72px] rounded-2xl sm:h-[88px] sm:w-[88px]"></div>
				<div class="flex-1 space-y-3">
					<!-- Titre -->
					<div class="skeleton h-8 w-48 sm:h-10 sm:w-64"></div>
					<!-- Lieu -->
					<div class="skeleton h-5 w-32"></div>
				</div>
			</div>

			<!-- Tabs admin (si applicable) -->
			<div class="skeleton rounded-btn h-10 w-64"></div>
		</div>

		<!-- Card 1: Infos Planning -->
		<div class="card card-sm border-base-content/5 bg-base-200 mb-4 border shadow-sm">
			<div class="card-body">
				<div class="flex flex-wrap items-start gap-4">
					<!-- Récurrence -->
					<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
						<div class="skeleton h-5 w-5 shrink-0 rounded"></div>
						<div class="min-w-0 flex-1 space-y-2">
							<div class="skeleton h-5 w-32"></div>
							<div class="skeleton h-4 w-48"></div>
						</div>
					</div>

					<!-- Description -->
					<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
						<div class="skeleton h-5 w-5 shrink-0 rounded"></div>
						<div class="skeleton h-4 w-full max-w-48"></div>
					</div>

					<!-- Participants -->
					<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
						<div class="skeleton h-5 w-5 shrink-0 rounded"></div>
						<div class="min-w-0 flex-1 space-y-2">
							<div class="skeleton h-5 w-24"></div>
							<div class="flex flex-wrap gap-1.5">
								<div class="skeleton rounded-badge h-6 w-16"></div>
								<div class="skeleton rounded-badge h-6 w-20"></div>
								<div class="skeleton rounded-badge h-6 w-14"></div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Card 2: Votre Expérience -->
		<div class="card card-sm border-base-content/5 bg-base-200 border shadow-sm">
			<div class="card-body">
				<div class="flex flex-wrap items-start gap-4">
					<!-- Identification -->
					<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-center gap-2">
						<div class="min-w-0 flex-1 space-y-2">
							<div class="skeleton h-5 w-28"></div>
							<div class="skeleton rounded-btn h-7 w-24"></div>
						</div>
					</div>

					<!-- Notifications -->
					<div class="flex min-w-[calc(50%-0.5rem)] flex-1 items-start gap-2">
						<div class="skeleton h-5 w-5 shrink-0 rounded"></div>
						<div class="min-w-0 flex-1 space-y-2">
							<div class="skeleton h-5 w-32"></div>
							<div class="skeleton h-4 w-full"></div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Zone de partage (desktop) -->
		<div
			class="border-primary/10 bg-base-300 my-8 hidden h-32 rounded-2xl border-2 p-4 shadow-md sm:block"
		>
			<div class="skeleton h-6 w-48"></div>
		</div>
	</div>

	<!-- Liste des occurrences skeleton -->
	<div class="space-y-4">
		<div class="flex justify-end">
			<div class="skeleton rounded-btn h-10 w-52"></div>
		</div>

		<!-- Header -->
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="skeleton h-8 w-56"></div>
			<div class="skeleton rounded-btn h-10 w-48"></div>
		</div>

		<!-- Occurrence cards skeleton -->
		{#each Array(3) as _, i (i)}
			<div class="card border-base-content/5 bg-base-200 border shadow-sm">
				<div class="card-body">
					<div class="flex items-start gap-4">
						<!-- Date badge -->
						<div class="skeleton h-16 w-16 shrink-0 rounded-xl"></div>

						<!-- Content -->
						<div class="min-w-0 flex-1 space-y-3">
							<div class="flex items-start justify-between gap-2">
								<div class="skeleton h-6 w-32"></div>
								<div class="skeleton rounded-btn h-8 w-24"></div>
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
