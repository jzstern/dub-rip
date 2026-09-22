import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildID3Tags } from "$lib/video-metadata";

const require = createRequire(import.meta.url);

const BASE = {
	trackTitle: "Don't Let Me Down (W&W Remix)",
	videoTitle:
		"PREMIERE // The Chainsmokers - Don't Let Me Down (W&W Remix) [RCKLSS014]",
	artist: "The Chainsmokers",
	image: null,
};

describe("buildID3Tags() credits", () => {
	it("writes label, ISRC, remixer, catalog number and source URL", () => {
		// #when
		const tags = buildID3Tags({
			...BASE,
			details: { label: "Darkroom/Interscope Records", isrc: "USUM71900764" },
			sourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
		});

		// #then
		expect(tags).toMatchObject({
			publisher: "Darkroom/Interscope Records",
			ISRC: "USUM71900764",
			remixArtist: "W&W",
			userDefinedText: [{ description: "CATALOGNUMBER", value: "RCKLSS014" }],
			audioSourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
		});
	});

	it("takes the label from the upload title when the platform gives none", () => {
		// #when
		const tags = buildID3Tags({
			...BASE,
			videoTitle: "PREMIERE | blk. - I Cant Fail [Reboot Records]",
			details: null,
		});

		// #then
		expect(tags.publisher).toBe("Reboot Records");
	});

	it("adds no credit frames when nothing names them", () => {
		// #when
		const tags = buildID3Tags({
			trackTitle: "Hello",
			videoTitle: "Adele - Hello",
			artist: "Adele",
			details: null,
			image: null,
		});

		// #then
		expect(Object.keys(tags).sort()).toEqual(
			["album", "artist", "composer", "performerInfo", "title"].sort(),
		);
	});

	it("round-trips every new frame through node-id3", () => {
		// #given
		const NodeID3 = require("node-id3");
		const tags = buildID3Tags({
			...BASE,
			details: { label: "Reboot Records", isrc: "USUM71900764" },
			sourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
		});

		// #when
		const read = NodeID3.read(NodeID3.write(tags, Buffer.alloc(0)));

		// #then
		expect(read).toMatchObject({
			publisher: "Reboot Records",
			ISRC: "USUM71900764",
			remixArtist: "W&W",
			audioSourceUrl: "https://soundcloud.com/wandw/dont-let-me-down",
			userDefinedText: [{ description: "CATALOGNUMBER", value: "RCKLSS014" }],
		});
	});
});
