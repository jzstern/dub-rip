interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export interface SingleFlightCache<T> {
	get(key: string, fetch: () => Promise<T>, ttlMs: number): Promise<T>;
	clear(): void;
}

/**
 * Enough for a busy day of distinct tracks. The caches are filled by
 * unauthenticated previews, so without a bound every distinct track anyone
 * ever pasted would stay in memory until the process restarts.
 */
const DEFAULT_MAX_ENTRIES = 5000;

/**
 * TTL cache where concurrent callers for one key share a single in-flight
 * fetch. Nullish results and rejections are never cached, so a failed lookup
 * is retried on the very next request. Past `maxEntries`, the entry stored
 * longest ago is dropped first.
 */
export function createSingleFlightCache<T>({
	maxEntries = DEFAULT_MAX_ENTRIES,
}: {
	maxEntries?: number;
} = {}): SingleFlightCache<T> {
	const entries = new Map<string, CacheEntry<NonNullable<T>>>();
	const inFlight = new Map<string, Promise<T>>();

	function store(key: string, value: NonNullable<T>, ttlMs: number): void {
		/** Deleted first so a refreshed key moves to the back of the eviction order. */
		entries.delete(key);
		entries.set(key, { value, expiresAt: Date.now() + ttlMs });
		for (const oldest of entries.keys()) {
			if (entries.size <= maxEntries) break;
			entries.delete(oldest);
		}
	}

	return {
		get(key, fetch, ttlMs) {
			const cached = entries.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				return Promise.resolve(cached.value);
			}
			if (cached) entries.delete(key);

			const existing = inFlight.get(key);
			if (existing) return existing;

			const promise = fetch()
				.then((value) => {
					if (value != null) store(key, value, ttlMs);
					return value;
				})
				.finally(() => {
					inFlight.delete(key);
				});

			inFlight.set(key, promise);
			return promise;
		},
		clear() {
			entries.clear();
			inFlight.clear();
		},
	};
}
