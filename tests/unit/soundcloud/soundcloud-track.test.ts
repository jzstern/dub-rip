import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchSoundCloudTrack,
	parseTrackPage,
	type SoundCloudTrack,
	SoundCloudTrackError,
	withServedImages,
} from "$lib/soundcloud/soundcloud-track";

const BAD_GUY_SOUND = {
	title: "bad guy",
	genre: "Alternative",
	label_name: "Darkroom/Interscope Records",
	release_date: "2019-03-29T00:00:00Z",
	display_date: "2019-03-29T00:00:00Z",
	duration: 194134,
	artwork_url: "https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-large.jpg",
	policy: "MONETIZE",
	user: {
		username: "Billie Eilish",
		avatar_url:
			"https://i1.sndcdn.com/avatars-V2fT1gZ1s4eokCrM-RnxA3g-large.jpg",
	},
	media: { transcodings: [{ snipped: false }, { snipped: false }] },
	publisher_metadata: {
		artist: "Billie Eilish",
		album_title: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
		isrc: "USUM71900764",
	},
};

function trackPage(sound: Record<string, unknown> | null): string {
	const hydration = [
		{ hydratable: "user", data: {} },
		...(sound ? [{ hydratable: "sound", data: sound }] : []),
	];
	return `<html><body><script>window.__sc_hydration = ${JSON.stringify(hydration)};</script></body></html>`;
}

function response(
	status: number,
	body: { text?: string; json?: unknown } = {},
) {
	return {
		status,
		ok: status >= 200 && status < 300,
		text: async () => body.text ?? "",
		json: async () => body.json,
	};
}

describe("parseTrackPage()", () => {
	it("reads every field the tags use", () => {
		// #when
		const result = parseTrackPage(trackPage(BAD_GUY_SOUND));

		// #then
		expect(result).toEqual({
			status: "found",
			track: {
				title: "bad guy",
				uploader: "Billie Eilish",
				creditedArtist: "Billie Eilish",
				albumTitle: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
				isrc: "USUM71900764",
				labelName: "Darkroom/Interscope Records",
				composer: undefined,
				genre: "Alternative",
				releaseDate: "2019-03-29T00:00:00Z",
				durationSeconds: 194,
				artworkUrl:
					"https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-t500x500.jpg",
				avatarUrl:
					"https://i1.sndcdn.com/avatars-V2fT1gZ1s4eokCrM-RnxA3g-t500x500.jpg",
				isPreviewOnly: false,
				isGeoBlocked: false,
			},
		});
	});

	it("flags a Go+ preview when every transcoding is snipped", () => {
		// #when
		const result = parseTrackPage(
			trackPage({
				...BAD_GUY_SOUND,
				media: { transcodings: [{ snipped: true }, { snipped: true }] },
			}),
		);

		// #then
		expect(result.status === "found" && result.track.isPreviewOnly).toBe(true);
	});

	it("flags a geo-blocked track", () => {
		// #when
		const result = parseTrackPage(
			trackPage({ ...BAD_GUY_SOUND, policy: "BLOCK" }),
		);

		// #then
		expect(result.status === "found" && result.track.isGeoBlocked).toBe(true);
	});

	it("drops artwork served from anywhere but SoundCloud's CDN", () => {
		// #when
		const result = parseTrackPage(
			trackPage({
				...BAD_GUY_SOUND,
				artwork_url: "https://evil.example/artworks-x-large.jpg",
			}),
		);

		// #then
		expect(
			result.status === "found" && result.track.artworkUrl,
		).toBeUndefined();
	});

	it("reports a page with no track as missing", () => {
		// #when
		const result = parseTrackPage(trackPage(null));

		// #then
		expect(result).toEqual({ status: "missing" });
	});

	it("reports unfamiliar markup as unrecognized", () => {
		// #when
		const result = parseTrackPage("<html><body>new layout</body></html>");

		// #then
		expect(result).toEqual({ status: "unrecognized" });
	});
});

