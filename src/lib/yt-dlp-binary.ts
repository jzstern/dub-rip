import { createHash, randomBytes } from "node:crypto";
import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
/**
 * The pins live outside `$lib` because the build step that bakes them runs as
 * plain `node`/`bun` and cannot import this module — `$env/dynamic/private`
 * only resolves inside the SvelteKit graph. The pin module is side-effect-free
 * on purpose: importing the build script itself would pull its fs, network and
 * CLI entrypoint into the server bundle.
 */
import {
	ASSET_SHA256,
	BAKED_PLUGIN_DIR_NAME,
	BAKED_YTDLP_NAME,
	BGUTIL_PLUGIN_FILENAME,
	BGUTIL_PLUGIN_REPO,
	BIN_DIR_NAME,
	getBgutilPluginDownloadUrl,
	getReleaseAssetPrefix,
	getYtDlpAssetName,
	YTDLP_REPO,
	YTDLP_VERSION,
} from "../../scripts/yt-dlp-pin.mjs";

/**
 * Platform support rationale:
 * - macOS: Local development
 * - Linux x64: Production (Railway) and CI
 *
 * Other platforms (Windows, ARM) are not supported because:
 * 1. Production runs on a fixed Linux x64 environment
 * 2. Adding complexity for unused platforms increases maintenance burden
 *
 * PR review bots flagged edge cases (Windows .exe extension, ARM64, ARMv7),
 * but these don't apply to our actual deployment context.
 */

const YTDLP_BINARY_PATH = join(tmpdir(), "yt-dlp");
const API_TIMEOUT_MS = 15_000;
const BINARY_DOWNLOAD_TIMEOUT_MS = 120_000;
const BINARY_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

let lastRefreshAttemptAt = 0;

const BGUTIL_PLUGIN_DIR = join(tmpdir(), BAKED_PLUGIN_DIR_NAME);
const BGUTIL_PLUGIN_PATH = join(BGUTIL_PLUGIN_DIR, BGUTIL_PLUGIN_FILENAME);

const MAX_ROOT_WALK_DEPTH = 6;

let bgutilPluginPromise: Promise<string> | null = null;

let downloadPromise: Promise<string> | null = null;

/**
 * Directories that might hold the `bin/` baked at build time.
 *
 * `node build/index.js` runs from the project root, so cwd normally wins. The
 * walk up from this module covers the cases cwd doesn't: a process started from
 * elsewhere, and the bundled server chunk whose nesting depth under `build/` is
 * a Rollup implementation detail we shouldn't hard-code.
 */
function* candidateRoots(): Generator<string> {
	yield process.cwd();

	let dir = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < MAX_ROOT_WALK_DEPTH; depth++) {
		yield dir;
		const parent = dirname(dir);
		if (parent === dir) return;
		dir = parent;
	}
}

let loggedBakedLookup = false;

/**
 * Whether the bake survived into the deploy image is only answerable from
 * logs, and it is a silent no-op if it didn't — so say which path was taken,
 * once, rather than on every request.
 */
function logBakedLookupOnce(message: string): void {
	if (loggedBakedLookup) return;
	loggedBakedLookup = true;
	console.log(message);
}

