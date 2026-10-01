import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCatalogCandidatesMock, captureExceptionMock } = vi.hoisted(() => ({
	fetchCatalogCandidatesMock: vi.fn(),
	captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/sveltekit", () => ({
	captureException: captureExceptionMock,
}));

/** The real searches swallow their own errors, so only a stand-in can throw a bug. */
vi.mock("$lib/metadata/catalog/lookup-catalog", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("$lib/metadata/catalog/lookup-catalog")
	>()),
	fetchCatalogCandidates: fetchCatalogCandidatesMock,
}));

import {
	clearCatalogCandidateCache,
	sharedCatalogLookup,
} from "$lib/metadata/catalog/catalog-cache";
import { CatalogUnavailableError } from "$lib/metadata/catalog/lookup-catalog";

const QUERY = { artist: "Adele", title: "Hello" };
const UNREACHABLE = "[catalog] unmatched reason=catalogs-unreachable";

describe("sharedCatalogLookup() when the candidate fetch throws", () => {
	beforeEach(() => {
		clearCatalogCandidateCache();
		fetchCatalogCandidatesMock.mockReset();
		captureExceptionMock.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs an outage as catalogs-unreachable", async () => {
		// #given
		fetchCatalogCandidatesMock.mockRejectedValue(new CatalogUnavailableError());

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(console.log).toHaveBeenCalledWith(UNREACHABLE);
	});

	it("does not report an outage to Sentry", async () => {
		// #given
		fetchCatalogCandidatesMock.mockRejectedValue(new CatalogUnavailableError());

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(captureExceptionMock).not.toHaveBeenCalled();
	});

	it("does not log a bug as an outage", async () => {
		// #given
		fetchCatalogCandidatesMock.mockRejectedValue(new TypeError("boom"));

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(console.log).not.toHaveBeenCalledWith(UNREACHABLE);
	});

	it("logs a bug as a failed lookup", async () => {
		// #given
		const bug = new TypeError("boom");
		fetchCatalogCandidatesMock.mockRejectedValue(bug);

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(console.error).toHaveBeenCalledWith("[catalog] lookup failed:", bug);
	});

	it("reports a bug to Sentry", async () => {
		// #given
		const bug = new TypeError("boom");
		fetchCatalogCandidatesMock.mockRejectedValue(bug);

		// #when
		await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(captureExceptionMock).toHaveBeenCalledWith(
			bug,
			expect.objectContaining({
				tags: { service: "catalog", operation: "lookup" },
			}),
		);
	});

	it("still answers unmatched for a bug", async () => {
		// #given
		fetchCatalogCandidatesMock.mockRejectedValue(new TypeError("boom"));

		// #when
		const { verdict } = await sharedCatalogLookup(QUERY, { timeout: 4000 });

		// #then
		expect(verdict).toEqual({ status: "unmatched", reason: "no-candidates" });
	});
});
