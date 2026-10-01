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

interface RunOptions {
	getClientAddress?: () => string;
	realIp?: string;
}

function setup(onRailway: boolean, burst = 1) {
	return createRateLimitHandle({
		limiter: createRateLimiter({ burst }),
		isRailway: () => onRailway,
	});
}

function run(
	handle: ReturnType<typeof createRateLimitHandle>,
	path: string,
	{ getClientAddress = () => "9.9.9.9", realIp }: RunOptions = {},
) {
	const resolve = vi.fn().mockResolvedValue(new Response("ok"));
	const headers = new Headers();
	if (realIp !== undefined) headers.set("x-real-ip", realIp);
	const event = {
		url: new URL(`http://localhost${path}`),
		request: new Request(`http://localhost${path}`, { headers }),
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
		vi.restoreAllMocks();
	});

	it("passes limited routes through while tokens remain", async () => {
		// #given
		const handle = setup(false);

		// #when
		const { result, resolve } = run(handle, "/api/preview");

		// #then
		expect((await result).status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("answers 429 with a breadcrumb and no Sentry event once exhausted", async () => {
		// #given
		const handle = setup(false);
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
		const handle = setup(false);
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

	describe("off Railway", () => {
		it("keys on getClientAddress, one bucket per address", async () => {
			// #given
			const handle = setup(false);
			await run(handle, "/api/preview", {
				getClientAddress: () => "1.1.1.1",
			}).result;

			// #when
			const same = await run(handle, "/api/preview", {
				getClientAddress: () => "1.1.1.1",
			}).result;
			const other = await run(handle, "/api/preview", {
				getClientAddress: () => "2.2.2.2",
			}).result;

			// #then
			expect([same.status, other.status]).toEqual([429, 200]);
		});

		it("ignores a spoofable x-real-ip header", async () => {
			// #given
			const handle = setup(false);
			await run(handle, "/api/preview", { realIp: "5.5.5.5" }).result;

			// #when
			const second = await run(handle, "/api/preview", { realIp: "6.6.6.6" })
				.result;

			// #then
			expect(second.status).toBe(429);
		});

		it("skips limiting when the client address is unavailable", async () => {
			// #given
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const handle = setup(false);
			const throwing = () => {
				throw new Error("no address");
			};

			// #when
			const first = await run(handle, "/api/preview", {
				getClientAddress: throwing,
			}).result;
			const second = await run(handle, "/api/preview", {
				getClientAddress: throwing,
			}).result;

			// #then
			expect([first.status, second.status]).toEqual([200, 200]);
		});
	});

	describe("on Railway", () => {
		it("keys on x-real-ip so different clients get separate buckets", async () => {
			// #given
			const handle = setup(true);
			const sharedProxy = () => "10.0.0.1";
			await run(handle, "/api/preview", {
				realIp: "1.1.1.1",
				getClientAddress: sharedProxy,
			}).result;

			// #when
			const same = await run(handle, "/api/preview", {
				realIp: " 1.1.1.1 ",
				getClientAddress: sharedProxy,
			}).result;
			const other = await run(handle, "/api/preview", {
				realIp: "2.2.2.2",
				getClientAddress: sharedProxy,
			}).result;

			// #then
			expect([same.status, other.status]).toEqual([429, 200]);
		});

		it("passes through unlimited without x-real-ip and warns once", async () => {
			// #given
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const handle = setup(true);

			// #when
			const statuses: number[] = [];
			for (let i = 0; i < 5; i++) {
				statuses.push((await run(handle, "/api/preview").result).status);
			}

			// #then
			expect(statuses).toEqual([200, 200, 200, 200, 200]);
			expect(warn).toHaveBeenCalledTimes(1);
		});

		it("treats a blank x-real-ip as missing instead of using getClientAddress", async () => {
			// #given
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const handle = setup(true);
			await run(handle, "/api/preview", { realIp: "  " }).result;

			// #when
			const second = await run(handle, "/api/preview", { realIp: "" }).result;

			// #then
			expect(second.status).toBe(200);
		});
	});
});