function resolveBakedPath(...segments: string[]): string | null {
	for (const root of candidateRoots()) {
		const candidate = join(root, BIN_DIR_NAME, ...segments);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * A baked binary that survived the image but lost its executable bit would
 * fail at spawn time, by which point the /tmp fallback has already been
 * skipped. Checking here keeps that failure recoverable.
 */
function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function getGitHubHeaders(): HeadersInit {
	const headers: HeadersInit = { Accept: "application/vnd.github.v3+json" };
	if (env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
	}
	return headers;
}

/**
 * Records an integrity failure and returns the error to throw.
 *
 * These are reported here rather than only from the caller's handler because
 * the two call paths report differently: a background refresh wraps its own
 * failures, but the cold-start download propagates straight out of
 * `ensureYtDlpBinary` to the request. Tagging them at the point of rejection
 * also keeps "the bytes were wrong" distinguishable from "GitHub was down",
 * which is the whole distinction these checks exist to draw.
 */
function integrityError(
	message: string,
	extra: Record<string, unknown>,
): Error {
	const error = new Error(message);
	Sentry.captureException(error, {
		tags: { service: "yt-dlp-binary", operation: "verify-download" },
		extra,
	});
	return error;
}

/**
 * Rejects a download URL that is not a release asset of `repo`.
 *
 * The URL this guards comes out of the releases JSON, so it is only as
 * trustworthy as that response — and it is about to be fetched, written and
 * marked executable.
 *
 * The repository is checked, not merely the host, because on the common path
 * the digest the bytes are held to comes out of that same response (see
 * `resolveExpectedDigest`). A response naming some other account's asset
 * together with that asset's true digest would satisfy a host-only check and
 * then verify against itself. Requiring the path as well means the bytes have
 * to be published under this project's own releases.
 *
 * Comparing the parsed `pathname` rather than the raw string is what makes the
 * prefix test safe: the WHATWG parser has already resolved `..` segments and
 * percent-encoded traversal by that point.
 */
function assertGitHubReleaseUrl(
	url: string,
	repo: string,
	assetName: string,
): void {
	const prefix = getReleaseAssetPrefix(repo);
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw integrityError(
			`Refusing to download ${assetName}: ${url} is not a valid URL`,
			{ assetName, url },
		);
	}
	const normalized = `${parsed.origin}${parsed.pathname}`;
	if (parsed.protocol !== "https:" || !normalized.startsWith(prefix)) {
		throw integrityError(
			`Refusing to download ${assetName} from ${normalized}: expected an asset under ${prefix}`,
			{ assetName, url, normalized, prefix },
		);
	}
}

/** GitHub reports release asset digests as `sha256:<64 hex chars>`. */
function parseGitHubAssetDigest(digest: unknown): string | null {
	if (typeof digest !== "string") return null;
	const match = digest.match(/^sha256:([0-9a-f]{64})$/);
	return match ? match[1] : null;
}

/**
 * The digest the fetched bytes must hash to.
 *
 * `releases/latest` is a moving target on purpose (see `ensureYtDlpBinary`), so
 * most of the time there is no in-repo digest for whatever it resolves to
 * today — `ASSET_SHA256` can only speak for the pinned tag. GitHub's own
 * `digest` field covers the rest: it arrives over TLS from api.github.com in
 * the same response as the download URL, so holding the bytes to it is what
 * makes following that URL safe.
 *
 * When `latest` has caught up to the pin both are available, and they have to
 * agree. A release tag can be re-pointed at different bytes after the fact, and
 * this comparison is the only place in the system where that would ever show.
 */
function resolveExpectedDigest(
	assetName: string,
	tagName: unknown,
	reportedDigest: string | null,
): string {
	const pinned =
		tagName === YTDLP_VERSION ? ASSET_SHA256[assetName] : undefined;

	if (pinned && reportedDigest && pinned !== reportedDigest) {
		throw integrityError(
			`GitHub reports a different ${assetName} for ${YTDLP_VERSION} than the digest pinned in scripts/yt-dlp-pin.mjs`,
			{ assetName, tagName, pinned, reportedDigest },
		);
	}

	const expected = pinned ?? reportedDigest;
	if (!expected) {
		throw integrityError(
			`No digest available to verify ${assetName}; refusing to install an unverified binary`,
			{ assetName, tagName },
		);
	}
	return expected;
}

function assertDigestMatches(
	bytes: Buffer,
	expected: string,
	assetName: string,
): void {
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual === expected) return;
	throw integrityError(
		`Digest mismatch for ${assetName}: expected ${expected}, got ${actual} (${bytes.byteLength} bytes)`,
		{ assetName, expected, actual, byteLength: bytes.byteLength },
	);
}

