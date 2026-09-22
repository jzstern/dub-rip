import { describe, expect, it } from "vitest";
import { cleanUploadTitle } from "$lib/metadata/clean-upload-title";

describe("cleanUploadTitle()", () => {
	it.each([
		[
			"PREMIERE // Klaps - Se Cura [DLRVA05]",
			{ title: "Klaps - Se Cura", catalogNumber: "DLRVA05" },
		],
		[
			"TNMN - MOVING BODY [RCKLSS014] PREMIERE",
			{ title: "TNMN - MOVING BODY", catalogNumber: "RCKLSS014" },
		],
		["Premiere | THISO - Back The F Up", { title: "THISO - Back The F Up" }],
		["Premiere : ZYNK - Into The Light", { title: "ZYNK - Into The Light" }],
		[
			"PREMIERE060: SMVGGLERS x KØDA - ME FLIPA",
			{ title: "SMVGGLERS x KØDA - ME FLIPA" },
		],
		[
			"[ PREMIERE ] Kolter - Trapped (Radio Edit)",
			{ title: "Kolter - Trapped (Radio Edit)" },
		],
		[
			"PREMIERE | blk. - I Cant Fail [Reboot Records]",
			{ title: "blk. - I Cant Fail", label: "Reboot Records" },
		],
		[
			"Took me back - Jordan | GRM PREMIERE",
			{ title: "Took me back - Jordan" },
		],
		[
			"Artist - Title [Monstercat Release]",
			{ title: "Artist - Title", label: "Monstercat" },
		],
		[
			"The Chainsmokers - Don't Let Me Down ft. Daya (Hipst3r Edit)[FREE DOWNLOAD]",
			{ title: "The Chainsmokers - Don't Let Me Down ft. Daya (Hipst3r Edit)" },
		],
		["Onlynumbers - Occult / 𝐅𝐑𝐄𝐄 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃", { title: "Onlynumbers - Occult" }],
		[
			"George Loukas - On My Knees (Original Mix) Free Download",
			{ title: "George Loukas - On My Knees (Original Mix)" },
		],
		[
			"Đã Quên Rồi - Yến Lê ft Dr.A -FreeDownload",
			{ title: "Đã Quên Rồi - Yến Lê ft Dr.A" },
		],
		[
			"Pooh Shiesty - Shiesty Summer ( Official Audio )",
			{ title: "Pooh Shiesty - Shiesty Summer" },
		],
		[
			"French Montana - Unforgettable (feat. Swae Lee) (Official Audio) [HQ]",
			{ title: "French Montana - Unforgettable (feat. Swae Lee)" },
		],
		[
			"Murtaza Qizilbash | Bhool | Official Audio",
			{ title: "Murtaza Qizilbash | Bhool" },
		],
		["0 - Dj MexiCaN - Mini Mix.mp3", { title: "0 - Dj MexiCaN - Mini Mix" }],
		[
			"Kerri Chandler & Jerome Sydenham  - You're In My System",
			{ title: "Kerri Chandler & Jerome Sydenham - You're In My System" },
		],
		["Hello (Official Music Video)", { title: "Hello" }],
	])("cleans %j", (raw, expected) => {
		// #when
		const result = cleanUploadTitle(raw);

		// #then
		expect(result).toEqual(expected);
	});

	it.each([
		"Metallica - Enter Sandman (Remastered)",
		"Payphone [TWLGHT & SadBois Archive Edit 02]",
		"Avicii - Levels (VIP 2019)",
		"New Order - Blue Monday",
		"Artist - Title (New Release)",
		"Artist - Title [Single Release]",
		"Artist - Title [EP01]",
		"Artist - Title [HD1080]",
		"Song (Live at Abbey Road Recordings)",
	])("keeps version info and ordinary titles intact: %j", (raw) => {
		// #when
		const result = cleanUploadTitle(raw);

		// #then
		expect(result).toEqual({ title: raw });
	});

	it("recognises the platform's own label field in brackets", () => {
		// #given
		const raw = "Azulo - Black Sky (Zentryc) [FREE DOWNLOAD]";

		// #when
		const result = cleanUploadTitle(raw, { labelName: "Zentryc" });

		// #then
		expect(result).toEqual({ title: "Azulo - Black Sky", label: "Zentryc" });
	});

	it("never returns an empty title for a non-empty upload title", () => {
		// #when
		const result = cleanUploadTitle("[FREE DOWNLOAD]");

		// #then
		expect(result.title).toBe("[FREE DOWNLOAD]");
	});
});
