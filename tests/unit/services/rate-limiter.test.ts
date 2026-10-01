import { describe, expect, it } from "vitest";
import {
	buildRateLimitResponse,
	createRateLimiter,
	isRateLimitedPath,
} from "$lib/rate-limiter";

function clock(start = 1_000_000) {
	let current = start;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
}

describe("createRateLimiter()", () => {
	it("allows a burst up to capacity then rejects", () => {
		// #given
		const time = clock();
		const limiter = createRateLimiter({ burst: 3, now: time.now });

		// #when
		const results = [1, 2, 3, 4].map(() => limiter.consume("1.1.1.1"));

		// #then
		expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
	});

	it("reports how long until the next token as whole seconds", () => {
		// #given
		const time = clock();
		const limiter = createRateLimiter({
			burst: 1,
			refillPerMinute: 30,
			now: time.now,
		});
		limiter.consume("ip");

		// #when
		const decision = limiter.consume("ip");

		// #then
		expect(decision).toEqual({ allowed: false, retryAfterSeconds: 2 });
	});

	it("refills lazily as time passes", () => {
		// #given
		const time = clock();
		const limiter = createRateLimiter({
			burst: 1,
			refillPerMinute: 60,
			now: time.now,
		});
		limiter.consume("ip");
		expect(limiter.consume("ip").allowed).toBe(false);

		// #when
		time.advance(1_000);

		// #then
		expect(limiter.consume("ip").allowed).toBe(true);
	});

	it("never refills beyond burst capacity", () => {
		// #given
		const time = clock();
		const limiter = createRateLimiter({ burst: 2, now: time.now });
		limiter.consume("ip");

		// #when
		time.advance(60 * 60_000);
		const results = [1, 2, 3].map(() => limiter.consume("ip").allowed);

		// #then
		expect(results).toEqual([true, true, false]);
	});

	it("keeps clients isolated from one another", () => {
		// #given
		const time = clock();
		const limiter = createRateLimiter({ burst: 1, now: time.now });
		limiter.consume("a");

		// #when
		const other = limiter.consume("b");

		// #then
		expect(other.allowed).toBe(true);
	});

	it("bounds the number of tracked clients, dropping the least recently seen", () => {
		// #given
		const time = clock();
		const limiter = createRateLimiter({
			burst: 1,
			maxTrackedClients: 2,
			now: time.now,
		});
		limiter.consume("a");
		limiter.consume("b");

		// #when
		limiter.consume("c");

		// #then
		expect(limiter.size).toBe(2);
		expect(limiter.consume("a").allowed).toBe(true);
	});

	it("keeps an actively limited client while evicting idle ones", () => {
		// #given
		const time = clock();
		const limiter = createRateLimiter({
			burst: 1,
			maxTrackedClients: 2,
			now: time.now,
		});
		limiter.consume("busy");
		limiter.consume("idle");
		limiter.consume("busy");

		// #when
		limiter.consume("newcomer");

		// #then
		expect(limiter.consume("busy").allowed).toBe(false);
	});
});

describe("isRateLimitedPath()", () => {
	it.each([
		"/api/preview",
		"/api/preview/details",
		"/api/download-stream",
	])("limits %s", (path) => {
		expect(isRateLimitedPath(path)).toBe(true);
	});

	it.each([
		"/api/download-file",
		"/api/canary",
		"/api/health",
		"/",
		"/api/previewer",
	])("exempts %s", (path) => {
		expect(isRateLimitedPath(path)).toBe(false);
	});
});

describe("buildRateLimitResponse()", () => {
	it("answers JSON routes with 429, a friendly error and Retry-After", async () => {
		// #when
		const response = buildRateLimitResponse("/api/preview", 7);

		// #then
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("7");
		expect(await response.json()).toEqual({ error: expect.any(String) });
	});

	it("answers the SSE route with an error event the UI can display", async () => {
		// #when
		const response = buildRateLimitResponse("/api/download-stream", 3);
		const body = await response.text();

		// #then
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Retry-After")).toBe("3");
		expect(body).toMatch(/^data: {"type":"error","message":".+"}\n\n$/);
	});
});