export async function downloadYtDlpBinary(destPath: string): Promise<void> {
	const binaryName = getYtDlpAssetName();
	const releaseUrl =
		"https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

	const releaseRes = await fetch(releaseUrl, {
		headers: getGitHubHeaders(),
		signal: AbortSignal.timeout(API_TIMEOUT_MS),
	});

	if (!releaseRes.ok) {
		const body = await releaseRes.text().catch(() => "");
		const error = new Error(
			`Failed to fetch yt-dlp release info: ${releaseRes.status} ${releaseRes.statusText}${body ? ` - ${body}` : ""}`,
		);
		Sentry.captureException(error, {
			tags: { service: "yt-dlp-binary", operation: "fetch-release" },
			extra: { status: releaseRes.status },
		});
		throw error;
	}

	const release = (await releaseRes.json()) as {
		tag_name?: string;
		assets: Array<{
			name: string;
			browser_download_url: string;
			digest?: string | null;
		}>;
	};

	const asset = release.assets.find((a) => a.name === binaryName);
	if (!asset) {
		const error = new Error(
			`Could not find ${binaryName} in yt-dlp release assets`,
		);
		Sentry.captureException(error, {
			tags: { service: "yt-dlp-binary", operation: "find-asset" },
			extra: { binaryName, availableAssets: release.assets.map((a) => a.name) },
		});
		throw error;
	}

	// Both checks run before the fetch: a binary we could not verify is one we
	// should not spend 40MB discovering we have to throw away.
	assertGitHubReleaseUrl(asset.browser_download_url, YTDLP_REPO, binaryName);
	const expectedDigest = resolveExpectedDigest(
		binaryName,
		release.tag_name,
		parseGitHubAssetDigest(asset.digest),
	);

	console.log(`Downloading ${binaryName} from ${asset.browser_download_url}`);

	const binaryRes = await fetch(asset.browser_download_url, {
		signal: AbortSignal.timeout(BINARY_DOWNLOAD_TIMEOUT_MS),
	});

	if (!binaryRes.ok) {
		const body = await binaryRes.text().catch(() => "");
		const error = new Error(
			`Failed to download yt-dlp binary: ${binaryRes.status} ${binaryRes.statusText}${body ? ` - ${body}` : ""}`,
		);
		Sentry.captureException(error, {
			tags: { service: "yt-dlp-binary", operation: "download" },
			extra: { status: binaryRes.status, binaryName },
		});
		throw error;
	}

	const buffer = Buffer.from(await binaryRes.arrayBuffer());
	assertDigestMatches(buffer, expectedDigest, binaryName);
	writeFileSync(destPath, buffer);
	chmodSync(destPath, 0o755);
}

function isBinaryStale(path: string): boolean {
	try {
		const stats = statSync(path);
		return Date.now() - stats.mtimeMs > BINARY_REFRESH_TTL_MS;
	} catch {
		return true;
	}
}

function installBinary(tempPath: string): string {
	try {
		renameSync(tempPath, YTDLP_BINARY_PATH);
	} catch (err) {
		if (existsSync(tempPath)) unlinkSync(tempPath);
		if (existsSync(YTDLP_BINARY_PATH)) {
			return YTDLP_BINARY_PATH;
		}
		const originalError = err instanceof Error ? err : new Error(String(err));
		const error = new Error("Failed to install yt-dlp binary", {
			cause: originalError,
		});
		Sentry.captureException(error, {
			tags: { service: "yt-dlp-binary", operation: "install" },
		});
		throw error;
	}
	return YTDLP_BINARY_PATH;
}

/**
 * Stale-while-revalidate refresh: callers keep getting the cached binary
 * with zero added latency while a replacement downloads in the background.
 * Blocking on the refresh would make one unlucky user per TTL window absorb
 * the full GitHub API + binary download time — and if GitHub is down or
 * rate-limiting, every request would absorb the failure timeout until a
 * refresh succeeded. The cooldown bounds how often failed refreshes are
 * re-attempted for the same reason.
 */
