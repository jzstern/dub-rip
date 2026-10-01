import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Sentry from "@sentry/sveltekit";
import type { CanonicalMetadata } from "./metadata/catalog/catalog-candidate";
import { cleanUploadTitle } from "./metadata/clean-upload-title";
import { extractRemixer, resolveLabel } from "./metadata/credits";
import { retryWithBackoff } from "./retry";
import {
	buildBgutilPotArgs,
	buildJsRuntimeArgs,
	ensureYtDlpBinary,
} from "./yt-dlp-binary";
import {
	withYtDlpConcurrencyLimit,
	YtDlpQueueFullError,
} from "./yt-dlp-concurrency";
import { classifyYtDlpError, isRetryableYtDlpError } from "./yt-dlp-errors";

const execFilePromise = promisify(execFile);

const DETAILS_TIMEOUT = 15000;
const THUMBNAIL_TIMEOUT = 8000;

export interface VideoDetails {
	title?: string;
	uploader?: string;
	year?: number;
	genre?: string;
	album?: string;
	albumArtist?: string;
	composer?: string;
	track?: string;
	artist?: string;
	bpm?: number;
	duration?: number;
	/** Record label: SoundCloud's `label_name`, or a YouTube Music description's ℗ line. */
	label?: string;
	isrc?: string;
}

export interface ThumbnailImage {
	buffer: Buffer;
	mime: string;
}

interface YtDlpJson {
	title?: string;
	uploader?: string;
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
	description?: string;
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

const PHONOGRAM_LINE = /^℗\s*(?:\d{4}\s+)?(.+)$/m;
const PROVIDED_TO_YOUTUBE_BY = /^Provided to YouTube by (.+)$/m;

/**
 * YouTube Music's auto-generated ("… - Topic") uploads carry the label in the
 * description. The ℗ line names the imprint and "Provided to YouTube by" the
 * distributor, so the ℗ line wins.
 */
function labelFromDescription(
	description: string | undefined,
): string | undefined {
	if (!description) return undefined;
	const label =
		description.match(PHONOGRAM_LINE)?.[1] ??
		description.match(PROVIDED_TO_YOUTUBE_BY)?.[1];
	return label?.trim() || undefined;
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
		"--no-playlist",
		"--skip-download",
		// `--no-warnings` used to sit here and cost us a diagnosis: when a PO
		// token isn't minted, yt-dlp says so *only* as a warning, and the ERROR
		// line that survived into Sentry was the downstream bot-check with no
		// hint as to why. execFile discards stderr on success and folds it into
		// the rejection on failure, so keeping warnings is free until something
		// breaks and self-documenting when it does. `--no-update` then drops the
		// one warning that is never actionable here — the binary is pinned, so
		// "your version is older than 90 days" is expected, and the download path
		// suppresses it for the same reason.
		"--no-update",
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
		title: info.title?.trim() || undefined,
		uploader: info.uploader?.trim() || undefined,
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
		label: labelFromDescription(info.description),
	};
}

/**
 * Applies the same reporting policy as the download route's
 * `reportDownloadFailure`, because this function fails on exactly the same
 * yt-dlp errors and was reporting all of them as uncategorized `error`s.
 *
 * Two consequences, both seen in production. A private or age-restricted video
 * — normal operation — filed a full issue from the preview path. And a download
 * calls this through `getVideoDetails` before running yt-dlp itself, so one
 * bot-check surfaced twice: an `error` here and a `warning` from the route,
 * as two separate Sentry issues for a single incident.
 */
