import * as Sentry from "@sentry/sveltekit";

const DEFAULT_TIMEOUT_MS = 10_000;
const HYDRATION = /window\.__sc_hydration\s*=\s*(\[.*?\]);\s*<\/script>/s;
const IMAGE_SIZE_SUFFIX = /-(?:large|t\d+x\d+|original)(\.\w+)$/;
const SOUNDCLOUD_IMAGE_HOST = /(?:^|\.)sndcdn\.com$/i;

export interface SoundCloudTrack {
	title: string;
	uploader: string;
	creditedArtist?: string;
	albumTitle?: string;
	isrc?: string;
	labelName?: string;
	composer?: string;
	genre?: string;
	/** The release date when the uploader set one, else the upload time (ISO 8601). */
	releaseDate?: string;
	durationSeconds?: number;
	artworkUrl?: string;
	avatarUrl?: string;
	isPreviewOnly: boolean;
	isGeoBlocked: boolean;
}

export class SoundCloudTrackError extends Error {
	constructor(
		message: string,
		public readonly isUnavailable: boolean = false,
	) {
		super(message);
		this.name = "SoundCloudTrackError";
	}
}

export type TrackPageResult =
	| { status: "found"; track: SoundCloudTrack }
	/** Page rendered with no track: deleted, private, or never existed. */
	| { status: "missing" }
	/** SoundCloud changed its markup. */
	| { status: "unrecognized" };

type PageFetchResult = TrackPageResult | { status: "failed"; error: Error };

interface HydratedSound {
	title?: string;
	genre?: string | null;
	label_name?: string | null;
	release_date?: string | null;
	display_date?: string | null;
	duration?: number | null;
	artwork_url?: string | null;
	policy?: string | null;
	user?: { username?: string; avatar_url?: string | null };
	media?: { transcodings?: { snipped?: boolean }[] };
	publisher_metadata?: {
		artist?: string | null;
		album_title?: string | null;
		isrc?: string | null;
		writer_composer?: string | null;
	} | null;
}

interface OEmbedResponse {
	title?: string;
	author_name?: string;
	thumbnail_url?: string;
}

function presentString(value: string | null | undefined): string | undefined {
	return value?.trim() || undefined;
}

export function isSoundCloudImageUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === "https:" &&
			SOUNDCLOUD_IMAGE_HOST.test(parsed.hostname)
		);
	} catch {
		return false;
	}
}

/** SoundCloud serves every artwork at 500×500 JPEG; the page links the 100×100 `-large`. */
function coverSizedImageUrl(
	url: string | null | undefined,
): string | undefined {
	if (!url || !isSoundCloudImageUrl(url)) return undefined;
	return url.replace(IMAGE_SIZE_SUFFIX, "-t500x500$1");
}

function toTrack(
	sound: HydratedSound,
	title: string,
	uploader: string,
): SoundCloudTrack {
	const transcodings = sound.media?.transcodings ?? [];
	const publisher = sound.publisher_metadata ?? {};
	return {
		title,
		uploader,
		creditedArtist: presentString(publisher.artist),
		albumTitle: presentString(publisher.album_title),
		isrc: presentString(publisher.isrc),
		labelName: presentString(sound.label_name),
		composer: presentString(publisher.writer_composer),
		genre: presentString(sound.genre),
		releaseDate:
			presentString(sound.release_date) ?? presentString(sound.display_date),
		durationSeconds:
			typeof sound.duration === "number" && sound.duration > 0
				? Math.round(sound.duration / 1000)
				: undefined,
		artworkUrl: coverSizedImageUrl(sound.artwork_url),
		avatarUrl: coverSizedImageUrl(sound.user?.avatar_url),
		isPreviewOnly:
			sound.policy === "SNIP" ||
			(transcodings.length > 0 &&
				transcodings.every((t) => t.snipped === true)),
		isGeoBlocked: sound.policy === "BLOCK",
	};
}

