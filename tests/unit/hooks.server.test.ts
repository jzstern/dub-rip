import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureExceptionMock = vi.fn();
const flushMock = vi.fn();

vi.mock("@sentry/sveltekit", () => ({
	init: vi.fn(),
	captureException: captureExceptionMock,
	flush: flushMock,
	sentryHandle:
		() =>
		async ({ event, resolve }: any) =>
			resolve(event),
	handleErrorWithSentry: () => () => {},
}));

const HANDLER_TAG = Symbol.for("dub-rip.process-error-handlers");

describe("registerProcessErrorHandlers()", () => {
	beforeEach(() => {
		captureExceptionMock.mockReset();
		flushMock.mockReset().mockResolvedValue(true);
		// Critical: clear the global tag so registerProcessErrorHandlers()
		// doesn't early-return on subsequent test imports. Then strip any
		// listeners left from a previous test/module instance.
		delete (globalThis as Record<symbol, unknown>)[HANDLER_TAG];
		process.removeAllListeners("uncaughtException");
		process.removeAllListeners("unhandledRejection");
		process.removeAllListeners("warning");
		vi.resetModules();
	});

	afterEach(() => {
		process.removeAllListeners("uncaughtException");
		process.removeAllListeners("unhandledRejection");
		process.removeAllListeners("warning");
		delete (globalThis as Record<symbol, unknown>)[HANDLER_TAG];
		vi.restoreAllMocks();
	});

	it("captures uncaught exceptions to Sentry, flushes, then exits 1, in that order", async () => {
		// #given
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);

		const { registerProcessErrorHandlers } = await import(
			"../../src/hooks.server"
		);
		registerProcessErrorHandlers();

		const err = new Error("boom");
		const handler = process.listeners("uncaughtException")[0] as (
			e: unknown,
		) => void;

		// #when
		handler(err);
		await Promise.resolve();
		await Promise.resolve();

		// #then
		expect(captureExceptionMock).toHaveBeenCalledWith(err);
		expect(flushMock).toHaveBeenCalledWith(2000);
		expect(captureExceptionMock.mock.invocationCallOrder[0]).toBeLessThan(
			flushMock.mock.invocationCallOrder[0],
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(flushMock.mock.invocationCallOrder[0]).toBeLessThan(
			exitSpy.mock.invocationCallOrder[0],
		);
	});

	it("exits even when Sentry.flush rejects (don't lose the crash)", async () => {
		// #given
		flushMock.mockRejectedValueOnce(new Error("network"));
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);

		const { registerProcessErrorHandlers } = await import(
			"../../src/hooks.server"
		);
		registerProcessErrorHandlers();
		const handler = process.listeners("uncaughtException")[0] as (
			e: unknown,
		) => void;

		// #when
		handler(new Error("boom"));
		await Promise.resolve();
		await Promise.resolve();

		// #then
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("is idempotent — calling twice does not stack handlers", async () => {
		// #given
		const { registerProcessErrorHandlers } = await import(
			"../../src/hooks.server"
		);

		// #when
		registerProcessErrorHandlers();
		registerProcessErrorHandlers();

		// #then
		expect(process.listenerCount("uncaughtException")).toBe(1);
		expect(process.listenerCount("unhandledRejection")).toBe(1);
		expect(process.listenerCount("warning")).toBe(1);
	});

	it("captures process warnings to Sentry at warning level", async () => {
		// #given
		const { registerProcessErrorHandlers } = await import(
			"../../src/hooks.server"
		);
		registerProcessErrorHandlers();

		const warning = new Error("test warning");

		// #when
		process.emit("warning", warning);

		// #then
		expect(captureExceptionMock).toHaveBeenCalledWith(warning, {
			level: "warning",
			tags: { service: "hooks.server", operation: "process-warning" },
		});
	});
});
