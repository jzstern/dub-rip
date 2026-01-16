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

const YTDLP_BINARY_PATH = join(tmpdir(), "yt-dlp");
let isDownloading = false;

function getYtDlpBinaryName(): string {
	const os = platform();
	if (os === "darwin") return "yt-dlp_macos";
	if (os === "win32") return "yt-dlp.exe";
	return "yt-dlp";
}

export async function downloadYtDlpBinary(destPath: string): Promise<void> {
	const binaryName = getYtDlpBinaryName();
	const releaseUrl =
		"https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

	const releaseRes = await fetch(releaseUrl, {
		headers: { Accept: "application/vnd.github.v3+json" },
	});

	if (!releaseRes.ok) {
		throw new Error(
			`Failed to fetch yt-dlp release info: ${releaseRes.status}`,
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

	const binaryRes = await fetch(asset.browser_download_url);
	if (!binaryRes.ok) {
		throw new Error(`Failed to download yt-dlp binary: ${binaryRes.status}`);
	}

	const buffer = Buffer.from(await binaryRes.arrayBuffer());
	writeFileSync(destPath, buffer);
	chmodSync(destPath, 0o755);
}

export async function ensureYtDlpBinary(): Promise<string> {
	if (existsSync(YTDLP_BINARY_PATH)) {
		return YTDLP_BINARY_PATH;
	}

	if (isDownloading) {
		while (isDownloading) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if (existsSync(YTDLP_BINARY_PATH)) {
			return YTDLP_BINARY_PATH;
		}
	}

	isDownloading = true;

	try {
		if (existsSync(YTDLP_BINARY_PATH)) {
			return YTDLP_BINARY_PATH;
		}

		const tempPath = `${YTDLP_BINARY_PATH}.${randomBytes(8).toString("hex")}.tmp`;

		console.log("Downloading yt-dlp binary...");
		await downloadYtDlpBinary(tempPath);

		try {
			renameSync(tempPath, YTDLP_BINARY_PATH);
		} catch {
			if (existsSync(tempPath)) unlinkSync(tempPath);
			if (existsSync(YTDLP_BINARY_PATH)) {
				return YTDLP_BINARY_PATH;
			}
			throw new Error("Failed to install yt-dlp binary");
		}

		return YTDLP_BINARY_PATH;
	} finally {
		isDownloading = false;
	}
}

export function getYtDlpBinaryPath(): string {
	return YTDLP_BINARY_PATH;
}