function refreshBinaryInBackground(): void {
	if (downloadPromise) return;
	if (Date.now() - lastRefreshAttemptAt < REFRESH_RETRY_COOLDOWN_MS) return;
	lastRefreshAttemptAt = Date.now();

	downloadPromise = (async () => {
		const tempPath = `${YTDLP_BINARY_PATH}.${randomBytes(8).toString("hex")}.tmp`;
		try {
			console.log("Refreshing yt-dlp binary in the background...");
			await downloadYtDlpBinary(tempPath);
			return installBinary(tempPath);
		} catch (err) {
			console.warn(
				"yt-dlp binary refresh failed; continuing with the cached binary:",
				err,
			);
			Sentry.captureException(err, {
				tags: { service: "yt-dlp-binary", operation: "refresh-fallback" },
			});
			if (existsSync(tempPath)) unlinkSync(tempPath);
			return YTDLP_BINARY_PATH;
		} finally {
			downloadPromise = null;
		}
	})();
}

/**
 * Returns the cached yt-dlp binary path, downloading it first if missing.
 * yt-dlp fetches "latest" only at download time — without a TTL-based
 * refresh, a binary cached at process start (or on a long-lived instance)
 * would never pick up upstream fixes for YouTube's ever-changing extraction.
 * A stale binary is refreshed in the background (see
 * `refreshBinaryInBackground`); only the very first download (no cached
 * binary at all) blocks the caller and propagates its error, since there's
 * nothing to fall back to.
 */
export async function ensureYtDlpBinary(): Promise<string> {
	if (existsSync(YTDLP_BINARY_PATH)) {
		if (isBinaryStale(YTDLP_BINARY_PATH)) {
			refreshBinaryInBackground();
		}
		return YTDLP_BINARY_PATH;
	}

	// A container with an empty /tmp would otherwise block its very first
	// download on a ~40MB fetch. In practice /tmp survives app-sleep wakes, so
	// this branch runs on the first start of each deployment rather than every
	// cold start — still in front of that deployment's first user.
	//
	// The baked binary is a pinned floor, never a ceiling: its mtime is the
	// bake time, so the same TTL that governs /tmp reads as "how old is this
	// image" here, and an aged image still refreshes into /tmp, after which
	// /tmp wins above. Refreshing unconditionally instead spent that first
	// request on re-fetching bytes identical to the pin already on disk.
	const bakedBinary = resolveBakedPath(BAKED_YTDLP_NAME);
	if (bakedBinary && isExecutable(bakedBinary)) {
		logBakedLookupOnce(`Using baked yt-dlp binary at ${bakedBinary}`);
		if (isBinaryStale(bakedBinary)) {
			refreshBinaryInBackground();
		}
		return bakedBinary;
	}
	logBakedLookupOnce(
		bakedBinary
			? `Baked yt-dlp binary at ${bakedBinary} is not executable; downloading to /tmp`
			: "No baked yt-dlp binary found; downloading to /tmp",
	);

	if (downloadPromise) {
		return downloadPromise;
	}

	downloadPromise = (async () => {
		try {
			if (existsSync(YTDLP_BINARY_PATH)) {
				return YTDLP_BINARY_PATH;
			}

			const tempPath = `${YTDLP_BINARY_PATH}.${randomBytes(8).toString("hex")}.tmp`;
			console.log("Downloading yt-dlp binary...");
			await downloadYtDlpBinary(tempPath);
			return installBinary(tempPath);
		} finally {
			downloadPromise = null;
		}
	})();

	return downloadPromise;
}

export function getYtDlpBinaryPath(): string {
	return YTDLP_BINARY_PATH;
}

