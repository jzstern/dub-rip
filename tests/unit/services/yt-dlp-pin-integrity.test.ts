import { describe, expect, it } from "vitest";
import {
	ASSET_SHA256,
	BGUTIL_PLUGIN_FILENAME,
	getBgutilPluginDownloadUrl,
	getYtDlpAssetName,
	getYtDlpDownloadUrl,
	YTDLP_VERSION,
} from "../../../scripts/yt-dlp-pin.mjs";

/**
 * A pin bump edits the version string and the digest map, and the two have to
 * move together. This covers the map's *shape* only: every asset the pin can
 * request carries a well-formed digest, and no key is orphaned.
 *
 * It deliberately does not assert that a digest corresponds to YTDLP_VERSION —
 * that needs the network or the baked binary, and `downloadTo` already hashes
 * the real bytes at build time. What it does catch is the half-done bump that
 * leaves a platform without a digest, which fails quietly rather than loudly:
 * `downloadTo` throws "No pinned SHA-256 recorded", the build script swallows
 * every such error and exits 0 (scripts/fetch-yt-dlp.mjs), and the deploy then
 * ships with no `bin/` and falls back to an unverified runtime download.
 *
 * The platform mapping is asserted through literal names rather than by mocking
 * `node:os` per case: only the first `vi.doMock` of a module takes effect within
 * a file, so a per-platform mock silently resolves every case to the first one.
 */
describe("yt-dlp pin integrity", () => {
	const YTDLP_ASSET_NAMES = ["yt-dlp_linux", "yt-dlp_macos"];

	it.each(
		YTDLP_ASSET_NAMES,
	)("pins a well-formed digest for %s", (assetName) => {
		// #when
		const digest = ASSET_SHA256[assetName];

		// #then
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
	});

	it("pins a well-formed digest for the bgutil plugin zip", () => {
		// #when
		const digest = ASSET_SHA256[BGUTIL_PLUGIN_FILENAME];

		// #then
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
	});

	it("resolves this platform to an asset the map has a digest for", () => {
		// #given
		// Guards the literal names above against an upstream asset rename, which
		// would otherwise leave every case asserting a key nothing requests.
		const assetName = getYtDlpAssetName();

		// #then
		expect(YTDLP_ASSET_NAMES).toContain(assetName);
	});

	it("carries no digest for an asset it can never request", () => {
		// #given
		// A stale key outlives the bump that orphaned it and reads as a digest
		// that was refreshed when it was not.
		const reachable = new Set([...YTDLP_ASSET_NAMES, BGUTIL_PLUGIN_FILENAME]);

		// #when
		const orphaned = Object.keys(ASSET_SHA256).filter(
			(key) => !reachable.has(key),
		);

		// #then
		expect(orphaned).toEqual([]);
	});

	it("builds a yt-dlp download URL from the pinned version", () => {
		// #when
		const url = getYtDlpDownloadUrl();

		// #then
		expect(url).toContain(`/download/${YTDLP_VERSION}/`);
	});

	it("builds a plugin download URL that names the pinned zip", () => {
		// #when
		const url = getBgutilPluginDownloadUrl();

		// #then
		expect(url).toContain(BGUTIL_PLUGIN_FILENAME);
	});
});
