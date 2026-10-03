import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BANDCAMP_CUSTOM_DOMAIN_MESSAGE,
	BandcampTrackError,
	bandcampArtworkUrl,
	fetchBandcampTrack,
	parseBandcampTrackPage,
} from "$lib/bandcamp/bandcamp-track";

const LANIUS_TRALBUM = {
	item_type: "track",
	artist: "Ben Prunty",
	art_id: 1270682128,
	freeDownloadPage: "https://bandcamp.com/download?id=123&ts=456",
	album_url: "/album/ftl-advanced-edition-soundtrack",
	album_release_date: "03 Apr 2014 00:00:00 GMT",
	current: {
		title: "Lanius (Battle)",
		artist: null,
		isrc: null,
		release_date: null,
		publish_date: "03 Apr 2014 07:01:31 GMT",
		require_email: null,
	},
	trackinfo: [
		{
			file: { "mp3-128": "https://t4.bcbits.com/stream/abc/mp3-128/1" },
			duration: 260.877,
		},
	],
};

const FTL_EMBED = {
	album_title: "FTL: Advanced Edition Soundtrack",
	album_embed_data: { album_title: "FTL: Advanced Edition Soundtrack" },
};

const PRUNTY_BAND = { name: "Ben Prunty" };

/** The way Bandcamp embeds JSON: HTML-escaped inside a double-quoted attribute. */
function escapeAttribute(value: unknown): string {
	return JSON.stringify(value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** `null` omits the attribute entirely. */
interface PageParts {
	tralbum?: unknown;
	embed?: unknown;
	band?: unknown;
}

function trackPage({
	tralbum = LANIUS_TRALBUM,
	embed = FTL_EMBED,
	band = PRUNTY_BAND,
}: PageParts = {}): string {
	const attributes = [
		tralbum === null ? "" : ` data-tralbum="${escapeAttribute(tralbum)}"`,
		embed === null ? "" : ` data-embed="${escapeAttribute(embed)}"`,
		band === null ? "" : ` data-band="${escapeAttribute(band)}"`,
	].join("");
	return `<html><head><script type="text/javascript" src="https://s4.bcbits.com/bundle.js"${attributes}></script></head><body></body></html>`;
}

function withCurrent(overrides: Record<string, unknown>) {
	return {
		...LANIUS_TRALBUM,
		current: { ...LANIUS_TRALBUM.current, ...overrides },
	};
}

function withTrackInfo(info: Record<string, unknown>) {
	return { ...LANIUS_TRALBUM, trackinfo: [info] };
}

function foundTrack(html: string) {
	const result = parseBandcampTrackPage(html);
	if (result.status !== "found") {
		throw new Error(`expected a found track, got ${result.status}`);
	}
	return result.track;
}

function response(status: number, text = "") {
	return {
		status,
		ok: status >= 200 && status < 300,
		text: async () => text,
	};
}

describe("parseBandcampTrackPage()", () => {
	it("reads every field the tags use from a free track page", () => {
		// #when
		const result = parseBandcampTrackPage(trackPage());

		// #then
		expect(result).toEqual({
			status: "found",
			track: {
				title: "Lanius (Battle)",
				artist: "Ben Prunty",
				bandName: "Ben Prunty",
				albumTitle: "FTL: Advanced Edition Soundtrack",
				isrc: undefined,
				releaseDate: "2014-04-03T00:00:00.000Z",
				durationSeconds: 261,
				artworkUrl: "https://f4.bcbits.com/img/a1270682128_16.jpg",
				isStreamable: true,
				hasFreeDownload: true,
			},
		});
	});

	it("prefers the track's own artist over the album artist", () => {
		// #when
		const track = foundTrack(
			trackPage({ tralbum: withCurrent({ artist: "Guest Artist" }) }),
		);

		// #then
		expect(track.artist).toBe("Guest Artist");
	});

	it("keeps a label's band name apart from the artist", () => {
		// #when
		const track = foundTrack(trackPage({ band: { name: "Hyperdub" } }));

		// #then
		expect(track.bandName).toBe("Hyperdub");
	});

	it("falls back to the artist as band name when data-band is absent", () => {
		// #when
		const track = foundTrack(
			trackPage({
				tralbum: withCurrent({ artist: "Guest Artist" }),
				band: null,
			}),
		);

		// #then
		expect(track.bandName).toBe("Guest Artist");
	});

	it("reads the ISRC when the track carries one", () => {
		// #when
		const track = foundTrack(
			trackPage({ tralbum: withCurrent({ isrc: "USA2P1412345" }) }),
		);

		// #then
		expect(track.isrc).toBe("USA2P1412345");
	});

	it("falls back to the track's release date when the album has none", () => {
		// #when
		const track = foundTrack(
			trackPage({
				tralbum: {
					...withCurrent({ release_date: "15 Jan 2020 00:00:00 GMT" }),
					album_release_date: null,
				},
			}),
		);

		// #then
		expect(track.releaseDate).toBe("2020-01-15T00:00:00.000Z");
	});

	it("falls back to the publish date when no release date exists", () => {
		// #when
		const track = foundTrack(
			trackPage({ tralbum: { ...LANIUS_TRALBUM, album_release_date: null } }),
		);

		// #then
		expect(track.releaseDate).toBe("2014-04-03T07:01:31.000Z");
	});

	it("leaves the release date unset when every date is unparseable", () => {
		// #when
		const track = foundTrack(
			trackPage({
				tralbum: {
					...withCurrent({ publish_date: "not a date" }),
					album_release_date: "garbage",
				},
			}),
		);

		// #then
		expect(track.releaseDate).toBeUndefined();
	});

	it("has no free download when an email is required", () => {
		// #when
		const track = foundTrack(
			trackPage({ tralbum: withCurrent({ require_email: 1 }) }),
		);

		// #then
		expect(track.hasFreeDownload).toBe(false);
	});

	it("has no free download when there is no free-download page", () => {
		// #when
		const track = foundTrack(
			trackPage({ tralbum: { ...LANIUS_TRALBUM, freeDownloadPage: null } }),
		);

		// #then
		expect(track.hasFreeDownload).toBe(false);
	});

	it.each([
		["a null file", { file: null, duration: 260.877 }],
		["an empty file map", { file: {}, duration: 260.877 }],
		["no file at all", { duration: 260.877 }],
	])("is not streamable with %s", (_label, info) => {
		// #when
		const track = foundTrack(trackPage({ tralbum: withTrackInfo(info) }));

		// #then
		expect(track.isStreamable).toBe(false);
	});

	it.each([
		["zero", 0],
		["null", null],
		["negative", -5],
	])("leaves duration unset for a %s duration", (_label, duration) => {
		// #when
		const track = foundTrack(
			trackPage({
				tralbum: withTrackInfo({ ...LANIUS_TRALBUM.trackinfo[0], duration }),
			}),
		);

		// #then
		expect(track.durationSeconds).toBeUndefined();
	});

	it("has no album title for a standalone single", () => {
		// #when
		const track = foundTrack(
			trackPage({ tralbum: { ...LANIUS_TRALBUM, album_url: null } }),
		);

		// #then
		expect(track.albumTitle).toBeUndefined();
	});

	it("falls back to the embed's top-level album title", () => {
		// #when
		const track = foundTrack(
			trackPage({ embed: { album_title: "Top Level Album" } }),
		);

		// #then
		expect(track.albumTitle).toBe("Top Level Album");
	});

	it("falls back to the top-level album title when the nested one is blank", () => {
		// #when
		const track = foundTrack(
			trackPage({
				embed: {
					album_title: "Top Level Album",
					album_embed_data: { album_title: "  " },
				},
			}),
		);

		// #then
		expect(track.albumTitle).toBe("Top Level Album");
	});

	it("has no artwork when art_id is missing", () => {
		// #when
		const track = foundTrack(
			trackPage({ tralbum: { ...LANIUS_TRALBUM, art_id: null } }),
		);

		// #then
		expect(track.artworkUrl).toBeUndefined();
	});

	it("decodes HTML entities in the title", () => {
		// #when
		const track = foundTrack(
			trackPage({
				tralbum: withCurrent({ title: `Rock & Roll "Live" at Joe's <3` }),
			}),
		);

		// #then
		expect(track.title).toBe(`Rock & Roll "Live" at Joe's <3`);
	});

	it("decodes named, decimal and hex entities in a hand-built attribute", () => {
		// #given
		const raw =
			"{&quot;item_type&quot;:&quot;track&quot;,&quot;artist&quot;:&quot;A &amp; B&quot;," +
			"&quot;current&quot;:{&quot;title&quot;:&quot;Joe&#39;s &#x2603; &apos;Song&apos;&quot;}," +
			"&quot;trackinfo&quot;:[{&quot;file&quot;:{&quot;mp3-128&quot;:&quot;x&quot;}}]}";

		// #when
		const track = foundTrack(`<div data-tralbum="${raw}"></div>`);

		// #then
		expect({ artist: track.artist, title: track.title }).toEqual({
			artist: "A & B",
			title: "Joe's ☃ 'Song'",
		});
	});

	it.each([
		["no data-tralbum attribute", trackPage({ tralbum: null })],
		["garbled data-tralbum JSON", '<div data-tralbum="{not json"></div>'],
		["an empty data-tralbum", '<div data-tralbum=""></div>'],
		[
			"an album page",
			trackPage({ tralbum: { ...LANIUS_TRALBUM, item_type: "album" } }),
		],
		["no title", trackPage({ tralbum: withCurrent({ title: "  " }) })],
		[
			"no artist anywhere",
			trackPage({ tralbum: { ...LANIUS_TRALBUM, artist: null } }),
		],
		[
			"no trackinfo",
			trackPage({ tralbum: { ...LANIUS_TRALBUM, trackinfo: [] } }),
		],
		["unrelated markup", "<html><body>new layout</body></html>"],
	])("reports %s as unrecognized", (_label, html) => {
		// #when
		const result = parseBandcampTrackPage(html);

		// #then
		expect(result).toEqual({ status: "unrecognized" });
	});
});

describe("bandcampArtworkUrl()", () => {
	it("builds the 700px CDN URL from a numeric art ID", () => {
		// #when
		const url = bandcampArtworkUrl(1270682128);

		// #then
		expect(url).toBe("https://f4.bcbits.com/img/a1270682128_16.jpg");
	});

	it.each([
		["a string", "1270682128"],
		["zero", 0],
		["a negative number", -1],
		["a fraction", 1.5],
		["an unsafe integer", Number.MAX_SAFE_INTEGER + 2],
		["NaN", Number.NaN],
		["null", null],
		["undefined", undefined],
		["a URL", "https://evil.example/a.jpg"],
	])("rejects %s", (_label, artId) => {
		// #when
		const url = bandcampArtworkUrl(artId);

		// #then
		expect(url).toBeUndefined();
	});
});

describe("fetchBandcampTrack()", () => {
	const TRACK_URL = "https://benprunty.bandcamp.com/track/lanius-battle";

	beforeEach(() => {
		vi.mocked(Sentry.captureException).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the parsed track from a single page fetch", async () => {
		// #given
		const fetchMock = vi.fn(async () => response(200, trackPage()));
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const track = await fetchBandcampTrack(TRACK_URL);

		// #then
		expect({ title: track.title, calls: fetchMock.mock.calls.length }).toEqual({
			title: "Lanius (Battle)",
			calls: 1,
		});
	});

	it("fetches the canonical URL with a timeout signal", async () => {
		// #given
		const fetchMock = vi.fn(async () => response(200, trackPage()));
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await fetchBandcampTrack(TRACK_URL);

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			TRACK_URL,
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it.each([
		404, 410,
	])("treats a %i as unavailable, unreported", async (status) => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(status)),
		);

		// #when
		const error = await fetchBandcampTrack(TRACK_URL).catch((e) => e);

		// #then
		expect({
			isError: error instanceof BandcampTrackError,
			isUnavailable: error.isUnavailable,
			captures: vi.mocked(Sentry.captureException).mock.calls.length,
		}).toEqual({ isError: true, isUnavailable: true, captures: 0 });
	});

	it.each([
		["a 500", async () => response(500)],
		[
			"an unrecognized page",
			async () => response(200, "<html>new layout</html>"),
		],
		[
			"a network error",
			async () => {
				throw new TypeError("fetch failed");
			},
		],
		[
			"a non-Error rejection",
			async () => {
				throw "socket closed";
			},
		],
	])("reports %s once as a warning and throws a non-unavailable error", async (_label, impl) => {
		// #given
		vi.stubGlobal("fetch", vi.fn(impl));

		// #when
		const error = await fetchBandcampTrack(TRACK_URL).catch((e) => e);

		// #then
		expect({
			isError: error instanceof BandcampTrackError,
			isUnavailable: error.isUnavailable,
			captures: vi.mocked(Sentry.captureException).mock.calls.length,
		}).toEqual({ isError: true, isUnavailable: false, captures: 1 });
	});

	it("tags the capture as a warning from the bandcamp-track service", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(503)),
		);

		// #when
		await fetchBandcampTrack(TRACK_URL).catch(() => undefined);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				level: "warning",
				tags: { service: "bandcamp-track", operation: "fetch-page" },
				extra: { canonicalUrl: TRACK_URL },
			}),
		);
	});
});

