import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSoundCloudTrackMock } = vi.hoisted(() => ({
	getSoundCloudTrackMock: vi.fn(),
}));
const mockEnv = vi.hoisted(
	() => ({ BGUTIL_POT_URL: "http://bgutil" }) as Record<string, string>,
);

vi.mock("$env/dynamic/private", () => ({ env: mockEnv }));
vi.mock("$lib/soundcloud/soundcloud-track-cache", () => ({
	getSoundCloudTrack: getSoundCloudTrackMock,
}));
vi.mock("$lib/artwork", () => ({
	resolveArtworkUrl: vi.fn(async () => "https://store/art.jpg"),
}));
vi.mock("$lib/youtube-metadata", () => ({
	fetchYouTubeMetadata: vi.fn(),
	YouTubeMetadataError: class extends Error {},
}));

import { resolveArtworkUrl } from "$lib/artwork";
import { SOUNDCLOUD_PREVIEW_ONLY_MESSAGE } from "$lib/soundcloud/soundcloud-metadata";
import {
	type SoundCloudTrack,
	SoundCloudTrackError,
} from "$lib/soundcloud/soundcloud-track";
import { fetchYouTubeMetadata } from "$lib/youtube-metadata";
import { POST as previewPOST } from "../../../src/routes/api/preview/+server";
import { POST as detailsPOST } from "../../../src/routes/api/preview/details/+server";

const TRACK: SoundCloudTrack = {
	title: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
	uploader: "MERCILESS",
	creditedArtist: "blk.",
	artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
	avatarUrl: "https://i1.sndcdn.com/avatars-x-t500x500.jpg",
	durationSeconds: 201,
	isPreviewOnly: false,
	isGeoBlocked: false,
};

/** `never` because the preview and details handlers type their events by different route IDs. */
function eventFor(url: string): never {
	return { request: { json: async () => ({ url }) } } as never;
}

describe("POST /api/preview — SoundCloud", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSoundCloudTrackMock.mockResolvedValue(TRACK);
	});

	it("previews the resolved identity with the upload's own artwork", async () => {
		// #when
		const response = await previewPOST(
			eventFor("https://soundcloud.com/mercilessbeats/i-cant-fail"),
		);

		// #then
		expect(await response.json()).toEqual({
			success: true,
			videoTitle: TRACK.title,
			artist: "blk.",
			title: "I Cant Fail",
			thumbnail: TRACK.artworkUrl,
			artwork: TRACK.artworkUrl,
			duration: 201,
		});
		expect(resolveArtworkUrl).not.toHaveBeenCalled();
		expect(fetchYouTubeMetadata).not.toHaveBeenCalled();
	});

	it("searches the stores only when the upload has no artwork", async () => {
		// #given
		getSoundCloudTrackMock.mockResolvedValue({
			...TRACK,
			artworkUrl: undefined,
		});

		// #when
		const data = await (
			await previewPOST(eventFor("https://soundcloud.com/a/b"))
		).json();

		// #then
		expect(data).toMatchObject({
			thumbnail: TRACK.avatarUrl,
			artwork: "https://store/art.jpg",
		});
	});

	it("refuses a Go+ preview up front", async () => {
		// #given
		getSoundCloudTrackMock.mockResolvedValue({ ...TRACK, isPreviewOnly: true });

		// #when
		const response = await previewPOST(eventFor("https://soundcloud.com/a/b"));

		// #then
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error: SOUNDCLOUD_PREVIEW_ONLY_MESSAGE,
		});
	});

	it("answers 404 for an unavailable track", async () => {
		// #given
		getSoundCloudTrackMock.mockRejectedValue(
			new SoundCloudTrackError("gone", true),
		);

		// #when
		const response = await previewPOST(
			eventFor("https://soundcloud.com/a/gone"),
		);

		// #then
		expect(response.status).toBe(404);
	});

	it("never prewarms bgutil-pot for SoundCloud", async () => {
		// #given
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		// #when
		await previewPOST(eventFor("https://soundcloud.com/a/b"));

		// #then
		expect(fetchMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});

describe("POST /api/preview/details — SoundCloud", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSoundCloudTrackMock.mockResolvedValue(TRACK);
	});

	it("returns the duration from the cached track, with no yt-dlp run", async () => {
		// #when
		const response = await detailsPOST(eventFor("https://soundcloud.com/a/b"));

		// #then
		expect(await response.json()).toEqual({ success: true, duration: 201 });
	});

	it("returns 200 with no duration field when the oEmbed fallback found the track but no duration", async () => {
		// #given
		getSoundCloudTrackMock.mockResolvedValue({
			...TRACK,
			durationSeconds: undefined,
		});

		// #when
		const response = await detailsPOST(eventFor("https://soundcloud.com/a/b"));

		// #then
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
	});
});
