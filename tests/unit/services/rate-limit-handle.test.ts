import { beforeEach, describe, expect, it, vi } from "vitest";

const { addBreadcrumbMock, captureExceptionMock } = vi.hoisted(() => ({
	addBreadcrumbMock: vi.fn(),
	captureExceptionMock: vi.fn(),
}));
vi.mock("@sentry/sveltekit", () => ({
	addBreadcrumb: addBreadcrumbMock,
	captureException: captureExceptionMock,
}));

import { createRateLimitHandle } from "$lib/rate-limit-handle";
import { createRateLimiter } from "$lib/rate-limiter";

function run(
	handle: ReturnType<typeof createRateLimitHandle>,
	path: string,
	getClientAddress: () => string = () => "9.9.9.9",
) {
	const resolve = vi.fn().mockResolvedValue(new Response("ok"));
	const event = {
		url: new URL(`http://localhost${path}`),
		getClientAddress,
	};
	// biome-ignore lint/suspicious/noExplicitAny: partial RequestEvent stub
	const result = (handle as any)({ event, resolve }) as Promise<Response>;
	return { result: Promise.resolve(result), resolve };
}

describe("createRateLimitHandle()", () => {
	beforeEach(() => {
		addBreadcrumbMock.mockReset();
		captureExceptionMock.mockReset();
	});

	it("passes limited routes through while tokens remain", async () => {
		// #given
		const handle = createRateLimitHandle(createRateLimiter({ burst: 1 }));

		// #when
		const { result, resolve } = run(handle, "/api/preview");

		// #then
		expect((await result).status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("answers 429 with a breadcrumb and no Sentry event once exhausted", async () => {
		// #given
		const handle = createRateLimitHandle(createRateLimiter({ burst: 1 }));
		await run(handle, "/api/preview").result;

		// #when
		const { result, resolve } = run(handle, "/api/preview");
		const response = await result;

		// #then
		expect(response.status).toBe(429);
		expect(resolve).not.toHaveBeenCalled();
		expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
		expect(captureExceptionMock).not.toHaveBeenCalled();
	});

	it("never limits download-file, canary or health", async () => {
		// #given
		const handle = createRateLimitHandle(createRateLimiter({ burst: 1 }));
		await run(handle, "/api/preview").result;
		await run(handle, "/api/preview").result;

		// #when
		const results = await Promise.all(
			["/api/download-file", "/api/canary", "/api/health"].map(
				(path) => run(handle, path).result,
			),
		);

		// #then
		expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
	});

	it("skips limiting instead of failing when the client address is unavailable", async () => {
		// #given
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const handle = createRateLimitHandle(createRateLimiter({ burst: 1 }));
		const throwing = () => {
			throw new Error("no address");
		};

		// #when
		const first = await run(handle, "/api/preview", throwing).result;
		const second = await run(handle, "/api/preview", throwing).result;

		// #then
		expect([first.status, second.status]).toEqual([200, 200]);
	});

	it("tracks each client address separately", async () => {
		// #given
		const handle = createRateLimitHandle(createRateLimiter({ burst: 1 }));
		await run(handle, "/api/preview", () => "1.1.1.1").result;

		// #when
		const other = await run(handle, "/api/preview", () => "2.2.2.2").result;

		// #then
		expect(other.status).toBe(200);
	});
});
