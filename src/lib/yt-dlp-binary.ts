import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "$env/dynamic/private";

const API_TIMEOUT_MS = 15_000;
const BINARY_DOWNLOAD_TIMEOUT_MS = 120_000;

let downloadPromise: Promise<string> | null = null;

function getYtDlpBinaryName(): string {
	const os = platform();
	const architecture = arch();

	if (os === "darwin") return "yt-dlp_macos";
	if (os === "win32") return "yt-dlp.exe";
	if (os === "linux" && architecture === "arm64") return "yt-dlp_linux_aarch64";
	return "yt-dlp_linux";
}

function getYtDlpStoragePath(): string {
	const os = platform();
	const baseName = os === "win32" ? "yt-dlp.exe" : "yt-dlp";
	return join(tmpdir(), baseName);
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
		throw new Error(
			`Failed to fetch yt-dlp release info: ${releaseRes.status} ${releaseRes.statusText}${body ? ` - ${body}` : ""}`,
		);
	}

	const release = (await releaseRes.json()) as {
		assets: Array<{ name: string; browser_download_url: string }>;
	};

	const asset = release.assets.find((a) => a.name === binaryName);
	if (!asset) {
		throw new Error(`Could not find ${binaryName} in yt-dlp release assets`);
	}

	console.log(`Downloading ${binaryName} from ${asset.browser_download_url}`);

	const binaryRes = await fetch(asset.browser_download_url, {
		signal: AbortSignal.timeout(BINARY_DOWNLOAD_TIMEOUT_MS),
	});

	if (!binaryRes.ok) {
		const body = await binaryRes.text().catch(() => "");
		throw new Error(
			`Failed to download yt-dlp binary: ${binaryRes.status} ${binaryRes.statusText}${body ? ` - ${body}` : ""}`,
		);
	}

	const buffer = Buffer.from(await binaryRes.arrayBuffer());
	writeFileSync(destPath, buffer);
	chmodSync(destPath, 0o755);
}

export async function ensureYtDlpBinary(): Promise<string> {
	const binaryPath = getYtDlpStoragePath();

	if (existsSync(binaryPath)) {
		return binaryPath;
	}

	if (downloadPromise) {
		return downloadPromise;
	}

	downloadPromise = (async () => {
		try {
			if (existsSync(binaryPath)) {
				return binaryPath;
			}

			const tempPath = `${binaryPath}.${randomBytes(8).toString("hex")}.tmp`;

			console.log("Downloading yt-dlp binary...");
			await downloadYtDlpBinary(tempPath);

			try {
				renameSync(tempPath, binaryPath);
			} catch {
				if (existsSync(tempPath)) unlinkSync(tempPath);
				if (existsSync(binaryPath)) {
					return binaryPath;
				}
				throw new Error("Failed to install yt-dlp binary");
			}

			return binaryPath;
		} finally {
			downloadPromise = null;
		}
	})();

	return downloadPromise;
}

export function getYtDlpBinaryPath(): string {
	return getYtDlpStoragePath();
}
