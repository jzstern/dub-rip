import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFilePromise = promisify(execFile);

const ITUNES_TIMEOUT = 6000;
const THUMBNAIL_TIMEOUT = 6000;
const ARTWORK_SIZE = 600;

export type CoverArtSource = "itunes" | "thumbnail";

export interface CoverArt {
	imageBuffer: Buffer;
	source: CoverArtSource;
}

interface ResolveCoverArtInput {
	artist: string;
	title: string;
	thumbnailUrl: string;
}

interface ITunesResult {
	artworkUrl100?: string;
}

interface ITunesResponse {
	results?: ITunesResult[];
}

async function fetchBufferWithTimeout(
	url: string,
	timeout: number,
): Promise<Buffer | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) return null;
		const arrayBuffer = await response.arrayBuffer();
		if (arrayBuffer.byteLength === 0) return null;
		return Buffer.from(arrayBuffer);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchOfficialArtwork(
	artist: string,
	title: string,
): Promise<Buffer | null> {
	const term = `${artist} ${title}`.trim();
	if (!term) return null;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ITUNES_TIMEOUT);
	try {
		const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
			term,
		)}&entity=song&limit=1`;
		const response = await fetch(searchUrl, { signal: controller.signal });
		if (!response.ok) return null;

		const data = (await response.json()) as ITunesResponse;
		const artworkUrl100 = data.results?.[0]?.artworkUrl100;
		if (!artworkUrl100) return null;

		const highResUrl = artworkUrl100.replace(
			"100x100bb",
			`${ARTWORK_SIZE}x${ARTWORK_SIZE}bb`,
		);
		return await fetchBufferWithTimeout(highResUrl, ITUNES_TIMEOUT);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchThumbnailBuffer(
	url: string,
): Promise<Buffer | null> {
	return fetchBufferWithTimeout(url, THUMBNAIL_TIMEOUT);
}

export async function squareCropToBuffer(input: Buffer): Promise<Buffer> {
	const ffmpegPath = (require("@ffmpeg-installer/ffmpeg") as { path: string })
		.path;
	const { readFile, writeFile, unlink } = await import("node:fs/promises");

	const id = randomBytes(16).toString("hex");
	const inputPath = join(tmpdir(), `artwork-${id}-in.jpg`);
	const outputPath = join(tmpdir(), `artwork-${id}-out.jpg`);

	try {
		await writeFile(inputPath, input);
		await execFilePromise(ffmpegPath, [
			"-y",
			"-i",
			inputPath,
			"-vf",
			`crop='min(iw,ih)':'min(iw,ih)',scale=${ARTWORK_SIZE}:${ARTWORK_SIZE}`,
			"-f",
			"mjpeg",
			outputPath,
		]);
		return await readFile(outputPath);
	} finally {
		await unlink(inputPath).catch(() => {});
		await unlink(outputPath).catch(() => {});
	}
}

export function youTubeThumbnailUrl(videoId: string): string {
	return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export interface AlbumArtImage {
	buffer: Buffer;
	mime: string;
}

interface ResolveAlbumArtImageInput {
	artist: string;
	title: string;
	videoId: string;
	fallback?: AlbumArtImage | null;
}

export async function resolveAlbumArtImage({
	artist,
	title,
	videoId,
	fallback,
}: ResolveAlbumArtImageInput): Promise<AlbumArtImage | null> {
	try {
		const cover = await resolveCoverArt({
			artist,
			title,
			thumbnailUrl: youTubeThumbnailUrl(videoId),
		});
		if (cover) {
			console.log(`[artwork] Using cover art from: ${cover.source}`);
			return { buffer: cover.imageBuffer, mime: "image/jpeg" };
		}
		console.log("[artwork] No cover art resolved; using fallback thumbnail");
		return fallback ?? null;
	} catch (err) {
		console.error("[artwork] Cover art resolution failed:", err);
		return fallback ?? null;
	}
}

export async function resolveCoverArt({
	artist,
	title,
	thumbnailUrl,
}: ResolveCoverArtInput): Promise<CoverArt | null> {
	try {
		const official = await fetchOfficialArtwork(artist, title);
		if (official) {
			return { imageBuffer: official, source: "itunes" };
		}

		const thumbnail = await fetchThumbnailBuffer(thumbnailUrl);
		if (!thumbnail) return null;

		const cropped = await squareCropToBuffer(thumbnail);
		return { imageBuffer: cropped, source: "thumbnail" };
	} catch {
		return null;
	}
}
