import { describe, expect, it } from "vitest";
import {
	SOUNDCLOUD_GEO_BLOCKED_MESSAGE,
	SOUNDCLOUD_PREVIEW_ONLY_MESSAGE,
	soundCloudDetails,
	soundCloudRefusal,
	soundCloudTitleState,
} from "$lib/soundcloud/soundcloud-metadata";
import type { SoundCloudTrack } from "$lib/soundcloud/soundcloud-track";

const BAD_GUY: SoundCloudTrack = {
	title: "bad guy",
	uploader: "Billie Eilish",
	creditedArtist: "Billie Eilish",
	albumTitle: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
	isrc: "USUM71900764",
	labelName: "Darkroom/Interscope Records",
	genre: "Alternative",
	releaseDate: "2019-03-29T00:00:00Z",
	durationSeconds: 194,
	artworkUrl: "https://i1.sndcdn.com/artworks-wYvZZqKhgYd1-0-t500x500.jpg",
	isPreviewOnly: false,
	isGeoBlocked: false,
};

describe("soundCloudTitleState()", () => {
	it("resolves identity from the title, credit and uploader", () => {
		// #when
		const state = soundCloudTitleState({
			...BAD_GUY,
			title: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
			uploader: "MERCILESS",
			creditedArtist: "blk.",
		});

		// #then
		expect(state).toEqual({
			videoTitle: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
			artist: "blk.",
			trackTitle: "I Cant Fail",
		});
	});
});

describe("soundCloudDetails()", () => {
	it("maps album, year, genre, label, ISRC and duration", () => {
		// #when
		const details = soundCloudDetails(BAD_GUY);

		// #then
		expect(details).toEqual({
			year: 2019,
			genre: "Alternative",
			album: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
			composer: undefined,
			duration: 194,
			label: "Darkroom/Interscope Records",
			isrc: "USUM71900764",
		});
	});

	it("never sets track or artist, which would override the resolved identity", () => {
		// #when
		const details = soundCloudDetails(BAD_GUY);

		// #then
		expect(Object.keys(details)).not.toContain("artist");
		expect(Object.keys(details)).not.toContain("track");
	});
});

describe("soundCloudRefusal()", () => {
	it.each([
		[{ isPreviewOnly: true }, SOUNDCLOUD_PREVIEW_ONLY_MESSAGE],
		[{ isGeoBlocked: true }, SOUNDCLOUD_GEO_BLOCKED_MESSAGE],
		[{}, null],
	])("refuses %j with %j", (overrides, expected) => {
		// #when
		const refusal = soundCloudRefusal({ ...BAD_GUY, ...overrides });

		// #then
		expect(refusal).toBe(expected);
	});
});
