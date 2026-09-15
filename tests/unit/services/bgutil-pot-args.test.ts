import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_CONTENT, PLUGIN_DIGEST } from "./github-release-fixture";

const mockEnv: Record<string, string | undefined> = {};
vi.mock("$env/dynamic/private", () => ({ env: mockEnv }));

const existsSyncMock = vi.hoisted(() => vi.fn());
const readFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const overrides = {
		existsSync: existsSyncMock,
		readFileSync: readFileSyncMock,
	};
	return { ...actual, default: { ...actual, ...overrides }, ...overrides };
});

// ensureBgutilPlugin now holds the cached zip to the pinned digest, and bytes
// hashing to the real pin cannot be reproduced without the original zip — so
// swap in a synthetic entry the test controls, as fetch-yt-dlp.test.ts does.
vi.mock("../../../scripts/yt-dlp-pin.mjs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../scripts/yt-dlp-pin.mjs")>();
	return {
		...actual,
		ASSET_SHA256: {
			...actual.ASSET_SHA256,
			[actual.BGUTIL_PLUGIN_FILENAME]: PLUGIN_DIGEST,
		},
	};
});

/**
 * Covers the real `buildBgutilPotArgs`, which every other suite mocks out. The
 * production failure this guards against lived entirely inside the string it
 * returns, so a mocked stand-in could never have caught it.
 */
describe("buildBgutilPotArgs()", () => {
	beforeEach(() => {
		vi.resetModules();
		existsSyncMock.mockReset();
		readFileSyncMock.mockReset();
		// The plugin zip is already on disk and matches the pin, so
		// ensureBgutilPlugin short-circuits instead of reaching for the network.
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue(Buffer.from(PLUGIN_CONTENT));
		mockEnv.BGUTIL_POT_URL = "http://bgutil-pot.railway.internal:4416";
	});

	const youtubeArg = async (): Promise<string | undefined> => {
		const { buildBgutilPotArgs } = await import("$lib/yt-dlp-binary");
		const args = await buildBgutilPotArgs();
		return args.find((arg) => arg.startsWith("youtube:"));
	};

	it("returns no args when BGUTIL_POT_URL is unset", async () => {
		// #given
		mockEnv.BGUTIL_POT_URL = undefined;

		// #when
		const { buildBgutilPotArgs } = await import("$lib/yt-dlp-binary");
		const args = await buildBgutilPotArgs();

		// #then
		expect(args).toEqual([]);
	});

	it("forces PO token fetching, which none of the configured clients request on their own", async () => {
		// #given
		// yt-dlp's default `fetch_pot=auto` only mints a token when the client's
		// own policy demands one, and web_safari/mweb/tv all declare the *player*
		// token optional — so the player request went out bare and YouTube
		// bot-checked it from Railway's datacenter IP.

		// #when
		const arg = await youtubeArg();

		// #then
		expect(arg).toMatch(/(^|;)fetch_pot=always(;|$)/);
	});

	it("restricts player_client to the clients bgutil can mint a WebPO token for", async () => {
		// #when
		const arg = await youtubeArg();

		// #then
		expect(arg).toContain("player_client=web_safari,mweb,tv");
	});

	it("never admits a client whose formats bgutil cannot authorize", async () => {
		// #when
		const arg = await youtubeArg();

		// #then
		expect(arg).not.toMatch(/default|visionos|android_vr/);
	});

	it("points the pot provider at the configured sidecar URL", async () => {
		// #when
		const { buildBgutilPotArgs } = await import("$lib/yt-dlp-binary");
		const args = await buildBgutilPotArgs();

		// #then
		expect(args).toContain(
			"youtubepot-bgutilhttp:base_url=http://bgutil-pot.railway.internal:4416",
		);
	});
});
