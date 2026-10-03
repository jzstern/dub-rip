import * as Sentry from "@sentry/sveltekit";
import { parseBandcampTrackUrl } from "./bandcamp-url";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
const TRALBUM_ATTRIBUTE = /\sdata-tralbum="([^"]*)"/;
const EMBED_ATTRIBUTE = /\sdata-embed="([^"]*)"/;
const BAND_ATTRIBUTE = /\sdata-band="([^"]*)"/;
const HTML_ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(quot|amp|lt|gt|apos));/gi;
const NAMED_ENTITIES: Record<string, string> = {
	quot: '"',
	amp: "&",
	lt: "<",
	gt: ">",
	apos: "'",
};

export interface BandcampTrack {
	title: string;
	artist: string;
	/** The account the track is sold from: the artist's own, or a label's. */
	bandName: string;
	albumTitle?: string;
	isrc?: string;
	/** ISO 8601: the album's release date, else the track's. */
	releaseDate?: string;
	durationSeconds?: number;
	artworkUrl?: string;
	/** False when the artist turned streaming off: there is no audio to fetch without buying. */
	isStreamable: boolean;
	/**
	 * Name-your-price with a $0 minimum and no email gate. yt-dlp then reads
	 * the free-download page and gets MP3 320; otherwise only the 128 kbps
	 * stream exists.
	 */
	hasFreeDownload: boolean;
}

export const BANDCAMP_CUSTOM_DOMAIN_MESSAGE =
	"This artist's Bandcamp page has moved to their own website, which isn't supported yet.";

export class BandcampTrackError extends Error {
	/**
	 * `userMessage` marks a lookup that answers the request on its own (a
	 * custom-domain artist): the download must not go ahead, and the message
	 * is what the user sees.
	 */
	constructor(
		message: string,
		public readonly isUnavailable: boolean = false,
		public readonly userMessage?: string,
	) {
		super(message);
		this.name = "BandcampTrackError";
	}
}

export type TrackPageResult =
	| { status: "found"; track: BandcampTrack }
	/** Bandcamp changed its markup. */
	| { status: "unrecognized" };

interface Tralbum {
	item_type?: string;
	artist?: string | null;
	art_id?: number | null;
	freeDownloadPage?: string | null;
	album_url?: string | null;
	album_release_date?: string | null;
	current?: {
		title?: string | null;
		artist?: string | null;
		isrc?: string | null;
		release_date?: string | null;
		publish_date?: string | null;
		require_email?: number | null;
	};
	trackinfo?: {
		file?: Record<string, string> | null;
		duration?: number | null;
	}[];
}

interface Embed {
	album_title?: string | null;
	album_embed_data?: { album_title?: string | null } | null;
}

interface Band {
	name?: string | null;
}

function decodeHtmlEntities(value: string): string {
	return value.replace(HTML_ENTITY, (entity, dec, hex, named) => {
		if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
		if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
		return NAMED_ENTITIES[named.toLowerCase()] ?? entity;
	});
}

function readJsonAttribute<T>(html: string, pattern: RegExp): T | undefined {
	const raw = html.match(pattern)?.[1];
	if (!raw) return undefined;
	try {
		return JSON.parse(decodeHtmlEntities(raw)) as T;
	} catch {
		return undefined;
	}
}

function presentString(value: string | null | undefined): string | undefined {
	return value?.trim() || undefined;
}

