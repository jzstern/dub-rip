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
});
