interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export interface SingleFlightCache<T> {
	get(key: string, fetch: () => Promise<T>, ttlMs: number): Promise<T>;
	clear(): void;
}

/**
 * TTL cache where concurrent callers for one key share a single in-flight
 * fetch. Nullish results and rejections are never cached, so a failed lookup
 * is retried on the very next request.
 */
export function createSingleFlightCache<T>(): SingleFlightCache<T> {
	const entries = new Map<string, CacheEntry<NonNullable<T>>>();
	const inFlight = new Map<string, Promise<T>>();

	return {
		get(key, fetch, ttlMs) {
			const cached = entries.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				return Promise.resolve(cached.value);
			}

			const existing = inFlight.get(key);
			if (existing) return existing;

			const promise = fetch()
				.then((value) => {
					if (value != null) {
						entries.set(key, { value, expiresAt: Date.now() + ttlMs });
					}
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
