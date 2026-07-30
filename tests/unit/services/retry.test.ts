import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "$lib/retry";

describe("retryWithBackoff()", () => {
	it("returns the result on first success without sleeping", async () => {
		// #given
		const fn = vi.fn().mockResolvedValue("ok");
		const sleep = vi.fn().mockResolvedValue(undefined);

		// #when
		const result = await retryWithBackoff(fn, { sleep });

		// #then
		expect(result).toBe("ok");
		expect(sleep).not.toHaveBeenCalled();
	});

	it("retries a retryable failure and succeeds on a later attempt", async () => {
		// #given
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce("ok");
		const sleep = vi.fn().mockResolvedValue(undefined);

		// #when
		const result = await retryWithBackoff(fn, {
			isRetryable: () => true,
			sleep,
		});

		// #then
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("throws immediately without sleeping when the error is not retryable", async () => {
		// #given
		const error = new Error("permanent");
		const fn = vi.fn().mockRejectedValue(error);
		const sleep = vi.fn().mockResolvedValue(undefined);

		// #when / #then
		await expect(
			retryWithBackoff(fn, { isRetryable: () => false, sleep }),
		).rejects.toThrow("permanent");
		expect(fn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("stops after maxAttempts total tries and rethrows the last error", async () => {
		// #given
		const fn = vi.fn().mockRejectedValue(new Error("still failing"));
		const sleep = vi.fn().mockResolvedValue(undefined);

		// #when / #then
		await expect(
			retryWithBackoff(fn, {
				maxAttempts: 3,
				isRetryable: () => true,
				sleep,
			}),
		).rejects.toThrow("still failing");
		expect(fn).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("calls onRetry with the attempt number before each retry sleep", async () => {
		// #given
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce("ok");
		const sleep = vi.fn().mockResolvedValue(undefined);
		const onRetry = vi.fn();

		// #when
		await retryWithBackoff(fn, { isRetryable: () => true, sleep, onRetry });

		// #then
		expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
	});

	it("caps every backoff delay at maxDelayMs", async () => {
		// #given
		const fn = vi.fn().mockRejectedValue(new Error("still failing"));
		const sleep = vi.fn().mockResolvedValue(undefined);

		// #when
		await retryWithBackoff(fn, {
			maxAttempts: 4,
			baseDelayMs: 10_000,
			maxDelayMs: 1_000,
			isRetryable: () => true,
			sleep,
		}).catch(() => {});

		// #then
		for (const [delayMs] of sleep.mock.calls) {
			expect(delayMs).toBeLessThanOrEqual(1_000);
		}
	});

	it("never calls fn when the signal is already aborted", async () => {
		// #given
		const controller = new AbortController();
		controller.abort();
		const fn = vi.fn().mockResolvedValue("ok");
		const sleep = vi.fn().mockResolvedValue(undefined);

		// #when / #then
		await expect(
			retryWithBackoff(fn, { signal: controller.signal, sleep }),
		).rejects.toBeTruthy();
		expect(fn).not.toHaveBeenCalled();
	});

	it("does not wait out the full backoff once aborted mid-sleep, and never retries again", async () => {
		// #given — this sleep never resolves on its own; the only way
		// retryWithBackoff can settle is by racing it against the abort
		const controller = new AbortController();
		const failure = new Error("transient");
		const fn = vi.fn().mockRejectedValue(failure);
		let sleepStarted = false;
		const sleep = vi.fn().mockImplementation(() => {
			sleepStarted = true;
			return new Promise<void>(() => {});
		});

		// #when
		const promise = retryWithBackoff(fn, {
			maxAttempts: 5,
			isRetryable: () => true,
			signal: controller.signal,
			sleep,
		});
		await vi.waitFor(() => expect(sleepStarted).toBe(true));
		controller.abort();

		// #then
		await expect(promise).rejects.toThrow("transient");
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
