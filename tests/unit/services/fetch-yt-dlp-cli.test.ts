import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The CLI wrapper's exit code is the point of the build-time digest check. CI
 * runs `bun run build`, so a mismatch that exits 0 yields a green build with no
 * `bin/`, and the runtime then quietly falls back to downloading the binary
 * itself — turning the one signal that the bytes changed into a slightly slower
 * deploy nobody looks at.
 *
 * This suite spawns the real script rather than asserting on `downloadTo`,
 * because the behaviour under test lives in the wrapper's catch. It spawns it
 * against a copy in a temp directory because the script derives its `repoRoot`
 * from its own location: run in place it would consult, and could write to, the
 * repo's real `bin/`, which CI restores from cache and which would then satisfy
 * the digest check before the stubbed fetch was ever reached.
 *
 * Deliberately not mocking "node:fs" here — this file needs the real one.
 */
const SCRIPTS_DIR = resolve(__dirname, "../../../scripts");
const SCRIPT_FILES = ["fetch-yt-dlp.mjs", "yt-dlp-pin.mjs"];

const workspaces: string[] = [];

afterAll(() => {
	for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs the bake script in an isolated copy of `scripts/`, with `globalThis.fetch`
 * replaced by `stubBody` via a preloaded module.
 */
function runBakeWithStubbedFetch(stubBody: string): {
	status: number | null;
	output: string;
} {
	// realpathSync because the script gates its CLI branch on
	// `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`, and the
	// right-hand side is always a real path. On macOS the temp dir sits under
	// symlinked /var, so passing the unresolved path would silently run the
	// module as a no-op import and pass every exit-code assertion against 0.
	const root = realpathSync(mkdtempSync(join(tmpdir(), "fetch-yt-dlp-cli-")));
	workspaces.push(root);

	const scripts = join(root, "scripts");
	mkdirSync(scripts);
	for (const file of SCRIPT_FILES) {
		copyFileSync(join(SCRIPTS_DIR, file), join(scripts, file));
	}

	const stubPath = join(root, "stub-fetch.mjs");
	writeFileSync(stubPath, stubBody);

	const result = spawnSync(
		process.execPath,
		["--import", `file://${stubPath}`, join(scripts, "fetch-yt-dlp.mjs")],
		{ encoding: "utf-8" },
	);

	return {
		status: result.status,
		output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
	};
}

const SERVES_WRONG_BYTES = `
globalThis.fetch = async () => ({
	ok: true,
	arrayBuffer: async () => new TextEncoder().encode("not the pinned bytes").buffer,
});
`;

const GITHUB_UNREACHABLE = `
globalThis.fetch = async () => {
	throw new Error("getaddrinfo ENOTFOUND github.com");
};
`;

describe("fetch-yt-dlp CLI exit codes", () => {
	it("fails the build when a release asset does not match its pinned digest", () => {
		// #given GitHub serves bytes other than the ones pinned in the repo
		// #when
		const { status } = runBakeWithStubbedFetch(SERVES_WRONG_BYTES);

		// #then
		expect(status).toBe(1);
	});

	it("names the pin file so the failure says how to resolve it", () => {
		// #given
		// #when
		const { output } = runBakeWithStubbedFetch(SERVES_WRONG_BYTES);

		// #then
		expect(output).toContain("scripts/yt-dlp-pin.mjs");
	});

	it("still succeeds when GitHub is unreachable, leaving the bake to the runtime", () => {
		// #given an outage rather than a tampered asset
		// #when
		const { status } = runBakeWithStubbedFetch(GITHUB_UNREACHABLE);

		// #then a deploy must not break over a network failure
		expect(status).toBe(0);
	});

	it("says it is falling back to a runtime download when GitHub is unreachable", () => {
		// #given
		// #when
		const { output } = runBakeWithStubbedFetch(GITHUB_UNREACHABLE);

		// #then
		expect(output).toContain("Falling back to runtime download");
	});
});
