import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@sentry/sveltekit", () => ({
	addBreadcrumb: vi.fn(),
	captureCheckIn: vi.fn(() => "fake-check-in-id"),
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	logger: { warn: vi.fn(), error: vi.fn() },
	init: vi.fn(),
	handleErrorWithSentry: vi.fn(() => vi.fn()),
	sentryHandle: vi.fn(() => vi.fn()),
}));
