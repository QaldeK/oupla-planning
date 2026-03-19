# Cache Implementation Analysis

## ⚠️ CRITICAL ISSUE IDENTIFIED

**The cache is non-functional because it fetches BEFORE checking the cache.**

---

## Current Implementation Flow

### `getOrFetchMaster()` method:

```typescript
async getOrFetchMaster(token: string): Promise<PlanningMaster | null> {
    const result = await getPlanningByToken(token);  // ← PB FETCH HAPPENS HERE
    if (!result) return null;

    const masterId = result.master.id;

    // 1. Vérifier le cache
    if (this.#masterCache.has(masterId)) {          // ← TOO LATE! Already fetched
        return this.#masterCache.get(masterId)!;
    }

    // 2. Mettre en cache le master déjà fetché
    this.#masterCache.set(masterId, result.master);

    return result.master;
}
```

### Problem:

1. **Fetch happens first** - `getPlanningByToken(token)` is ALWAYS called
2. **Cache checked after** - By the time we check the cache, we've already fetched
3. **Cache is never used** - The cached master is returned, but only AFTER an unnecessary fetch

### Performance Impact:

- **Current behavior**: 1 PB query per call (same as without cache)
- **Expected behavior**: 0 PB queries for cache hits
- **Result**: Cache provides ZERO performance benefit

---

## What Was Implemented

### Files Modified:

1. **`src/lib/stores/planningStore.svelte.ts`**:
   - Added `#masterCache` Map (token → master mapping not implemented)
   - Added `getOrFetchMaster()` method (buggy)
   - Added `invalidateMaster()` and `invalidateAll()` methods
   - Modified `init()` to use `getOrFetchMaster()` instead of `getPlanningByToken()`

2. **`src/lib/stores/userStore.svelte.ts`**:
   - Cache warming in `syncPlanningsFromPocketBase()`
   - Cache clearing in `logout()` and `clearAllLocalData()`

3. **`src/lib/services/realtime.svelte.ts`**:
   - Cache invalidation in 4 handlers (master/occurrence changes)

---

## Root Cause Analysis

### Why the cache doesn't work:

**We need `masterId` to check cache, but we only get `masterId` after fetching.**

The current architecture:

- Input: `token` (participantToken or adminToken)
- Cache key: `masterId`
- Problem: Can't get `masterId` without calling `getPlanningByToken()`

### Possible Solutions:

#### Option 1: Two-level cache (token → masterId, then masterId → master)

```typescript
#tokenToMasterId = new Map<string, string>();  // token → masterId
#masterCache = new Map<string, PlanningMaster>(); // masterId → master

async getOrFetchMaster(token: string): Promise<PlanningMaster | null> {
    // Check if we know this token
    if (!this.#tokenToMasterId.has(token)) {
        // First time with this token - must fetch
        const result = await getPlanningByToken(token);
        if (!result) return null;

        this.#tokenToMasterId.set(token, result.master.id);
        this.#masterCache.set(result.master.id, result.master);
        return result.master;
    }

    const masterId = this.#tokenToMasterId.get(token)!;

    // Check cache
    if (this.#masterCache.has(masterId)) {
        return this.#masterCache.get(masterId)!;  // ← NO FETCH!
    }

    // Cache miss - fetch
    const result = await getPlanningByToken(token);
    if (!result) return null;

    this.#masterCache.set(masterId, result.master);
    return result.master;
}
```

#### Option 2: Cache by token instead of masterId

```typescript
#tokenCache = new Map<string, PlanningMaster>();  // token → master

async getOrFetchMaster(token: string): Promise<PlanningMaster | null> {
    // Check cache first
    if (this.#tokenCache.has(token)) {
        return this.#tokenCache.get(token)!;  // ← NO FETCH!
    }

    // Cache miss - fetch
    const result = await getPlanningByToken(token);
    if (!result) return null;

    this.#tokenCache.set(token, result.master);
    return result.master;
}
```

**Option 2 is simpler** but has a downside: if the same master is accessed with different tokens (adminToken vs participantToken), we'll cache it twice.

---

## What Needs Review

An agent should verify:

1. **Consistency**: Does the cache invalidation logic match the cache storage?
   - When we invalidate by `masterId`, does that align with how we store?
   - Do we invalidate all token entries for a given master?

2. **Race conditions**: Are there any issues with concurrent access?
   - User navigates quickly between pages
   - Realtime updates while fetching

3. **Memory leaks**: Does the cache grow indefinitely?
   - No limit on cache size
   - No expiration mechanism
   - Cached masters never evicted

4. **Stale data**: Can we serve outdated data?
   - Cache is invalidated on realtime events
   - But what if user is offline and reconnects?
   - What if realtime misses an update?

---

## Recommendation

**Option 2 (cache by token) is the simplest fix** and matches the current invalidation pattern (we invalidate by master ID, but we can look up which tokens map to that master).

The cache implementation needs to be **redone with proper cache-first checking**.

---

## Next Steps

1. **Review current implementation** with code reviewer agent
2. **Fix the cache logic** to check BEFORE fetching
3. **Add tests** to verify cache actually works
4. **Measure performance** to confirm 50%+ reduction in queries
