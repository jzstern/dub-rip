import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJsRuntimeArgs } from "$lib/yt-dlp-binary";

/**
 * Regression guard for the "JS runtimes: none" production outage.
 *
 * yt-dlp enables only Deno by default. Our image ships Node and no Deno, so
 * without these args yt-dlp cannot solve YouTube's `n` challenge and every
 * download dies with "Only images are available for download".
 */
describe("buildJsRuntimeArgs()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function stubExecPath(path: string) {
		vi.spyOn(process, "execPath", "get").mockReturnValue(path);
	}

	it("points yt-dlp at the Node binary running this process", () => {
		// #given
		stubExecPath("/usr/local/bin/node");

		// #when
		const args = buildJsRuntimeArgs();

		// #then
		expect(args).toEqual(["--js-runtimes", "node:/usr/local/bin/node"]);
	});

	it("names bun as the runtime when the app runs under Bun", () => {
		// #given
		stubExecPath("/home/user/.bun/bin/bun");

		// #when
		const args = buildJsRuntimeArgs();

		// #then
		expect(args).toEqual(["--js-runtimes", "bun:/home/user/.bun/bin/bun"]);
	});

	it("falls back to a PATH lookup for an unrecognized interpreter", () => {
		// #given
		stubExecPath("/opt/weird/interpreter");

		// #when
		const args = buildJsRuntimeArgs();

		// #then
		expect(args).toEqual(["--js-runtimes", "node"]);
	});

	it("always enables a runtime, since yt-dlp defaults to Deno only", () => {
		// #given
		stubExecPath("/usr/bin/node");

		// #when
		const args = buildJsRuntimeArgs();

		// #then
		expect(args[0]).toBe("--js-runtimes");
	});
});
