// Like the other yt-dlp-binary suites, this file mocks "node:fs" wholesale.
// Vitest's worker-level isolation keeps that from bleeding into adjacent test
// files; re-run `vitest --no-isolate` to re-confirm if the worker pool config
// ever changes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fsModuleWith } from "./fs-module-mock";
import {
	assetResponse,
	assetUrl,
	BINARY_CONTENT,
	BINARY_DIGEST,
	digestOf,
	releaseResponse,
	UNPINNED_TAG,
	ytDlpAssetName,
} from "./github-release-fixture";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const existsSyncMock = vi.hoisted(() => vi.fn());
const accessSyncMock = vi.hoisted(() => vi.fn());
const statSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const chmodSyncMock = vi.hoisted(() => vi.fn());
const renameSyncMock = vi.hoisted(() => vi.fn());
const unlinkSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () =>
	fsModuleWith({
		existsSync: existsSyncMock,
		accessSync: accessSyncMock,
		statSync: statSyncMock,
		writeFileSync: writeFileSyncMock,
		chmodSync: chmodSyncMock,
		renameSync: renameSyncMock,
		unlinkSync: unlinkSyncMock,
	}),
);

const PINNED_CONTENT = "bytes that hash to the in-repo pin";
const PINNED_DIGEST = digestOf(PINNED_CONTENT);

// Bytes hashing to the real ASSET_SHA256 entry cannot be reproduced without the
// original 40MB binary, so the pinned-tag cases swap in a synthetic entry the
// test controls — the approach fetch-yt-dlp.test.ts established — and leave
// YTDLP_VERSION and every other export alone.
vi.mock("../../../scripts/yt-dlp-pin.mjs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../scripts/yt-dlp-pin.mjs")>();
	return {
		...actual,
		ASSET_SHA256: {
			...actual.ASSET_SHA256,
			[ytDlpAssetName()]: PINNED_DIGEST,
		},
	};
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function pinnedVersion(): Promise<string> {
	const { YTDLP_VERSION } = await import("../../../scripts/yt-dlp-pin.mjs");
	return YTDLP_VERSION;
}