describe("fetchSoundCloudTrack()", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureException).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the page's track without touching oEmbed", async () => {
		// #given
		const fetchMock = vi.fn(async () =>
			response(200, { text: trackPage(BAD_GUY_SOUND) }),
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const track = await fetchSoundCloudTrack(
			"https://soundcloud.com/billieeilish/bad-guy",
		);

		// #then
		expect(track.labelName).toBe("Darkroom/Interscope Records");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("treats missing-on-page plus oEmbed 404 as unavailable, unreported", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url.includes("/oembed")
					? response(404)
					: response(200, { text: trackPage(null) }),
			),
		);

		// #when
		const error = await fetchSoundCloudTrack(
			"https://soundcloud.com/a/gone",
		).catch((e) => e);

		// #then
		expect(error).toBeInstanceOf(SoundCloudTrackError);
		expect(error.isUnavailable).toBe(true);
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it("falls back to oEmbed and reports once when the page markup is unrecognized", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url.includes("/oembed")
					? response(200, {
							json: {
								title: "bad guy by Billie Eilish",
								author_name: "Billie Eilish",
								thumbnail_url:
									"https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-t500x500.jpg",
							},
						})
					: response(200, { text: "<html>new layout</html>" }),
			),
		);

		// #when
		const track = await fetchSoundCloudTrack(
			"https://soundcloud.com/billieeilish/bad-guy",
		);

		// #then
		expect(track).toMatchObject({
			title: "bad guy",
			uploader: "Billie Eilish",
			isPreviewOnly: false,
		});
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
	});

	it("reports once and throws a non-unavailable error when page and oEmbed both fail", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(503)),
		);

		// #when
		const error = await fetchSoundCloudTrack(
			"https://soundcloud.com/a/b",
		).catch((e) => e);

		// #then
		expect(error).toBeInstanceOf(SoundCloudTrackError);
		expect(error.isUnavailable).toBe(false);
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
	});
});

describe("withServedImages()", () => {
	const ARTWORK =
		"https://i1.sndcdn.com/artworks-000103249553-vped6c-t500x500.jpg";
	const AVATAR =
		"https://i1.sndcdn.com/avatars-uEz9ujjRaHQK9gzS-wTsgDA-t500x500.jpg";
	const TRACK: SoundCloudTrack = {
		title: "Taken",
		uploader: "Toro y Moi",
		artworkUrl: ARTWORK,
		avatarUrl: AVATAR,
		isPreviewOnly: false,
		isGeoBlocked: false,
	};

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubImageStatuses(statuses: Record<string, number | Error>) {
		const fetchMock = vi.fn(async (url: string) => {
			const status = statuses[url];
			if (status instanceof Error) throw status;
			return response(status);
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("keeps images SoundCloud still serves, checking each with HEAD", async () => {
		// #given
		const fetchMock = stubImageStatuses({ [ARTWORK]: 200, [AVATAR]: 200 });

		// #when
		const track = await withServedImages(TRACK);

		// #then
		expect(track).toBe(TRACK);
		expect(fetchMock).toHaveBeenCalledWith(
			ARTWORK,
			expect.objectContaining({ method: "HEAD" }),
		);
	});

	it("drops artwork whose file SoundCloud deleted, keeping the avatar", async () => {
		// #given
		stubImageStatuses({ [ARTWORK]: 404, [AVATAR]: 200 });

		// #when
		const track = await withServedImages(TRACK);

		// #then
		expect(track.artworkUrl).toBeUndefined();
		expect(track.avatarUrl).toBe(AVATAR);
	});

	it("drops a dead avatar too", async () => {
		// #given
		stubImageStatuses({ [ARTWORK]: 200, [AVATAR]: 404 });

		// #when
		const track = await withServedImages(TRACK);

		// #then
		expect(track.artworkUrl).toBe(ARTWORK);
		expect(track.avatarUrl).toBeUndefined();
	});

	it("keeps images when the check itself fails, since that proves nothing", async () => {
		// #given
		stubImageStatuses({ [ARTWORK]: new Error("timeout"), [AVATAR]: 503 });

		// #when
		const track = await withServedImages(TRACK);

		// #then
		expect(track).toBe(TRACK);
	});

	it("makes no request for a track without images", async () => {
		// #given
		const fetchMock = stubImageStatuses({});
		const bare = { ...TRACK, artworkUrl: undefined, avatarUrl: undefined };

		// #when
		const track = await withServedImages(bare);

		// #then
		expect(track).toBe(bare);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