export function parseTrackPage(html: string): TrackPageResult {
	const json = html.match(HYDRATION)?.[1];
	if (!json) return { status: "unrecognized" };

	let entries: unknown;
	try {
		entries = JSON.parse(json);
	} catch {
		return { status: "unrecognized" };
	}
	if (!Array.isArray(entries)) return { status: "unrecognized" };

	const sound = entries.find(
		(entry): entry is { hydratable: "sound"; data: HydratedSound } =>
			entry?.hydratable === "sound",
	)?.data;
	if (!sound) return { status: "missing" };

	const title = presentString(sound.title);
	const uploader = presentString(sound.user?.username);
	if (!title || !uploader) return { status: "unrecognized" };

	return { status: "found", track: toTrack(sound, title, uploader) };
}

async function fetchTrackPage(
	canonicalUrl: string,
	timeout: number,
): Promise<PageFetchResult> {
	try {
		const response = await fetch(canonicalUrl, {
			signal: AbortSignal.timeout(timeout),
		});
		if (response.status === 404) return { status: "missing" };
		if (!response.ok) {
			return {
				status: "failed",
				error: new Error(`SoundCloud track page returned ${response.status}`),
			};
		}
		return parseTrackPage(await response.text());
	} catch (error) {
		return {
			status: "failed",
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

function describePage(page: PageFetchResult): string {
	return page.status === "failed" ? page.error.message : page.status;
}

async function fetchTrackViaOEmbed(
	canonicalUrl: string,
	timeout: number,
	page: PageFetchResult,
): Promise<SoundCloudTrack> {
	try {
		const response = await fetch(
			`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`,
			{ signal: AbortSignal.timeout(timeout) },
		);
		if (response.status === 403 || response.status === 404) {
			throw new SoundCloudTrackError("Track is unavailable or private", true);
		}
		if (!response.ok) {
			throw new Error(`SoundCloud oEmbed returned ${response.status}`);
		}
		const oembed = (await response.json()) as OEmbedResponse;
		const uploader = oembed.author_name?.trim() ?? "";
		const rawTitle = oembed.title?.trim() ?? "";
		const byline = ` by ${uploader}`;
		return {
			title:
				uploader && rawTitle.endsWith(byline)
					? rawTitle.slice(0, -byline.length)
					: rawTitle,
			uploader,
			artworkUrl: coverSizedImageUrl(oembed.thumbnail_url),
			isPreviewOnly: false,
			isGeoBlocked: false,
		};
	} catch (error) {
		if (error instanceof SoundCloudTrackError) throw error;
		Sentry.captureException(error, {
			level: "warning",
			tags: { service: "soundcloud-track", operation: "fetch-oembed" },
			extra: { canonicalUrl, page: describePage(page) },
		});
		throw new SoundCloudTrackError("Failed to load track info");
	}
}

/**
 * Page first (it's the only source of label, album, ISRC, release date and
 * the preview flags), oEmbed second. A nonexistent track is a 200 with no
 * `sound` entry, so "missing" is confirmed against oEmbed before it is
 * believed: without that, a SoundCloud markup change would read as "every
 * track is unavailable" and never reach Sentry.
 *
 * Reports at most once per lookup, and never for a track that is genuinely
 * gone (oEmbed 403/404), which is normal operation.
 */
export async function fetchSoundCloudTrack(
	canonicalUrl: string,
	timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<SoundCloudTrack> {
	const page = await fetchTrackPage(canonicalUrl, timeout);
	if (page.status === "found") return page.track;

	const track = await fetchTrackViaOEmbed(canonicalUrl, timeout, page);
	Sentry.captureException(
		page.status === "failed"
			? page.error
			: new Error(
					`SoundCloud track page was ${page.status}, but oEmbed found the track`,
				),
		{
			level: "warning",
			tags: { service: "soundcloud-track", operation: "fetch-page" },
			extra: { canonicalUrl },
		},
	);
	return track;
}
