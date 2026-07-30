#!/usr/bin/env node
import {
	chmodSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
const MIN_PLAUSIBLE_BINARY_BYTES = 1_000_000;

/**
 * @param {string} url
 * @param {string} destPath
 * @param {number} minBytes
 * @returns {Promise<number>}
 */
async function downloadTo(url, destPath, minBytes) {
	const res = await fetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
	}

	const bytes = Buffer.from(await res.arrayBuffer());
	if (bytes.byteLength < minBytes) {
		throw new Error(
			`GET ${url} returned ${bytes.byteLength} bytes, expected at least ${minBytes}`,
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

	return bytes.byteLength;
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
	const ytDlpBytes = await downloadTo(
		getYtDlpDownloadUrl(),
		ytDlpPath,
		MIN_PLAUSIBLE_BINARY_BYTES,
	);
	chmodSync(ytDlpPath, 0o755);
	console.log(
		`[fetch-yt-dlp] ${getYtDlpAssetName()} ${YTDLP_VERSION} → ${ytDlpPath} (${ytDlpBytes} bytes)`,
	);

	const pluginPath = join(pluginDir, BGUTIL_PLUGIN_FILENAME);
	const pluginBytes = await downloadTo(
		getBgutilPluginDownloadUrl(),
		pluginPath,
		1,
	);
	console.log(
		`[fetch-yt-dlp] bgutil plugin ${BGUTIL_PLUGIN_VERSION} → ${pluginPath} (${pluginBytes} bytes)`,
	);
}

const modulePath = fileURLToPath(import.meta.url);
const runFromCli =
	process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath;

if (runFromCli) {
	try {
		await fetchBakedArtifacts(resolve(dirname(modulePath), ".."));
	} catch (err) {
		// Never fail the build on this. The server still downloads yt-dlp to
		// /tmp on first use, so an unreachable GitHub costs startup latency,
		// not a broken deploy.
		console.warn(
			`[fetch-yt-dlp] Could not bake binaries: ${err instanceof Error ? err.message : String(err)}`,
		);
		console.warn(
			"[fetch-yt-dlp] Falling back to runtime download on first request.",
		);
		process.exit(0);
	}
}
