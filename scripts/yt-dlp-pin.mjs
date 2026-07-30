import { platform } from "node:os";

/**
 * Single declaration of the pinned toolchain, shared by the build-time bake
 * (`fetch-yt-dlp.mjs`) and the runtime fallback (`src/lib/yt-dlp-binary.ts`).
 *
 * It lives here rather than in either consumer because the dependency can only
 * run one way: the build script must be importable by plain `node`/`bun` before
 * SvelteKit exists, so it cannot import from `$lib`. Keeping this module free of
 * side effects — no fs, no network, no top-level await — is what stops the
 * build script from being pulled into the server bundle.
 */
export const YTDLP_VERSION = "2026.07.04";

/**
 * Keep in step with the `bgutil-pot` image tag in `railway.toml` — the plugin
 * and the sidecar speak a versioned protocol.
 */
export const BGUTIL_PLUGIN_VERSION = "1.3.1";

export const BIN_DIR_NAME = "bin";
export const BAKED_YTDLP_NAME = "yt-dlp";
export const BAKED_PLUGIN_DIR_NAME = "yt-dlp-plugins";
export const BGUTIL_PLUGIN_FILENAME = "bgutil-ytdlp-pot-provider.zip";

/**
 * SHA-256 of each pinned asset, from the GitHub release.
 *
 * A version tag is not immutable — a release asset can be re-uploaded under the
 * same tag — and this binary is fetched over the network and then executed. That
 * is the same argument `railway.toml` already makes for pinning the bgutil-pot
 * image by digest rather than tag alone; it applies at least as strongly to
 * something we mark executable.
 *
 * Capture with:
 *   gh release view <tag> --repo yt-dlp/yt-dlp --json assets \
 *     --jq '.assets[] | select(.name|startswith("yt-dlp_")) | "\(.name) \(.digest)"'
 *
 * Typed as a plain string-keyed map, not the literal-key object TS would
 * otherwise infer, because callers look assets up dynamically by name (see
 * `downloadTo` in fetch-yt-dlp.mjs) — an unknown key is a runtime concern
 * ("no pinned digest for this asset"), not something the type system can
 * reject at the call site.
 *
 * @type {Record<string, string>}
 */
export const ASSET_SHA256 = {
	"yt-dlp_linux":
		"6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae",
	"yt-dlp_macos":
		"498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b",
	[BGUTIL_PLUGIN_FILENAME]:
		"b8ceec7f76143da172aaf5ebeec0c2d218e5680c063b931586bca48567069b38",
};

/** @returns {string} */
export function getYtDlpAssetName() {
	return platform() === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
}

/** @returns {string} */
export function getYtDlpDownloadUrl() {
	return `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${getYtDlpAssetName()}`;
}

/** @returns {string} */
export function getBgutilPluginDownloadUrl() {
	return `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_PLUGIN_VERSION}/${BGUTIL_PLUGIN_FILENAME}`;
}