function reportDetailsFailure(
	error: Error,
	message: string,
	videoUrl: string,
): void {
	if (error instanceof YtDlpQueueFullError) {
		Sentry.addBreadcrumb({
			category: "video-metadata",
			level: "info",
			message: "Details extraction rejected: downloader queue is full",
			data: { videoUrl },
		});
		return;
	}

	const classified = classifyYtDlpError(message);

	if (classified.category === "user") {
		Sentry.addBreadcrumb({
			category: "video-metadata",
			level: "info",
			message: `Details extraction rejected: ${classified.message}`,
			data: { videoUrl },
		});
		return;
	}

	Sentry.captureException(error, {
		level: classified.category === "transient" ? "warning" : "error",
		tags: {
			service: "video-metadata",
			operation: "fetchVideoDetails",
			category: classified.category,
		},
		extra: { videoUrl },
	});
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
		reportDetailsFailure(
			error instanceof Error ? error : new Error(message),
			message,
			videoUrl,
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
	uploader?: string;
	/** Canonical URL of the upload, written to WOAS. */
	sourceUrl?: string;
	/**
	 * A proven catalog match. It outranks `details`, which outranks the values
	 * parsed out of the upload title — see the field table in
	 * docs/superpowers/specs/2026-09-22-catalog-metadata-lookup-design.md.
	 */
	canonical?: CanonicalMetadata;
	/**
	 * SoundCloud's `label_name` and release date are clean fields a distributor
	 * filled in for this exact upload, so they beat the catalog's — whose date
	 * can be a reissue's. YouTube's label is scraped out of a free-text ℗ line
	 * and its date is the upload's, so the catalog's win there.
	 */
	trustPlatformRelease?: boolean;
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
	publisher?: string;
	ISRC?: string;
	remixArtist?: string;
	audioSourceUrl?: string;
	userDefinedText?: { description: string; value: string }[];
}

export function buildID3Tags({
	trackTitle,
	videoTitle,
	artist,
	details,
	image,
	uploader,
	sourceUrl,
	canonical,
	trustPlatformRelease,
}: ID3TagInput): ID3Tags {
	/**
	 * The title a file gets without a catalog match. A single is its own album,
	 * so the album falls back to this one: only a release proven by the
	 * upload's own ISRC may change the album, and a catalog title proves the
	 * song, not the release.
	 */
	const uploadTitle = (details?.track || trackTitle || videoTitle || "").trim();
	const title = (canonical?.title || uploadTitle).trim();
	const finalArtist = (
		canonical?.artist ||
		details?.artist ||
		artist ||
		"Unknown Artist"
	).trim();
	const performerInfo = (
		details?.albumArtist ||
		finalArtist ||
		"Unknown Artist"
	).trim();
	const album = (
		canonical?.album ||
		details?.album ||
		uploadTitle ||
		"Unknown Album"
	).trim();
	const composer = (details?.composer || finalArtist || "").trim();

	const tags: ID3Tags = {
		title: title || "Unknown Title",
		artist: finalArtist,
		performerInfo,
		album,
		composer,
	};

	const genre = canonical?.genre || details?.genre;
	if (genre) tags.genre = genre;
	const year = trustPlatformRelease
		? (details?.year ?? canonical?.year)
		: (canonical?.year ?? details?.year);
	if (typeof year === "number") tags.year = String(year);
	if (typeof details?.bpm === "number")
		tags.bpm = String(Math.round(details.bpm));

	const titleCredits = cleanUploadTitle(videoTitle, {
		labelName: details?.label,
	});
	const label = resolveLabel({
		platformLabel: trustPlatformRelease
			? (details?.label ?? canonical?.label)
			: (canonical?.label ?? details?.label),
		titleLabel: titleCredits.label,
		uploader: uploader || details?.uploader,
		artist: finalArtist,
	});
	if (label) tags.publisher = label;
	/** `details.isrc` only ever comes from SoundCloud's own publisher metadata. */
	const isrc = details?.isrc || canonical?.isrc;
	if (isrc) tags.ISRC = isrc;
	const remixer = extractRemixer(tags.title);
	if (remixer) tags.remixArtist = remixer;
	if (titleCredits.catalogNumber) {
		tags.userDefinedText = [
			{ description: "CATALOGNUMBER", value: titleCredits.catalogNumber },
		];
	}
	if (sourceUrl) tags.audioSourceUrl = sourceUrl;

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
