// The bgutil-pot plugin (baked into the app image) and the bgutil-pot sidecar
// (declared in railway.toml) speak a versioned protocol. The 2.0.0 plugin
// hard-fails at runtime on a major-version mismatch with the server, so this
// test encodes that drift invariant in-repo: the image tag in railway.toml
// and BGUTIL_PLUGIN_VERSION must always move together in the same commit.
//
// This cannot catch "YouTube rejects this version's tokens" — that is
// upstream state, not something a repo-local test can know.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BGUTIL_PLUGIN_VERSION } from "../../../scripts/yt-dlp-pin.mjs";

describe("bgutil-pot version lockstep", () => {
	it("keeps the railway.toml image tag equal to BGUTIL_PLUGIN_VERSION", () => {
		// #given
		const railwayToml = readFileSync(
			join(process.cwd(), "railway.toml"),
			"utf-8",
		);

		// #when
		const match = railwayToml.match(
			/brainicism\/bgutil-ytdlp-pot-provider:([^@"]+)@sha256:([0-9a-f]+)/,
		);
		if (!match) {
			throw new Error(
				"could not find a pinned brainicism/bgutil-ytdlp-pot-provider image reference in railway.toml",
			);
		}
		const [, imageTag] = match;

		// #then
		expect(imageTag).toBe(BGUTIL_PLUGIN_VERSION);
	});
});
