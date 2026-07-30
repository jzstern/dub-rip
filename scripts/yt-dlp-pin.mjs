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