describe("downloadYtDlpBinary() integrity checks", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchMock.mockReset();
		// No cached and no baked binary, so the download blocks the caller and
		// propagates its error instead of being swallowed by the refresh.
		existsSyncMock.mockReset().mockReturnValue(false);
		accessSyncMock.mockReset();
		statSyncMock.mockReset().mockReturnValue({ mtimeMs: Date.now() });
		writeFileSyncMock.mockReset();
		chmodSyncMock.mockReset();
		renameSyncMock.mockReset();
		unlinkSyncMock.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("installs a binary whose bytes hash to the digest the release API reported", async () => {
		// #given a release past the pin, where the API's digest is the only
		// expectation available
		fetchMock
			.mockResolvedValueOnce(releaseResponse())
			.mockResolvedValueOnce(assetResponse());

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();

		// #then
		expect(writeFileSyncMock).toHaveBeenCalled();
		expect(chmodSyncMock).toHaveBeenCalledWith(expect.any(String), 0o755);
	});

	it("refuses bytes that do not hash to the digest the release API reported", async () => {
		// #given the download returns something other than what the API vouched for
		fetchMock
			.mockResolvedValueOnce(releaseResponse())
			.mockResolvedValueOnce(assetResponse("substituted bytes"));

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(/Digest mismatch/);
	});

	it("never marks unverified bytes executable", async () => {
		// #given
		fetchMock
			.mockResolvedValueOnce(releaseResponse())
			.mockResolvedValueOnce(assetResponse("substituted bytes"));

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow();

		// #then the rejected binary reaches neither disk nor chmod
		expect(writeFileSyncMock).not.toHaveBeenCalled();
		expect(chmodSyncMock).not.toHaveBeenCalled();
	});

	it("prefers the in-repo pin over the API digest when latest resolves to the pinned version", async () => {
		// #given latest has caught up to the pin, and the bytes match the pin
		fetchMock
			.mockResolvedValueOnce(
				releaseResponse({
					tagName: await pinnedVersion(),
					digest: `sha256:${PINNED_DIGEST}`,
				}),
			)
			.mockResolvedValueOnce(assetResponse(PINNED_CONTENT));

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();

		// #then
		expect(chmodSyncMock).toHaveBeenCalledWith(expect.any(String), 0o755);
	});

	it("refuses when GitHub reports a different digest than the pin for the pinned tag", async () => {
		// #given the pinned tag now serves different bytes — a re-uploaded asset
		fetchMock.mockResolvedValueOnce(
			releaseResponse({
				tagName: await pinnedVersion(),
				digest: `sha256:${BINARY_DIGEST}`,
			}),
		);

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(
			/reports a different .* than the digest pinned/,
		);
	});

	it("refuses when the release carries no digest and its tag is past the pin", async () => {
		// #given nothing in the response or the repo can vouch for these bytes
		fetchMock.mockResolvedValueOnce(releaseResponse({ digest: null }));

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(/No digest available/);
	});

	it("refuses a digest string that is not a sha256 hex value", async () => {
		// #given
		fetchMock.mockResolvedValueOnce(
			releaseResponse({ digest: "md5:beefcafe" }),
		);

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(/No digest available/);
	});

	it("refuses a download URL pointing somewhere other than the yt-dlp release path", async () => {
		// #given a release response whose download URL was swapped out
		fetchMock.mockResolvedValueOnce(
			releaseResponse({ url: "https://evil.test/yt-dlp" }),
		);

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(
			/expected an asset under https:\/\/github\.com\/yt-dlp\/yt-dlp\//,
		);

		// #then the rejected host is never contacted
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refuses an asset hosted under a different github.com repository", async () => {
		// #given a response naming someone else's release asset together with
		// that asset's true digest. github.com serves release assets for every
		// account, so a host-only check would pass it — and because the digest
		// comes from this same response, the verification would then be
		// satisfied by the attacker's own bytes.
		const payload = "attacker payload";
		fetchMock
			.mockResolvedValueOnce(
				releaseResponse({
					url: "https://github.com/attacker/evil/releases/download/v1/yt-dlp",
					digest: `sha256:${digestOf(payload)}`,
				}),
			)
			.mockResolvedValueOnce(assetResponse(payload));

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(
			/expected an asset under https:\/\/github\.com\/yt-dlp\/yt-dlp\//,
		);

		// #then the payload is never fetched, let alone written
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refuses a path that only reaches the release prefix through traversal", async () => {
		// #given the URL parser normalises `..` before the prefix test sees it
		fetchMock.mockResolvedValueOnce(
			releaseResponse({
				url: "https://github.com/yt-dlp/yt-dlp/releases/download/../../../attacker/evil/raw/yt-dlp",
			}),
		);

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(
			/expected an asset under https:\/\/github\.com\/yt-dlp\/yt-dlp\//,
		);
	});

	it("refuses a lookalike host that merely starts with the allowed one", async () => {
		// #given
		fetchMock.mockResolvedValueOnce(
			releaseResponse({ url: "https://github.com.evil.test/yt-dlp" }),
		);

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(
			/expected an asset under https:\/\/github\.com\/yt-dlp\/yt-dlp\//,
		);
	});

	it("refuses a plaintext download URL", async () => {
		// #given
		fetchMock.mockResolvedValueOnce(
			releaseResponse({
				url: assetUrl(UNPINNED_TAG, ytDlpAssetName()).replace(
					"https://",
					"http://",
				),
			}),
		);

		// #when / #then
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await expect(ensureYtDlpBinary()).rejects.toThrow(
			/expected an asset under https:\/\/github\.com\/yt-dlp\/yt-dlp\//,
		);
	});

	it("keeps serving the cached binary when a background refresh fails verification", async () => {
		// #given a running instance whose cached binary has aged past the TTL
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		fetchMock
			.mockResolvedValueOnce(releaseResponse())
			.mockResolvedValueOnce(assetResponse("substituted bytes"));

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		const path = await ensureYtDlpBinary();

		// #then failing closed costs the refresh, not the instance
		expect(path).toMatch(/yt-dlp$/);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(renameSyncMock).not.toHaveBeenCalled();
	});

	it("still installs a verified refresh, so failing closed has not frozen the binary", async () => {
		// #given the same stale instance, this time served matching bytes
		existsSyncMock.mockReturnValue(true);
		statSyncMock.mockReturnValue({ mtimeMs: Date.now() - ONE_DAY_MS - 1000 });
		fetchMock
			.mockResolvedValueOnce(releaseResponse())
			.mockResolvedValueOnce(assetResponse(BINARY_CONTENT));

		// #when
		const { ensureYtDlpBinary } = await import("$lib/yt-dlp-binary");
		await ensureYtDlpBinary();

		// #then the upstream extraction fixes still land
		await vi.waitFor(() => expect(renameSyncMock).toHaveBeenCalled());
	});
});