describe("fetchBandcampTrack() redirects", () => {
	const TRACK_URL =
		"https://sufjanstevens.bandcamp.com/track/should-have-known-better";

	function redirect(location: string) {
		return {
			status: 301,
			ok: false,
			headers: new Headers({ location }),
			text: async () => "",
		};
	}

	beforeEach(() => {
		vi.mocked(Sentry.captureException).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("never lets fetch follow a redirect on its own", async () => {
		// #given
		const fetchMock = vi.fn(async () => response(200, trackPage()));
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await fetchBandcampTrack(TRACK_URL);

		// #then
		expect(fetchMock).toHaveBeenCalledWith(
			TRACK_URL,
			expect.objectContaining({ redirect: "manual" }),
		);
	});

	it("refuses a custom-domain redirect without requesting that domain", async () => {
		// #given
		const fetchMock = vi.fn(async () =>
			redirect("https://music.sufjan.com/track/should-have-known-better"),
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const error = await fetchBandcampTrack(TRACK_URL).catch((e) => e);

		// #then
		expect({
			userMessage: error.userMessage,
			calls: fetchMock.mock.calls.length,
			captures: vi.mocked(Sentry.captureException).mock.calls.length,
		}).toEqual({
			userMessage: BANDCAMP_CUSTOM_DOMAIN_MESSAGE,
			calls: 1,
			captures: 0,
		});
	});

	it("follows a redirect to another Bandcamp track page", async () => {
		// #given
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				redirect("https://newname.bandcamp.com/track/lanius-battle"),
			)
			.mockResolvedValueOnce(response(200, trackPage()));
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const track = await fetchBandcampTrack(TRACK_URL);

		// #then
		expect({
			title: track.title,
			secondUrl: fetchMock.mock.calls[1]?.[0],
		}).toEqual({
			title: "Lanius (Battle)",
			secondUrl: "https://newname.bandcamp.com/track/lanius-battle",
		});
	});

	it("treats a redirect to a non-track Bandcamp page as unavailable", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirect("https://sufjanstevens.bandcamp.com/music")),
		);

		// #when
		const error = await fetchBandcampTrack(TRACK_URL).catch((e) => e);

		// #then
		expect({
			isUnavailable: error.isUnavailable,
			captures: vi.mocked(Sentry.captureException).mock.calls.length,
		}).toEqual({ isUnavailable: true, captures: 0 });
	});

	it("stops after a bounded number of Bandcamp-to-Bandcamp hops", async () => {
		// #given
		const fetchMock = vi.fn(async () =>
			redirect("https://loop.bandcamp.com/track/again"),
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await fetchBandcampTrack(TRACK_URL).catch(() => undefined);

		// #then
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
