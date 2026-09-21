import { describe, expect, it } from "vitest";
import { titleFromVideoDetails } from "$lib/download-pipeline/title-from-video-details";

describe("titleFromVideoDetails()", () => {
	it("splits an 'Artist - Title' video title the way the oEmbed path does", () => {
		// #given
		const details = {
			title: "Daft Punk - One More Time (Official Video)",
			uploader: "Daft Punk",
		};

		// #when
		const result = titleFromVideoDetails(details);

		// #then
		expect(result).toEqual({
			videoTitle: "Daft Punk - One More Time (Official Video)",
			artist: "Daft Punk",
			trackTitle: "One More Time",
		});
	});

	it("prefers YouTube's structured track and artist over a title that parses wrongly", () => {
		// #given
		const details = {
			title: "One More Time (Live) | Alive 2007",
			track: "One More Time",
			artist: "Daft Punk",
			uploader: "Concert Archive",
		};

		// #when
		const result = titleFromVideoDetails(details);

		// #then
		expect(result).toEqual({
			videoTitle: "One More Time (Live) | Alive 2007",
			artist: "Daft Punk",
			trackTitle: "One More Time",
		});
	});

	it("falls back to the uploader as artist, minus a ' - Topic' suffix", () => {
		// #given
		const details = { title: "One More Time", uploader: "Daft Punk - Topic" };

		// #when
		const result = titleFromVideoDetails(details);

		// #then
		expect(result).toEqual({
			videoTitle: "One More Time",
			artist: "Daft Punk",
			trackTitle: "One More Time",
		});
	});

	it("returns an empty title when the extraction failed too, so the filename and ID3 defaults apply", () => {
		// #given
		const details = null;

		// #when
		const result = titleFromVideoDetails(details);

		// #then
		expect(result).toEqual({ videoTitle: "", artist: "", trackTitle: "" });
	});
});
