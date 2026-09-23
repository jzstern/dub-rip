import { vi } from "vitest";
import responses from "../../../fixtures/catalog/catalog-responses.json";

/**
 * Serves the responses recorded by `scripts/record-catalog-fixtures.ts`, so the
 * catalog tests exercise the shapes iTunes and Deezer really return. A URL that
 * was never recorded answers 404, which is what an unexpected call looks like.
 */

const RECORDED: Record<string, unknown> = responses;

export interface FixtureResponse {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
}

export function recordedResponse(url: string): FixtureResponse {
	const body = RECORDED[url];
	return body === undefined
		? { ok: false, status: 404, json: async () => ({}) }
		: { ok: true, status: 200, json: async () => body };
}

export function stubCatalogFetch(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (input: unknown) =>
		recordedResponse(String(input)),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}
