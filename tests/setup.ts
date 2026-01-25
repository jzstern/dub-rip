import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@sentry/sveltekit", () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	init: vi.fn(),
	handleErrorWithSentry: vi.fn(() => vi.fn()),
	sentryHandle: vi.fn(() => vi.fn()),
}));
