import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchVideoDetailsMock } = vi.hoisted(() => ({
	fetchVideoDetailsMock: vi.fn(),
}));

vi.mock("$lib/video-metadata", () => ({
	fetchVideoDetails: (...args: unknown[]) => fetchVideoDetailsMock(...args),
}));

import {
	clearVideoDetailsCache,
	getVideoDetails,
} from "$lib/video-details-cache";
import type { VideoDetails } from "$lib/video-metadata";

const SAMPLE_DETAILS: VideoDetails = { artist: "Test Artist", duration: 120 };

describe("getVideoDetails()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		clearVideoDetailsCache();
	});

	it("fetches details on a cache miss", async () => {
		// #given
		fetchVideoDetailsMock.mockResolvedValue(SAMPLE_DETAILS);

		// #when
		const result = await getVideoDetails("abc123", "https://youtu.be/abc123");

		// #then
		expect(result).toEqual(SAMPLE_DETAILS);
		expect(fetchVideoDetailsMock).toHaveBeenCalledTimes(1);
	});

	it("serves a cached value on a second call without re-fetching", async () => {
		// #given
		fetchVideoDetailsMock.mockResolvedValue(SAMPLE_DETAILS);

		// #when
		await getVideoDetails("abc123", "https://youtu.be/abc123");
		const second = await getVideoDetails("abc123", "https://youtu.be/abc123");

		// #then
		expect(second).toEqual(SAMPLE_DETAILS);
		expect(fetchVideoDetailsMock).toHaveBeenCalledTimes(1);
	});

	it("dedupes concurrent in-flight requests for the same videoId (single-flight)", async () => {
		// #given
		let resolveFetch!: (value: VideoDetails | null) => void;
		fetchVideoDetailsMock.mockReturnValue(
			new Promise((resolve) => {
				resolveFetch = resolve;
			}),
		);

		// #when
		const first = getVideoDetails("abc123", "https://youtu.be/abc123");
		const second = getVideoDetails("abc123", "https://youtu.be/abc123");
		resolveFetch(SAMPLE_DETAILS);
		const [firstResult, secondResult] = await Promise.all([first, second]);

		// #then
		expect(firstResult).toEqual(SAMPLE_DETAILS);
		expect(secondResult).toEqual(SAMPLE_DETAILS);
		expect(fetchVideoDetailsMock).toHaveBeenCalledTimes(1);
	});

	it("does not cache a failed extraction, so the next call retries", async () => {
		// #given
		fetchVideoDetailsMock.mockResolvedValueOnce(null);
		fetchVideoDetailsMock.mockResolvedValueOnce(SAMPLE_DETAILS);

		// #when
		const first = await getVideoDetails("abc123", "https://youtu.be/abc123");
		const second = await getVideoDetails("abc123", "https://youtu.be/abc123");

		// #then
		expect(first).toBeNull();
		expect(second).toEqual(SAMPLE_DETAILS);
		expect(fetchVideoDetailsMock).toHaveBeenCalledTimes(2);
	});

	it("re-fetches once the TTL has expired", async () => {
		// #given
		vi.useFakeTimers();
		fetchVideoDetailsMock.mockResolvedValue(SAMPLE_DETAILS);

		// #when
		await getVideoDetails("abc123", "https://youtu.be/abc123", { ttlMs: 1000 });
		vi.advanceTimersByTime(1001);
		await getVideoDetails("abc123", "https://youtu.be/abc123", { ttlMs: 1000 });

		// #then
		expect(fetchVideoDetailsMock).toHaveBeenCalledTimes(2);
	});

	it("keeps separate cache entries per videoId", async () => {
		// #given
		fetchVideoDetailsMock.mockResolvedValue(SAMPLE_DETAILS);

		// #when
		await getVideoDetails("videoA", "https://youtu.be/videoA");
		await getVideoDetails("videoB", "https://youtu.be/videoB");

		// #then
		expect(fetchVideoDetailsMock).toHaveBeenCalledTimes(2);
	});
});
