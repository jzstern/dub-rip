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
		options: {
			maxWaitMs?: number;
			retryIntervalMs?: number;
			attemptTimeoutMs?: number;
			createTimeoutSignal?: (ms: number) => AbortSignal;
			url?: string;
		} = {},
	) {
		const { url = POT_URL, ...rest } = options;
		return waitForBgutilPot(url, {
			fetch: fetchMock,
			sleep: sleepMock,
			now: () => clockMs,
			...rest,
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

	it("makes exactly the attempts that fit before the cap, counting the pause before the next one", async () => {
		// #given
		fetchMock.mockRejectedValue(transportError());

		// #when
		const result = await wait({ maxWaitMs: 5_000, retryIntervalMs: 500 });

		// #then — attempts at 0, 500, ... 4500 ms; a further one at 5000 ms
		// would start at the cap, so the loop stops after the 4500 ms attempt
		expect(result).toEqual({ awake: false, attempts: 10, waitedMs: 4_500 });
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

	it("bounds every attempt with a timeout signal of the configured length", async () => {
		// #given
		const timeoutSignal = new AbortController().signal;
		const createTimeoutSignal = vi.fn(() => timeoutSignal);
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		await wait({ attemptTimeoutMs: 1_234, createTimeoutSignal });

		// #then
		expect(createTimeoutSignal).toHaveBeenCalledWith(1_234);
	});

	it("passes the timeout signal to fetch", async () => {
		// #given
		const timeoutSignal = new AbortController().signal;
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		await wait({ createTimeoutSignal: () => timeoutSignal });

		// #then
		expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeoutSignal);
	});

	it("cancels the response body of a 2xx answer", async () => {
		// #given
		const response = new Response("{}", { status: 200 });
		const cancel = vi.spyOn(response.body as ReadableStream, "cancel");
		fetchMock.mockResolvedValue(response);

		// #when
		await wait();

		// #then
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("cancels the response body of a non-2xx answer", async () => {
		// #given
		const notReady = new Response("starting", { status: 503 });
		const cancel = vi.spyOn(notReady.body as ReadableStream, "cancel");
		fetchMock
			.mockResolvedValueOnce(notReady)
			.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		await wait();

		// #then
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("still reports awake when cancelling the body throws", async () => {
		// #given
		const response = new Response("{}", { status: 200 });
		vi.spyOn(response.body as ReadableStream, "cancel").mockImplementation(
			() => {
				throw new Error("stream already closed");
			},
		);
		fetchMock.mockResolvedValue(response);

		// #when
		const result = await wait();

		// #then
		expect(result.awake).toBe(true);
	});

	it("drops a trailing slash from the base URL so it never requests //ping", async () => {
		// #given
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		await wait({ url: `${POT_URL}/` });

		// #then
		expect(fetchMock.mock.calls[0]?.[0]).toBe(`${POT_URL}/ping`);
	});

	it("drops repeated trailing slashes from the base URL", async () => {
		// #given
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

		// #when
		await wait({ url: `${POT_URL}///` });

		// #then
		expect(fetchMock.mock.calls[0]?.[0]).toBe(`${POT_URL}/ping`);
	});
});
