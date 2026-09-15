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
export const YTDLP_VERSION = "2026.08.19";

/**
 * Keep in step with the `bgutil-pot` image tag in `railway.toml` — the plugin
 * and the sidecar speak a versioned protocol.
 */
export const BGUTIL_PLUGIN_VERSION = "2.0.0";

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
		"58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a",
	"yt-dlp_macos":
		"0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
	[BGUTIL_PLUGIN_FILENAME]:
		"bce874dfa25896c2798e0f4f8147b7b22e785479eb1e459ab232bf2506c95016",
};

/** @returns {string} */
export function getYtDlpAssetName() {
	return platform() === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
}

export const GITHUB_RELEASE_HOST = "github.com";

export const YTDLP_REPO = "yt-dlp/yt-dlp";
export const BGUTIL_PLUGIN_REPO = "Brainicism/bgutil-ytdlp-pot-provider";

/**
 * The URL prefix every release asset of `repo` must sit under.
 *
 * Shared with the runtime rather than written out per URL, because the runtime
 * refresh takes its download URL straight from the GitHub releases JSON — an
 * attacker-controlled string if that response is ever tampered with or spoofed.
 *
 * The repository has to be part of the check, not just the host. github.com
 * serves release assets for *every* account, so "it is on github.com" is not a
 * trust boundary on its own: a response pointing at some other account's asset
 * would pass a host-only check, and in the common case (`releases/latest` has
 * moved past the pin) the digest that asset is held to comes out of that very
 * same response — so the verification would be satisfied by construction.
 * Pinning the path means the bytes must at least be published under this
 * project's own releases.
 *
 * @param {string} repo
 * @returns {string}
 */
export function getReleaseAssetPrefix(repo) {
	return `https://${GITHUB_RELEASE_HOST}/${repo}/releases/download/`;
}

/** @returns {string} */
export function getYtDlpDownloadUrl() {
	return `${getReleaseAssetPrefix(YTDLP_REPO)}${YTDLP_VERSION}/${getYtDlpAssetName()}`;
}

/** @returns {string} */
export function getBgutilPluginDownloadUrl() {
	return `${getReleaseAssetPrefix(BGUTIL_PLUGIN_REPO)}${BGUTIL_PLUGIN_VERSION}/${BGUTIL_PLUGIN_FILENAME}`;
}