/** Bandcamp dates read "03 Apr 2014 00:00:00 GMT". */
function toIsoDate(value: string | null | undefined): string | undefined {
	const time = value ? Date.parse(value) : Number.NaN;
	return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * `_16` is Bandcamp's 700×700 JPEG — square, so it is never cropped, and a
 * fraction of the size of `_10`, which is the artist's original upload. Built
 * from the numeric ID, so the URL can only ever point at Bandcamp's CDN.
 */
export function bandcampArtworkUrl(artId: unknown): string | undefined {
	return typeof artId === "number" && Number.isSafeInteger(artId) && artId > 0
		? `https://f4.bcbits.com/img/a${artId}_16.jpg`
		: undefined;
}

export function parseBandcampTrackPage(html: string): TrackPageResult {
	const tralbum = readJsonAttribute<Tralbum>(html, TRALBUM_ATTRIBUTE);
	if (!tralbum || tralbum.item_type !== "track") {
		return { status: "unrecognized" };
	}

	const current = tralbum.current ?? {};
	const info = tralbum.trackinfo?.[0];
	const title = presentString(current.title);
	const artist = presentString(current.artist) ?? presentString(tralbum.artist);
	if (!title || !artist || !info) return { status: "unrecognized" };

	const embed = readJsonAttribute<Embed>(html, EMBED_ATTRIBUTE);
	const band = readJsonAttribute<Band>(html, BAND_ATTRIBUTE);
	const albumTitle = tralbum.album_url
		? (presentString(embed?.album_embed_data?.album_title) ??
			presentString(embed?.album_title))
		: undefined;

	return {
		status: "found",
		track: {
			title,
			artist,
			bandName: presentString(band?.name) ?? artist,
			albumTitle,
			isrc: presentString(current.isrc),
			releaseDate:
				toIsoDate(tralbum.album_release_date) ??
				toIsoDate(current.release_date) ??
				toIsoDate(current.publish_date),
			durationSeconds:
				typeof info.duration === "number" && info.duration > 0
					? Math.round(info.duration)
					: undefined,
			artworkUrl: bandcampArtworkUrl(tralbum.art_id),
			isStreamable: Object.keys(info.file ?? {}).length > 0,
			hasFreeDownload:
				Boolean(tralbum.freeDownloadPage) && !current.require_email,
		},
	};
}

function isRedirect(status: number): boolean {
	return status >= 300 && status < 400;
}

function redirectTarget(response: Response, base: string): URL | null {
	const location = response.headers.get("location");
	if (!location) return null;
	try {
		return new URL(location, base);
	} catch {
		return null;
	}
}

/**
 * Redirects are read, never followed blindly: Bandcamp 301s an artist with a
 * custom domain to that domain, which the artist controls, so following it
 * would let anyone who pastes a `*.bandcamp.com` link make this server request
 * whatever that domain redirects to next. Only a hop to another Bandcamp track
 * page is followed.
 */
async function fetchTrackPage(
	canonicalUrl: string,
	signal: AbortSignal,
): Promise<Response> {
	let url = canonicalUrl;
	for (let hop = 0; ; hop++) {
		const response = await fetch(url, { redirect: "manual", signal });
		if (!isRedirect(response.status)) return response;

		const target = redirectTarget(response, url);
		const next = target && parseBandcampTrackUrl(target.href);
		if (next && hop < MAX_REDIRECTS) {
			url = next.canonicalUrl;
			continue;
		}
		if (target && !target.hostname.endsWith(".bandcamp.com")) {
			throw new BandcampTrackError(
				"Track page redirects to a custom domain",
				false,
				BANDCAMP_CUSTOM_DOMAIN_MESSAGE,
			);
		}
		throw new BandcampTrackError("Track is unavailable", true);
	}
}

/**
 * A deleted or never-existing track is a plain 404, and a custom-domain
 * artist is a known limitation: both are normal operation and unreported.
 * Anything else that stops the page from parsing is reported here; the
 * download still goes ahead without metadata, because yt-dlp reads the same
 * page with its own parser. getBandcampTrack keeps the failure for a while,
 * so preview, details and download report it once between them.
 */
export async function fetchBandcampTrack(
	canonicalUrl: string,
	timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<BandcampTrack> {
	let failure: Error;
	try {
		const response = await fetchTrackPage(
			canonicalUrl,
			AbortSignal.timeout(timeout),
		);
		if (response.status === 404 || response.status === 410) {
			throw new BandcampTrackError("Track is unavailable", true);
		}
		if (!response.ok) {
			failure = new Error(`Bandcamp track page returned ${response.status}`);
		} else {
			const page = parseBandcampTrackPage(await response.text());
			if (page.status === "found") return page.track;
			failure = new Error("Bandcamp track page had no recognizable track data");
		}
	} catch (error) {
		if (error instanceof BandcampTrackError) throw error;
		failure = error instanceof Error ? error : new Error(String(error));
	}

	Sentry.captureException(failure, {
		level: "warning",
		tags: { service: "bandcamp-track", operation: "fetch-page" },
		extra: { canonicalUrl },
	});
	throw new BandcampTrackError("Failed to load track info");
}
