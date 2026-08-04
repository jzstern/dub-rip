import { randomBytes } from "node:crypto";
import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	mkdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
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
	BAKED_PLUGIN_DIR_NAME,
	BAKED_YTDLP_NAME,
	BGUTIL_PLUGIN_FILENAME,
	BGUTIL_PLUGIN_VERSION,
	BIN_DIR_NAME,
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
const BGUTIL_PLUGIN_URL = `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_PLUGIN_VERSION}/${BGUTIL_PLUGIN_FILENAME}`;

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

function getYtDlpBinaryName(): string {
	const os = platform();
	if (os === "darwin") return "yt-dlp_macos";
	return "yt-dlp_linux";
}

function getGitHubHeaders(): HeadersInit {
	const headers: HeadersInit = { Accept: "application/vnd.github.v3+json" };
	if (env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
	}
	return headers;
}

export async function downloadYtDlpBinary(destPath: string): Promise<void> {
	const binaryName = getYtDlpBinaryName();
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
		assets: Array<{ name: string; browser_download_url: string }>;
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

export async function ensureBgutilPlugin(): Promise<string> {
	if (existsSync(BGUTIL_PLUGIN_PATH)) {
		return BGUTIL_PLUGIN_DIR;
	}
	// Unlike the binary, this one is pinned everywhere: the plugin and the
	// bgutil-pot sidecar speak a versioned protocol, so a baked copy at the
	// pinned version is the same artifact the runtime would fetch.
	const bakedPlugin = resolveBakedPath(
		BAKED_PLUGIN_DIR_NAME,
		BGUTIL_PLUGIN_FILENAME,
	);
	if (bakedPlugin) {
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
			const res = await fetch(BGUTIL_PLUGIN_URL, {
				headers,
				signal: AbortSignal.timeout(BINARY_DOWNLOAD_TIMEOUT_MS),
			});
			if (!res.ok) {
				throw new Error(
					`bgutil plugin download failed: ${res.status} ${res.statusText}`,
				);
			}
			const buf = Buffer.from(await res.arrayBuffer());
			mkdirSync(BGUTIL_PLUGIN_DIR, { recursive: true });
			writeFileSync(BGUTIL_PLUGIN_PATH, buf);
			return BGUTIL_PLUGIN_DIR;
		} catch (err) {
			bgutilPluginPromise = null;
			Sentry.captureException(err, {
				tags: {
					service: "yt-dlp-binary",
					operation: "ensure-bgutil-plugin",
				},
			});
			throw err;
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
 * `player_client` is restricted to WebPO-capable clients on purpose. bgutil-pot
 * mints *WebPO* tokens, which only the web-family clients can use. yt-dlp's
 * `default` chain leads with `android_vr`, which takes a different token type
 * bgutil cannot produce, yet its audio formats often win `bestaudio` and their
 * media URLs then 403 from a datacenter IP.
 *
 * `fetch_pot=always` is what actually gets a token minted. Under yt-dlp's
 * default `auto` policy a PO token is fetched only when the client's policy
 * marks it required or recommended — and for all three clients above, the
 * *player* policy is `PlayerPoTokenPolicy(required=False)`. So the innertube
 * player request went out unauthenticated, and from a datacenter IP YouTube
 * answered it with "Sign in to confirm you're not a bot" while bgutil-pot sat
 * there healthy and never asked for anything. `always` overrides the policy and
 * fetches for the player context too. If the sidecar is unreachable yt-dlp
 * warns and continues token-less, so this stays a strict improvement over
 * `auto` rather than a new hard dependency.
 */
export const YOUTUBE_EXTRACTOR_ARG =
	"youtube:player_client=web_safari,mweb,tv;fetch_pot=always";

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
