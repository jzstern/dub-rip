const DEFAULT_TIMEOUT = 5000;
const COVER_ART_TIMEOUT = 4000;
const USER_AGENT = "dub-rip/1.0 (https://github.com/jzs/dub-rip)";
const API_BASE = "https://musicbrainz.org/ws/2/recording";
const COVER_ART_BASE = "https://coverartarchive.org/release";

export interface TrackMetadata {
	album: string;
	year: string;
	genre: string;
	trackNumber: string;
	label: string;
	releaseId: string;
}

export interface CoverArtResult {
	imageBuffer: Buffer;
	mime: string;
}

interface MusicBrainzTag {
	name: string;
	count: number;
}

interface MusicBrainzRelease {
	id: string;
	title: string;
	date?: string;
	"release-group"?: { "primary-type"?: string };
	media?: Array<{ track?: Array<{ number?: string }> }>;
	"label-info"?: Array<{ label?: { name?: string } }>;
}

interface MusicBrainzRecording {
	releases?: MusicBrainzRelease[];
	tags?: MusicBrainzTag[];
}

interface MusicBrainzResponse {
	recordings?: MusicBrainzRecording[];
}

function pickBestRelease(releases: MusicBrainzRelease[]): MusicBrainzRelease {
	const album = releases.find(
		(r) => r["release-group"]?.["primary-type"] === "Album",
	);
	return album ?? releases[0];
}

function extractGenre(tags?: MusicBrainzTag[]): string {
	if (!tags || tags.length === 0) return "";
	return tags.reduce((best, tag) => (tag.count > best.count ? tag : best)).name;
}

function escapeLucene(value: string): string {
	return value.replace(/"/g, '\\"');
}

export async function lookupTrack(
	artist: string,
	title: string,
	timeout: number = DEFAULT_TIMEOUT,
): Promise<TrackMetadata | null> {
	if (!artist || !title) return null;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const query = `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artist)}"`;
		const url = `${API_BASE}?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

		const response = await fetch(url, {
			signal: controller.signal,
			headers: { "User-Agent": USER_AGENT },
		});

		if (!response.ok) return null;

		const data = (await response.json()) as MusicBrainzResponse;
		const recordings = data.recordings;

		if (!recordings || recordings.length === 0) return null;

		const recording = recordings[0];
		const releases = recording.releases;

		if (!releases || releases.length === 0) return null;

		const release = pickBestRelease(releases);

		return {
			album: release.title ?? "",
			year: release.date?.slice(0, 4) ?? "",
			genre: extractGenre(recording.tags),
			trackNumber: release.media?.[0]?.track?.[0]?.number ?? "",
			label: release["label-info"]?.[0]?.label?.name ?? "",
			releaseId: release.id,
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function fetchCoverArt(
	releaseId: string,
	timeout: number = COVER_ART_TIMEOUT,
): Promise<CoverArtResult | null> {
	if (!releaseId) return null;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const url = `${COVER_ART_BASE}/${encodeURIComponent(releaseId)}/front-250`;

		const response = await fetch(url, {
			signal: controller.signal,
			headers: { "User-Agent": USER_AGENT },
		});

		if (!response.ok) return null;

		const arrayBuffer = await response.arrayBuffer();
		const mime = response.headers.get("Content-Type") ?? "image/jpeg";

		return { imageBuffer: Buffer.from(arrayBuffer), mime };
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function fetchThumbnailArt(
	videoId: string,
	timeout: number = COVER_ART_TIMEOUT,
): Promise<CoverArtResult | null> {
	if (!videoId) return null;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const url = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

		const response = await fetch(url, {
			signal: controller.signal,
		});

		if (!response.ok) return null;

		const arrayBuffer = await response.arrayBuffer();
		const mime = response.headers.get("Content-Type") ?? "image/jpeg";

		return { imageBuffer: Buffer.from(arrayBuffer), mime };
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}
