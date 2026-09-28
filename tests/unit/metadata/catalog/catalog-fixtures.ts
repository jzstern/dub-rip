import { type Mock, vi } from "vitest";
import responses from "../../../fixtures/catalog/catalog-responses.json";

/**
 * Serves the responses recorded by `scripts/record-catalog-fixtures.ts`, so the
 * catalog tests exercise the shapes iTunes and Deezer really return.
 *
 * A URL that was never recorded THROWS rather than answering 404. Answering 404
 * would let every "no match" test keep passing after the fixture file went
 * stale or a search term changed — the tests would agree with each other and
 * with nothing else.
 */

const RECORDED: Record<string, unknown> = responses;

interface FixtureResponse {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
}

export interface StubOptions {
	/**
	 * URL fragments that are expected to be absent, for tests that need a real
	 * miss — a fabricated ISRC, say. Anything else missing is a mistake.
	 */
	allowMissing?: string[];
}

export interface CatalogFetchStub extends Mock {
	/**
	 * URLs asked for that no fixture covers. Throwing is not enough on its own:
	 * the adapters catch everything and degrade to "no candidates", so a stale
	 * fixture would quietly turn a real assertion into a passing "no match".
	 */
	missing: string[];
}

export function stubCatalogFetch({
	allowMissing = [],
}: StubOptions = {}): CatalogFetchStub {
	const missing: string[] = [];
	const fetchMock = vi.fn(async (input: unknown): Promise<FixtureResponse> => {
		const url = String(input);
		const body = RECORDED[url];
		if (body !== undefined) {
			return { ok: true, status: 200, json: async () => body };
		}
		if (allowMissing.some((fragment) => url.includes(fragment))) {
			return { ok: false, status: 404, json: async () => ({}) };
		}
		missing.push(url);
		throw new Error(
			`No recorded catalog response for ${url}. Re-record with \`bun scripts/record-catalog-fixtures.ts\`, or pass allowMissing if the miss is the point of the test.`,
		);
	}) as CatalogFetchStub;
	fetchMock.missing = missing;
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

/**
 * Fails the test when the code asked for a URL no fixture covers. The adapters
 * swallow the stub's throw, so without this a renamed search term turns a real
 * assertion into a vacuous one.
 */
export function expectEveryFixtureHit(stub: CatalogFetchStub): void {
	if (stub.missing.length > 0) {
		throw new Error(
			`Fixtures missing for:\n  ${stub.missing.join("\n  ")}\nRe-record with \`bun scripts/record-catalog-fixtures.ts\`.`,
		);
	}
}
