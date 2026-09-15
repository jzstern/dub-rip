#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ASSET_SHA256,
	BAKED_PLUGIN_DIR_NAME,
	BAKED_YTDLP_NAME,
	BGUTIL_PLUGIN_FILENAME,
	BGUTIL_PLUGIN_VERSION,
	BIN_DIR_NAME,
	getBgutilPluginDownloadUrl,
	getYtDlpAssetName,
	getYtDlpDownloadUrl,
	YTDLP_VERSION,
} from "./yt-dlp-pin.mjs";

const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Raised when an asset cannot be shown to be the pinned bytes — either it
 * hashes to something else, or no digest was ever recorded for it.
 *
 * It exists as a type rather than a message prefix because the CLI wrapper
 * below has to tell this apart from an unreachable GitHub, and those two
 * outcomes deserve opposite answers: a network failure costs startup latency
 * and must not break the deploy, while bytes that do not match the pin are the
 * exact event the pin was added to catch. Matching on the message text would
 * put that distinction one reworded `throw` away from silently inverting.
 */
export class AssetIntegrityError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = "AssetIntegrityError";
	}
}

/**
 * Returns the bytes already at `path` if they hash to `expectedDigest`,
 * otherwise `null`.
 *
 * Existence alone can't stand in for this check. The cache step in CI keys on
 * `scripts/yt-dlp-pin.mjs`, but its `restore-keys` fallback deliberately
 * accepts the newest prior cache entry when today's exact key misses — which
 * is exactly what happens the moment this file bumps a version. Treating
 * "a file is sitting there" as "it's the pinned one" would keep serving last
 * pin's bytes under the new pin, forever, which is the failure the pin exists
 * to prevent. Hashing what's on disk is the same trust boundary a fresh
 * download crosses below, just evaluated before paying for the network round
 * trip instead of after.
 *
 * @param {string} path
 * @param {string} expectedDigest
 * @returns {Buffer | null}
 */
function readIfDigestMatches(path, expectedDigest) {
	if (!existsSync(path)) return null;
	const bytes = readFileSync(path);
	const actual = createHash("sha256").update(bytes).digest("hex");
	return actual === expectedDigest ? bytes : null;
}

/**
 * Downloads an asset and refuses to install it unless it hashes to the pinned
 * digest. A release tag can be re-pointed at different bytes, and this artifact
 * is marked executable — so the digest, not the tag, is what is trusted.
 *
 * Bytes already sitting at `destPath` — e.g. restored from a CI cache — are
 * reused under that same digest check instead of re-fetched; see
 * `readIfDigestMatches` for why that reuse has to be keyed on the hash rather
 * than the file merely existing.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {string} assetName key into ASSET_SHA256
 * @returns {Promise<{bytes: number, reused: boolean}>}
 */
export async function downloadTo(url, destPath, assetName) {
	const expected = ASSET_SHA256[assetName];
	if (!expected) {
		throw new AssetIntegrityError(
			`No pinned SHA-256 recorded for ${assetName}`,
		);
	}

	const cached = readIfDigestMatches(destPath, expected);
	if (cached) {
		return { bytes: cached.byteLength, reused: true };
	}

	const res = await fetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
	}

	const bytes = Buffer.from(await res.arrayBuffer());
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expected) {
		throw new AssetIntegrityError(
			`Digest mismatch for ${assetName}: expected ${expected}, got ${actual} (${bytes.byteLength} bytes)`,
		);
	}

	// Write-then-rename: a half-written file at the final path would be picked
	// up by the runtime as a valid baked artifact, and there is no fallback
	// once it decides the bake succeeded.
	const tempPath = `${destPath}.partial`;
	try {
		writeFileSync(tempPath, bytes);
		renameSync(tempPath, destPath);
	} catch (err) {
		rmSync(tempPath, { force: true });
		throw err;
	}

	return { bytes: bytes.byteLength, reused: false };
}

/**
 * @param {string} repoRoot
 * @returns {Promise<void>}
 */
export async function fetchBakedArtifacts(repoRoot) {
	const binDir = join(repoRoot, BIN_DIR_NAME);
	const pluginDir = join(binDir, BAKED_PLUGIN_DIR_NAME);
	mkdirSync(pluginDir, { recursive: true });

	const ytDlpPath = join(binDir, BAKED_YTDLP_NAME);
	const ytDlpAssetName = getYtDlpAssetName();
	const ytDlp = await downloadTo(
		getYtDlpDownloadUrl(),
		ytDlpPath,
		ytDlpAssetName,
	);
	// Reused or not, a cache restore may not preserve the executable bit, so
	// this has to run unconditionally rather than only on the download branch.
	chmodSync(ytDlpPath, 0o755);
	console.log(
		ytDlp.reused
			? `[fetch-yt-dlp] ${ytDlpAssetName} ${YTDLP_VERSION} already at ${ytDlpPath} matches the pin, reusing it (${ytDlp.bytes} bytes)`
			: `[fetch-yt-dlp] ${ytDlpAssetName} ${YTDLP_VERSION} → ${ytDlpPath} (${ytDlp.bytes} bytes)`,
	);

	const pluginPath = join(pluginDir, BGUTIL_PLUGIN_FILENAME);
	const plugin = await downloadTo(
		getBgutilPluginDownloadUrl(),
		pluginPath,
		BGUTIL_PLUGIN_FILENAME,
	);
	console.log(
		plugin.reused
			? `[fetch-yt-dlp] bgutil plugin ${BGUTIL_PLUGIN_VERSION} already at ${pluginPath} matches the pin, reusing it (${plugin.bytes} bytes)`
			: `[fetch-yt-dlp] bgutil plugin ${BGUTIL_PLUGIN_VERSION} → ${pluginPath} (${plugin.bytes} bytes)`,
	);
}

const modulePath = fileURLToPath(import.meta.url);
const runFromCli =
	process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath;

if (runFromCli) {
	try {
		await fetchBakedArtifacts(resolve(dirname(modulePath), ".."));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		// An asset that does not match the pin is a finding, not an outage.
		// Exiting 0 here would hand CI a green build with no `bin/`, and the
		// runtime would then quietly fall back to downloading the binary
		// itself — turning the one signal that the bytes changed into a
		// slightly slower deploy nobody looks at.
		if (err instanceof AssetIntegrityError) {
			console.error(`[fetch-yt-dlp] Refusing to bake binaries: ${message}`);
			console.error(
				"[fetch-yt-dlp] Update the digests in scripts/yt-dlp-pin.mjs if this release was re-published on purpose.",
			);
			process.exit(1);
		}

		// Everything else — an unreachable GitHub, a timeout, a 5xx — still
		// must not break the deploy. The server downloads yt-dlp to /tmp on
		// first use, so this costs startup latency rather than availability.
		console.warn(`[fetch-yt-dlp] Could not bake binaries: ${message}`);
		console.warn(
			"[fetch-yt-dlp] Falling back to runtime download on first request.",
		);
		process.exit(0);
	}
}
