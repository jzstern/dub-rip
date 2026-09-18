import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitForBgutilPot } from "$lib/canary/wait-for-bgutil-pot";

const POT_URL = "http://bgutil.internal:4416";

function transportError(): TypeError {
	return new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
}

describe("waitForBgutilPot()", () => {
	let clockMs: number;
	const fetchMock = vi.fn<typeof fetch>();
	const sleepMock = vi.fn<(ms: number) => Promise<void>>();

	function wait(
		options: { maxWaitMs?: number; retryIntervalMs?: number } = {},
	) {
		return waitForBgutilPot(POT_URL, {
			fetch: fetchMock,
			sleep: sleepMock,
			now: () => clockMs,
			...options,
		});
	}

	beforeEach(() => {
		clockMs = 0;
		fetchMock.mockReset();
		sleepMock.mockReset().mockImplementation(async (ms) => {
			clockMs += ms;
		});
	});

	it("reports awake without sleeping when the first ping answers", async () => {
		// #given
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		const result = await wait();

		// #then
		expect(result).toEqual({ awake: true, attempts: 1, waitedMs: 0 });
	});

	it("pings <url>/ping and nothing else", async () => {
		// #given
		fetchMock
			.mockRejectedValueOnce(transportError())
			.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		await wait();

		// #then
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			`${POT_URL}/ping`,
			`${POT_URL}/ping`,
		]);
	});

	it("never requests /get_pot, which does real BotGuard work", async () => {
		// #given
		fetchMock.mockRejectedValue(transportError());

		// #when
		await wait();

		// #then
		const requested = fetchMock.mock.calls.map(([url]) => String(url));
		expect(requested.some((url) => url.includes("get_pot"))).toBe(false);
	});

	it("keeps polling through cold-start transport failures until the sidecar answers", async () => {
		// #given
		fetchMock
			.mockRejectedValueOnce(transportError())
			.mockRejectedValueOnce(transportError())
			.mockRejectedValueOnce(transportError())
			.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		const result = await wait({ retryIntervalMs: 500 });

		// #then
		expect(result).toEqual({ awake: true, attempts: 4, waitedMs: 1500 });
	});

	it("treats a non-2xx answer as not ready yet", async () => {
		// #given
		fetchMock
			.mockResolvedValueOnce(new Response("", { status: 503 }))
			.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		const result = await wait();

		// #then
		expect(result.attempts).toBe(2);
	});

	it("gives up quietly when the sidecar never answers within the cap", async () => {
		// #given
		fetchMock.mockRejectedValue(transportError());

		// #when
		const result = await wait({ maxWaitMs: 5_000, retryIntervalMs: 500 });

		// #then
		expect(result.awake).toBe(false);
	});

	it("stops starting new attempts once the cap has passed", async () => {
		// #given
		fetchMock.mockRejectedValue(transportError());

		// #when
		const result = await wait({ maxWaitMs: 5_000, retryIntervalMs: 500 });

		// #then
		expect(result.waitedMs).toBeLessThanOrEqual(5_000);
	});

	it("resolves instead of throwing when fetch rejects", async () => {
		// #given
		fetchMock.mockRejectedValue(transportError());

		// #when
		const outcome = wait({ maxWaitMs: 1_000, retryIntervalMs: 500 });

		// #then
		await expect(outcome).resolves.toBeDefined();
	});

	it("resolves instead of throwing when fetch throws synchronously", async () => {
		// #given
		fetchMock.mockImplementation(() => {
			throw new Error("invalid URL");
		});

		// #when
		const outcome = wait({ maxWaitMs: 1_000, retryIntervalMs: 500 });

		// #then
		await expect(outcome).resolves.toMatchObject({ awake: false });
	});

	it("bounds every attempt with an abort signal", async () => {
		// #given
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		await wait();

		// #then
		expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
	});
});
