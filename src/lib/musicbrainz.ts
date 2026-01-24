const DEFAULT_TIMEOUT = 5000;
const COVER_ART_TIMEOUT = 4000;
const USER_AGENT = "dub-rip/1.0 (https://github.com/jzstern/dub-rip)";
const API_BASE = "https://musicbrainz.org/ws/2";
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
	id?: string;
	releases?: MusicBrainzRelease[];
	tags?: MusicBrainzTag[];
}

interface MusicBrainzSearchResponse {
	recordings?: MusicBrainzRecording[];
}

interface MusicBrainzRecordingLookup {
	tags?: MusicBrainzTag[];
}

interface MusicBrainzReleaseLookup {
	"label-info"?: Array<{ label?: { name?: string } }>;
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
	return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
}

async function fetchRecordingTags(
	recordingId: string,
	signal: AbortSignal,
): Promise<MusicBrainzTag[]> {
	try {
		const url = `${API_BASE}/recording/${encodeURIComponent(recordingId)}?inc=tags&fmt=json`;
		const response = await fetch(url, {
			signal,
			headers: { "User-Agent": USER_AGENT },
		});
		if (!response.ok) return [];
		const data = (await response.json()) as MusicBrainzRecordingLookup;
		return data.tags ?? [];
	} catch {
		return [];
	}
}

async function fetchReleaseLabels(
	releaseId: string,
	signal: AbortSignal,
): Promise<string> {
	try {
		const url = `${API_BASE}/release/${encodeURIComponent(releaseId)}?inc=labels&fmt=json`;
		const response = await fetch(url, {
			signal,
			headers: { "User-Agent": USER_AGENT },
		});
		if (!response.ok) return "";
		const data = (await response.json()) as MusicBrainzReleaseLookup;
		return data["label-info"]?.[0]?.label?.name ?? "";
	} catch {
		return "";
	}
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
		const searchUrl = `${API_BASE}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

		const response = await fetch(searchUrl, {
			signal: controller.signal,
			headers: { "User-Agent": USER_AGENT },
		});

		if (!response.ok) return null;

		const data = (await response.json()) as MusicBrainzSearchResponse;
		const recordings = data.recordings;

		if (!recordings || recordings.length === 0) return null;

		const recording = recordings[0];
		const releases = recording.releases;

		if (!releases || releases.length === 0) return null;

		const release = pickBestRelease(releases);
		const recordingId = recording.id;

		const [tags, label] = await Promise.all([
			recordingId
				? fetchRecordingTags(recordingId, controller.signal)
				: Promise.resolve([]),
			fetchReleaseLabels(release.id, controller.signal),
		]);

		return {
			album: release.title ?? "",
			year: release.date?.slice(0, 4) ?? "",
			genre: extractGenre(tags),
			trackNumber: release.media?.[0]?.track?.[0]?.number ?? "",
			label,
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