/**
 * Whether the plugin zip at `path` is the pinned artifact.
 *
 * Existence cannot stand in for this, for the reason `readIfDigestMatches`
 * gives on the build side: a file sitting at the expected path is not evidence
 * it holds the expected bytes. Unlike the binary — whose expected digest
 * depends on whichever release `latest` resolves to — the plugin has one fixed
 * expected digest that covers every source of it, and the zip is ~8KB, so
 * re-hashing what is already on disk costs nothing next to handing yt-dlp a
 * plugin nobody checked.
 */
function pluginZipMatchesPin(path: string, expectedDigest: string): boolean {
	try {
		const actual = createHash("sha256")
			.update(readFileSync(path))
			.digest("hex");
		return actual === expectedDigest;
	} catch {
		return false;
	}
}

export async function ensureBgutilPlugin(): Promise<string> {
	// This asset's version never moves at runtime — the plugin and the
	// bgutil-pot sidecar speak a versioned protocol — so one pinned digest is
	// the right expectation for every copy of it, downloaded or baked.
	const expectedDigest = ASSET_SHA256[BGUTIL_PLUGIN_FILENAME];
	if (!expectedDigest) {
		throw integrityError(
			`No pinned SHA-256 recorded for ${BGUTIL_PLUGIN_FILENAME}; bump ASSET_SHA256 alongside BGUTIL_PLUGIN_VERSION`,
			{ assetName: BGUTIL_PLUGIN_FILENAME },
		);
	}

	const url = getBgutilPluginDownloadUrl();
	assertGitHubReleaseUrl(url, BGUTIL_PLUGIN_REPO, BGUTIL_PLUGIN_FILENAME);

	if (
		existsSync(BGUTIL_PLUGIN_PATH) &&
		pluginZipMatchesPin(BGUTIL_PLUGIN_PATH, expectedDigest)
	) {
		return BGUTIL_PLUGIN_DIR;
	}
	const bakedPlugin = resolveBakedPath(
		BAKED_PLUGIN_DIR_NAME,
		BGUTIL_PLUGIN_FILENAME,
	);
	if (bakedPlugin && pluginZipMatchesPin(bakedPlugin, expectedDigest)) {
		return dirname(bakedPlugin);
	}
	if (bgutilPluginPromise) {
		return bgutilPluginPromise;
	}
	bgutilPluginPromise = (async (): Promise<string> => {
		try {
			const headers: HeadersInit = {};
			if (env.GITHUB_TOKEN) {
				headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
			}
			const res = await fetch(url, {
				headers,
				signal: AbortSignal.timeout(BINARY_DOWNLOAD_TIMEOUT_MS),
			});
			if (!res.ok) {
				throw new Error(
					`bgutil plugin download failed: ${res.status} ${res.statusText}`,
				);
			}
			const buf = Buffer.from(await res.arrayBuffer());
			assertDigestMatches(buf, expectedDigest, BGUTIL_PLUGIN_FILENAME);

			// Write-then-rename so a partial zip is never visible at the final
			// path: yt-dlp reads this directory directly, and a truncated plugin
			// fails in ways that look like the sidecar misbehaving.
			mkdirSync(BGUTIL_PLUGIN_DIR, { recursive: true });
			const tempPath = `${BGUTIL_PLUGIN_PATH}.${randomBytes(8).toString("hex")}.tmp`;
			try {
				writeFileSync(tempPath, buf);
				renameSync(tempPath, BGUTIL_PLUGIN_PATH);
			} catch (err) {
				if (existsSync(tempPath)) unlinkSync(tempPath);
				throw err;
			}
			return BGUTIL_PLUGIN_DIR;
		} catch (err) {
			Sentry.captureException(err, {
				tags: {
					service: "yt-dlp-binary",
					operation: "ensure-bgutil-plugin",
				},
			});
			throw err;
		} finally {
			// Cleared on success as well as failure: this is an in-flight dedup
			// handle, never a memo. Leaving a settled promise here would let a
			// later call be answered from it — handing back a /tmp copy that had
			// just failed the digest check above, which is the one case that
			// check exists for. What a later call may skip the download on is
			// `pluginZipMatchesPin`, which re-reads the bytes.
			bgutilPluginPromise = null;
		}
	})();
	return bgutilPluginPromise;
}

