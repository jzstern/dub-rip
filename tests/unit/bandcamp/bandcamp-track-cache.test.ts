import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchBandcampTrackMock } = vi.hoisted(() => ({
	fetchBandcampTrackMock: vi.fn(),
}));

vi.mock("$lib/bandcamp/bandcamp-track", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/bandcamp/bandcamp-track")>()),
	fetchBandcampTrack: fetchBandcampTrackMock,
}));

import { BandcampTrackError } from "$lib/bandcamp/bandcamp-track";
import {
	clearBandcampTrackCache,
	getBandcampTrack,
} from "$lib/bandcamp/bandcamp-track-cache";
import type { MediaLink } from "$lib/media-link";

const LINK: MediaLink = {
	kind: "bandcamp",
	id: "benprunty/lanius-battle",
	canonicalUrl: "https://benprunty.bandcamp.com/track/lanius-battle",
};

describe("getBandcampTrack()", () => {
	beforeEach(() => {
		clearBandcampTrackCache();
		fetchBandcampTrackMock.mockReset();
	});

	it("fetches a failed track once across preview, details and download", async () => {
		// #given
		fetchBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("Failed to load track info"),
		);

		// #when
		for (let request = 0; request < 3; request++) {
			await getBandcampTrack(LINK).catch(() => undefined);
		}

		// #then
		expect(fetchBandcampTrackMock).toHaveBeenCalledTimes(1);
	});

	it("rethrows the remembered failure", async () => {
		// #given
		const failure = new BandcampTrackError("gone", true);
		fetchBandcampTrackMock.mockRejectedValue(failure);
		await getBandcampTrack(LINK).catch(() => undefined);

		// #when
		const error = await getBandcampTrack(LINK).catch((e) => e);

		// #then
		expect(error).toBe(failure);
	});

	it("fetches again once the failure has expired", async () => {
		// #given
		vi.useFakeTimers();
		fetchBandcampTrackMock.mockRejectedValue(
			new BandcampTrackError("Failed to load track info"),
		);
		await getBandcampTrack(LINK).catch(() => undefined);
		vi.advanceTimersByTime(2 * 60 * 1000 + 1);

		// #when
		await getBandcampTrack(LINK).catch(() => undefined);

		// #then
		expect(fetchBandcampTrackMock).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});
