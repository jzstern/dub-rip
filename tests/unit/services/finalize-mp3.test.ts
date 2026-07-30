import { describe, expect, it } from "vitest";
import {
	buildDownloadFilename,
	sanitizeFilenameSegment,
} from "$lib/download-pipeline/finalize-mp3";

describe("sanitizeFilenameSegment()", () => {
	it("strips characters that are unsafe in a filesystem path", () => {
		// #given
		const value = 'a<b>c:d"e/f\\g|h?i*j';

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("abcdefghij");
	});

	it("strips ASCII control characters", () => {
		// #given — NUL, unit separator, and DEL, built via fromCharCode so the
		// source file carries no literal control bytes
		const control = String.fromCharCode(0x00, 0x1f, 0x7f);
		const value = `Bad${control}Name${control}With${control}Controls`;

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("BadNameWithControls");
	});

	it("strips a leading dot so the result can't become a hidden file", () => {
		// #given
		const value = "...hidden name";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("hidden name");
	});

	it("strips a leading dot exposed after unsafe characters before it are removed", () => {
		// #given
		const value = "<.hidden";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("hidden");
	});

	it("trims surrounding whitespace", () => {
		// #given
		const value = "  padded title  ";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("padded title");
	});

	it("returns an empty string when every character is unsafe", () => {
		// #given
		const value = "///";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe("");
	});

	it("leaves an ordinary title unchanged", () => {
		// #given
		const value = "Never Gonna Give You Up";

		// #when
		const result = sanitizeFilenameSegment(value);

		// #then
		expect(result).toBe(value);
	});
});

describe("buildDownloadFilename()", () => {
	it("builds 'Artist - Track.mp3' when both are present", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "Rick Astley",
			trackTitle: "Never Gonna Give You Up",
			videoTitle: "Rick Astley - Never Gonna Give You Up (Official Video)",
		});

		// #then
		expect(result).toBe("Rick Astley - Never Gonna Give You Up.mp3");
	});

	it("falls back to the video title when artist or track is missing", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: "Some Uploaded Video",
		});

		// #then
		expect(result).toBe("Some Uploaded Video.mp3");
	});

	it("falls back to 'audio.mp3' when nothing is usable", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: "",
		});

		// #then
		expect(result).toBe("audio.mp3");
	});

	it("sanitizes unsafe characters out of the artist and track", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "Bad/Artist",
			trackTitle: "Bad*Track",
			videoTitle: "irrelevant",
		});

		// #then
		expect(result).toBe("BadArtist - BadTrack.mp3");
	});

	it("sanitizes a leading dot out of the video title", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: ".hidden-video-title",
		});

		// #then
		expect(result).toBe("hidden-video-title.mp3");
	});

	it("falls back to 'audio.mp3' when the video title sanitizes down to empty", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "",
			trackTitle: "",
			videoTitle: "///",
		});

		// #then
		expect(result).toBe("audio.mp3");
	});

	it("falls back to the video title when the artist sanitizes down to empty", () => {
		// #given / #when
		const result = buildDownloadFilename({
			artist: "///",
			trackTitle: "Track",
			videoTitle: "Video Title",
		});

		// #then
		expect(result).toBe("Video Title.mp3");
	});
});
