import { liveQuery } from 'dexie';
import type { Subscription } from 'dexie';

/**
 * Svelte 5 reactive wrapper around Dexie liveQuery.
 *
 * **Must be called from a component `<script>` block** — uses `$effect`
 * which requires a component effect context. For module-level stores,
 * subscribe to `liveQuery` directly and update `$state` manually.
 *
 * Inspired by `dexie-svelte-query` by dfahlander.
 *
 * @param querier - Function that queries Dexie, re-evaluated on table changes
 * @param deps - Optional reactive dependencies. When any value in the returned
 *               array changes (tracked via $state), the liveQuery is
 *               re-subscribed. Without deps, the querier only re-runs when
 *               the underlying Dexie table changes.
 */
export function useLiveQuery<T>(querier: () => T | Promise<T>, deps?: () => unknown[]) {
	const query = $state<{
		current?: T;
		isLoading: boolean;
		error?: any;
	}>({
		current: undefined,
		isLoading: true,
		error: undefined
	});

	$effect(() => {
		if (deps) deps();

		const subscription: Subscription = liveQuery(querier).subscribe({
			next: (value) => {
				query.error = undefined;
				if (value !== undefined) {
					query.current = value;
					query.isLoading = false;
				} else {
					query.isLoading = true;
				}
			},
			error: (err) => {
				query.error = err;
				query.isLoading = false;
			}
		});

		return () => subscription.unsubscribe();
	});

	return query;
}
