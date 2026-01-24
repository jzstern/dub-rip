import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";

/**
 * Platform support rationale:
 * - macOS: Local development
 * - Linux x64: Production (Railway) and CI
 *
 * Other platforms (Windows, ARM) are not supported because:
 * 1. Cobalt is the primary download method; yt-dlp is only a fallback
 * 2. Production runs on a fixed Linux x64 environment
 * 3. Adding complexity for unused platforms increases maintenance burden
 *
 * PR review bots flagged edge cases (Windows .exe extension, ARM64, ARMv7),
 * but these don't apply to our actual deployment context.
 */

const YTDLP_BINARY_PATH = join(tmpdir(), "yt-dlp");
const API_TIMEOUT_MS = 15_000;
const BINARY_DOWNLOAD_TIMEOUT_MS = 120_000;

let downloadPromise: Promise<string> | null = null;

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

export async function ensureYtDlpBinary(): Promise<string> {
	if (existsSync(YTDLP_BINARY_PATH)) {
		return YTDLP_BINARY_PATH;
	}

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

			try {
				renameSync(tempPath, YTDLP_BINARY_PATH);
			} catch (err) {
				if (existsSync(tempPath)) unlinkSync(tempPath);
				if (existsSync(YTDLP_BINARY_PATH)) {
					return YTDLP_BINARY_PATH;
				}
				const error = new Error("Failed to install yt-dlp binary");
				Sentry.captureException(error, {
					tags: { service: "yt-dlp-binary", operation: "install" },
					extra: {
						originalError: err instanceof Error ? err.message : String(err),
					},
				});
				throw error;
			}

			return YTDLP_BINARY_PATH;
		} finally {
			downloadPromise = null;
		}
	})();

	return downloadPromise;
}

export function getYtDlpBinaryPath(): string {
	return YTDLP_BINARY_PATH;
}
