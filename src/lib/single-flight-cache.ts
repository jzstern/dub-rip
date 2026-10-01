interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

interface Flight<T> {
	promise: Promise<T>;
	controller: AbortController;
	/** Callers still interested; a caller without a signal never leaves. */
	waiters: number;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new Error("Aborted");
}

export interface SingleFlightCache<T> {
	/**
	 * `signal` lets one caller walk away without disturbing the others: its own
	 * promise rejects immediately, and the shared fetch is aborted (through the
	 * signal handed to `fetch`) only once every caller has left. A caller that
	 * passes no signal keeps the fetch alive for good.
	 */
	get(
		key: string,
		fetch: (signal: AbortSignal) => Promise<T>,
		ttlMs: number,
		signal?: AbortSignal,
	): Promise<T>;
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
	const inFlight = new Map<string, Flight<T>>();

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
		get(key, fetch, ttlMs, signal) {
			const cached = entries.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				return Promise.resolve(cached.value);
			}
			if (cached) entries.delete(key);

			if (signal?.aborted) return Promise.reject(abortReason(signal));

			let flight = inFlight.get(key);
			if (!flight) {
				const controller = new AbortController();
				const started: Flight<T> = {
					controller,
					waiters: 0,
					promise: fetch(controller.signal)
						.then((value) => {
							if (value != null) store(key, value, ttlMs);
							return value;
						})
						.finally(() => {
							if (inFlight.get(key) === started) inFlight.delete(key);
						}),
				};
				inFlight.set(key, started);
				flight = started;
			}

			if (!signal) {
				flight.waiters += 1;
				return flight.promise;
			}

			const joined = flight;
			joined.waiters += 1;
			return new Promise<T>((resolve, reject) => {
				const onAbort = () => {
					joined.waiters -= 1;
					reject(abortReason(signal));
					if (joined.waiters > 0) return;
					if (inFlight.get(key) === joined) inFlight.delete(key);
					joined.controller.abort(signal.reason);
				};
				signal.addEventListener("abort", onAbort, { once: true });
				joined.promise.then(
					(value) => {
						signal.removeEventListener("abort", onAbort);
						resolve(value);
					},
					(error) => {
						signal.removeEventListener("abort", onAbort);
						reject(error);
					},
				);
			});
		},
		clear() {
			entries.clear();
			inFlight.clear();
		},
	};
}