const JS_RUNTIME_NAMES = ["node", "bun", "deno"] as const;

/**
 * Builds the `--js-runtimes` args yt-dlp needs to solve YouTube's JS challenges.
 *
 * yt-dlp enables **only Deno** by default. Our Railway image ships Node (it runs
 * the app) but no Deno, so yt-dlp reports `JS runtimes: none` and cannot solve
 * the `n` challenge — every web-family client then yields "Only images are
 * available for download" and the download fails with "Requested format is not
 * available". Pointing yt-dlp at the interpreter already running this process
 * fixes that without shipping another binary.
 */
export function buildJsRuntimeArgs(): string[] {
	const runtime = JS_RUNTIME_NAMES.find((name) =>
		basename(process.execPath).startsWith(name),
	);
	return runtime
		? ["--js-runtimes", `${runtime}:${process.execPath}`]
		: ["--js-runtimes", "node"];
}

/**
 * The `youtube:` extractor args every yt-dlp invocation here must carry.
 *
 * Shared rather than written out per call site because the two halves only work
 * together, and a call site that drifts on either one fails in a way that looks
 * like YouTube being flaky rather than like a bug.
 *
 * `player_client` follows yt-dlp's own defaults (`visionos,web` at the
 * 2026.08.19 pin) rather than pinning an explicit WebPO-only list. It used to
 * pin `web_safari,mweb,tv`, because the chain then led with `android_vr`, whose
 * formats win `bestaudio` while taking a token type bgutil cannot mint. On
 * 2026-09-14 YouTube started bot-checking all three of those clients from this
 * deployment — every player response came back titleless and refused, on a
 * release that had been unchanged for 41 days. The explicit list had turned
 * into the liability it was written to prevent.
 *
 * `fetch_pot=always` stays, and is neither redundant nor a tuning knob. Under
 * `auto` a token is minted only when the client's own policy demands one, and
 * `WEB` declares the *player* token optional — so the innertube player request
 * goes out bare, YouTube bot-checks it from a datacenter IP, and bgutil-pot sits
 * healthy having never been asked for anything. It is simply inert for
 * `visionos`: `VISIONOS` is absent from `WEBPO_CLIENTS` in
 * `youtube/pot/utils.py`, so no WebPO token is fetched for it either way.
 *
 * If `visionos` formats start winning `bestaudio` and 403ing on the media fetch
 * — the hazard the old pin guarded against — drop that one client with
 * `player_client=default,-visionos` rather than restoring the burned list.
 */
export const YOUTUBE_EXTRACTOR_ARG =
	"youtube:player_client=default;fetch_pot=always";

/**
 * Builds the bgutil-pot PO-token yt-dlp args when BGUTIL_POT_URL is configured.
 *
 * YouTube's bot-check blocks many videos requested from datacenter IPs unless a
 * PO token accompanies the request. The main download path attaches these args;
 * read-only metadata calls (details, duration) must do the same or they 500 on
 * the same videos that download fine. Returns [] when the URL is unset or the
 * plugin can't be ensured, so callers degrade gracefully to a plain call.
 */
export async function buildBgutilPotArgs(): Promise<string[]> {
	if (!env.BGUTIL_POT_URL) return [];
	try {
		const pluginDir = await ensureBgutilPlugin();
		return [
			"--plugin-dirs",
			pluginDir,
			"--extractor-args",
			YOUTUBE_EXTRACTOR_ARG,
			"--extractor-args",
			`youtubepot-bgutilhttp:base_url=${env.BGUTIL_POT_URL}`,
		];
	} catch (err) {
		Sentry.captureException(err, {
			tags: { service: "yt-dlp-binary", operation: "build-bgutil-pot-args" },
		});
		return [];
	}
}
