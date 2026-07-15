import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof window !== "undefined" && !window.matchMedia) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

vi.mock("@sentry/sveltekit", () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	init: vi.fn(),
	handleErrorWithSentry: vi.fn(() => vi.fn()),
	sentryHandle: vi.fn(() => vi.fn()),
}));
