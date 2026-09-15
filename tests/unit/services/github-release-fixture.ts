import { createHash } from "node:crypto";

/**
 * Fixtures for the GitHub releases API, shared by every test that exercises a
 * yt-dlp or plugin fetch — the runtime download and the build-time bake alike,
 * since both now verify the same way.
 *
 * They live together because the runtime now refuses to install anything it
 * cannot hash to an expected digest, which makes a release fixture a matched
 * pair rather than two independent values: the bytes the download returns, and
 * the `sha256:` the API claims for those bytes. A zero-filled buffer is no
 * longer usable as a stand-in — not because hashing one is hard, but because a
 * fixture that does not state its own digest can no longer describe a download
 * that is supposed to succeed.
 */
export const BINARY_CONTENT = "fake yt-dlp binary bytes";

export function digestOf(content: string): string {
	return createHash("sha256")
		.update(new TextEncoder().encode(content))
		.digest("hex");
}

export const BINARY_DIGEST = digestOf(BINARY_CONTENT);

/**
 * A tag deliberately unequal to `YTDLP_VERSION`, so fixtures built on it
 * exercise the ordinary case — `releases/latest` has moved past the in-repo
 * pin, leaving GitHub's reported digest as the only available expectation.
 */
export const UNPINNED_TAG = "2099.12.31";

/**
 * Stand-in bytes for the bgutil plugin zip.
 *
 * Its expected digest is the real `ASSET_SHA256` entry rather than anything the
 * network reports, and bytes hashing to that entry cannot be reproduced without
 * the original zip — so tests swap a synthetic entry into the pin module and
 * serve these, exactly as `fetch-yt-dlp.test.ts` does for the build path.
 */
export const PLUGIN_CONTENT = "pinned bgutil plugin zip bytes";

export const PLUGIN_DIGEST = digestOf(PLUGIN_CONTENT);

export function ytDlpAssetName(): string {
	return process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
}

/**
 * The host is written out rather than imported from `yt-dlp-pin.mjs` for two
 * reasons: test files that mock that module would otherwise import it through
 * this one and deadlock on `vi.mock` hoisting, and a fixture that echoes the
 * constant under test back at itself cannot catch that constant changing.
 */
export function assetUrl(tagName: string, assetName: string): string {
	return `https://github.com/yt-dlp/yt-dlp/releases/download/${tagName}/${assetName}`;
}

export function assetResponse(content: string = BINARY_CONTENT) {
	return {
		ok: true,
		arrayBuffer: () =>
			Promise.resolve(new TextEncoder().encode(content).buffer as ArrayBuffer),
	};
}

type ReleaseOptions = {
	tagName?: string;
	/** `null` models a release whose assets carry no digest at all. */
	digest?: string | null;
	/** Overrides the download URL on every asset. */
	url?: string;
};

/**
 * Both platform assets are listed, as a real release does, so the asset-picking
 * step stays covered. They share a digest because they serve the same fixture
 * bytes.
 */
export function releaseResponse({
	tagName = UNPINNED_TAG,
	digest = `sha256:${BINARY_DIGEST}`,
	url,
}: ReleaseOptions = {}) {
	return {
		ok: true,
		json: () =>
			Promise.resolve({
				tag_name: tagName,
				assets: ["yt-dlp_macos", "yt-dlp_linux"].map((name) => ({
					name,
					browser_download_url: url ?? assetUrl(tagName, name),
					digest,
				})),
			}),
	};
}

/** Answers the releases API and the asset download from one implementation. */
export function mockLatestRelease(
	fetchMock: { mockImplementation: (fn: (url: string) => unknown) => unknown },
	options: ReleaseOptions & { content?: string } = {},
): void {
	const { content, ...releaseOptions } = options;
	fetchMock.mockImplementation((url: string) =>
		Promise.resolve(
			String(url).includes("api.github.com")
				? releaseResponse(releaseOptions)
				: assetResponse(content),
		),
	);
}
