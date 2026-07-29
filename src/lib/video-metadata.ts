import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Sentry from "@sentry/sveltekit";
import { retryWithBackoff } from "./retry";
import {
	buildBgutilPotArgs,
	buildJsRuntimeArgs,
	ensureYtDlpBinary,
} from "./yt-dlp-binary";
import { withYtDlpConcurrencyLimit } from "./yt-dlp-concurrency";
import { isRetryableYtDlpError } from "./yt-dlp-errors";

const execFilePromise = promisify(execFile);

const DETAILS_TIMEOUT = 15000;
const THUMBNAIL_TIMEOUT = 8000;

export interface VideoDetails {
	year?: number;
	genre?: string;
	album?: string;
	albumArtist?: string;
	composer?: string;
	track?: string;
	artist?: string;
	bpm?: number;
	duration?: number;
}

export interface ThumbnailImage {
	buffer: Buffer;
	mime: string;
}

interface YtDlpJson {
	upload_date?: string;
	release_date?: string;
	release_year?: number;
	categories?: string[];
	genre?: string;
	track?: string;
	artist?: string;
	album?: string;
	album_artist?: string;
	composer?: string;
	bpm?: number;
	duration?: number;
}

function parseYear(
	uploadDate: string | undefined,
	releaseDate: string | undefined,
	releaseYear: number | undefined,
): number | undefined {
	if (typeof releaseYear === "number" && releaseYear > 1900) {
		return releaseYear;
	}
	const source = releaseDate || uploadDate;
	if (!source) return undefined;
	const match = source.match(/^(\d{4})/);
	if (!match) return undefined;
	const year = Number.parseInt(match[1], 10);
	return Number.isFinite(year) && year > 1900 ? year : undefined;
}

function pickGenre(
	explicit: string | undefined,
	categories: string[] | undefined,
): string | undefined {
	if (explicit && explicit.trim()) return explicit.trim();
	if (categories && categories.length > 0 && categories[0]?.trim()) {
		return categories[0].trim();
	}
	return undefined;
}

async function fetchVideoDetailsOnce(
	videoUrl: string,
	timeout: number,
): Promise<VideoDetails> {
	const deadline = Date.now() + timeout;
	const remaining = () => Math.max(1, deadline - Date.now());

	const binaryPath = await ensureYtDlpBinary();
	if (Date.now() >= deadline) {
		throw new Error("yt-dlp binary initialization exceeded timeout");
	}
	const args = [
		"--dump-json",
		"--no-warnings",
		"--no-playlist",
		"--skip-download",
		...buildJsRuntimeArgs(),
		...(await buildBgutilPotArgs()),
		videoUrl,
	];
	const result = await withYtDlpConcurrencyLimit(() =>
		execFilePromise(binaryPath, args, {
			timeout: remaining(),
			maxBuffer: 10 * 1024 * 1024,
		}),
	);
	const info = JSON.parse(result.stdout) as YtDlpJson;

	return {
		year: parseYear(info.upload_date, info.release_date, info.release_year),
		genre: pickGenre(info.genre, info.categories),
		album: info.album?.trim() || undefined,
		albumArtist: info.album_artist?.trim() || undefined,
		composer: info.composer?.trim() || undefined,
		track: info.track?.trim() || undefined,
		artist: info.artist?.trim() || undefined,
		bpm: typeof info.bpm === "number" && info.bpm > 0 ? info.bpm : undefined,
		duration:
			typeof info.duration === "number" && info.duration > 0
				? Math.round(info.duration)
				: undefined,
	};
}

export async function fetchVideoDetails(
	videoUrl: string,
	timeout: number = DETAILS_TIMEOUT,
): Promise<VideoDetails | null> {
	try {
		return await retryWithBackoff(
			() => fetchVideoDetailsOnce(videoUrl, timeout),
			{
				isRetryable: (error) =>
					isRetryableYtDlpError(
						error instanceof Error ? error.message : String(error),
					),
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn("[video-metadata] fetchVideoDetails failed:", message);
		Sentry.captureException(
			error instanceof Error ? error : new Error(message),
			{
				tags: { service: "video-metadata", operation: "fetchVideoDetails" },
				extra: { videoUrl },
			},
		);
		return null;
	}
}

async function tryFetchImage(
	url: string,
	timeout: number,
): Promise<ThumbnailImage | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) return null;
		const contentType = response.headers.get("content-type") ?? "image/jpeg";
		const mime = contentType.split(";")[0]?.trim() || "image/jpeg";
		const arrayBuffer = await response.arrayBuffer();
		if (arrayBuffer.byteLength === 0) return null;
		return { buffer: Buffer.from(arrayBuffer), mime };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchThumbnailBuffer(
	videoId: string,
	oembedUrl?: string,
	timeout: number = THUMBNAIL_TIMEOUT,
): Promise<ThumbnailImage | null> {
	const deadline = Date.now() + timeout;
	const candidates = [
		`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
		`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
	];
	if (oembedUrl && !candidates.includes(oembedUrl)) {
		candidates.push(oembedUrl);
	}
	for (const url of candidates) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) return null;
		const image = await tryFetchImage(url, remaining);
		if (image) return image;
	}
	return null;
}

export interface ID3TagInput {
	trackTitle: string;
	videoTitle: string;
	artist: string;
	details: VideoDetails | null;
	image: ThumbnailImage | null;
}

export interface ID3Tags {
	title: string;
	artist: string;
	performerInfo: string;
	album: string;
	composer: string;
	genre?: string;
	year?: string;
	bpm?: string;
	image?: {
		mime: string;
		type: { id: number; name: string };
		description: string;
		imageBuffer: Buffer;
	};
}

export function buildID3Tags({
	trackTitle,
	videoTitle,
	artist,
	details,
	image,
}: ID3TagInput): ID3Tags {
	const title = (details?.track || trackTitle || videoTitle || "").trim();
	const finalArtist = (details?.artist || artist || "Unknown Artist").trim();
	const performerInfo = (
		details?.albumArtist ||
		finalArtist ||
		"Unknown Artist"
	).trim();
	const album = (details?.album || title || "Unknown Album").trim();
	const composer = (details?.composer || finalArtist || "").trim();

	const tags: ID3Tags = {
		title: title || "Unknown Title",
		artist: finalArtist,
		performerInfo,
		album,
		composer,
	};

	if (details?.genre) tags.genre = details.genre;
	if (typeof details?.year === "number") tags.year = String(details.year);
	if (typeof details?.bpm === "number")
		tags.bpm = String(Math.round(details.bpm));

	if (image) {
		tags.image = {
			mime: image.mime,
			type: { id: 3, name: "front cover" },
			description: "Cover",
			imageBuffer: image.buffer,
		};
	}

	return tags;
}
