import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/yt-dlp-binary", () => ({
	buildJsRuntimeArgs: vi.fn(() => ["--js-runtimes", "node:/usr/bin/node"]),
}));

// The shared setup mock has no addBreadcrumb; warning handling needs one.
vi.mock("@sentry/sveltekit", () => ({
	addBreadcrumb: vi.fn(),
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	init: vi.fn(),
}));

import * as Sentry from "@sentry/sveltekit";
import {
	tryYtDlpDownload,
	type YtDlpInstance,
} from "$lib/download-pipeline/try-yt-dlp";

type Handler = (...args: unknown[]) => void;

class FakeProcess {
	handlers: Record<string, Handler[]> = {};
	stderrHandlers: Handler[] = [];
	stderr = {
		on: (_event: string, callback: Handler) => {
			this.stderrHandlers.push(callback);
		},
	};

	on(event: string, callback: Handler) {
		this.handlers[event] ??= [];
		this.handlers[event].push(callback);
	}

	emit(event: string, ...args: unknown[]) {
		for (const handler of this.handlers[event] ?? []) handler(...args);
	}

	emitStderr(text: string) {
		for (const handler of this.stderrHandlers) handler(Buffer.from(text));
	}
}

const BOT_CHECK_STDERR =
	"ERROR: [youtube] q9lZ4p5YRkY: Sign in to confirm you're not a bot.\n";

const PO_TOKEN_WARNING_STDERR =
	"WARNING: [youtube] q9lZ4p5YRkY: mweb client https formats require a GVS PO Token which was not provided. They will be skipped as they may yield HTTP Error 403.\n";

describe("tryYtDlpDownload()", () => {
	let proc: FakeProcess;
	let execArgs: string[];
	let sent: Record<string, unknown>[];
	let ytDlp: YtDlpInstance;

	beforeEach(() => {
		vi.mocked(Sentry.addBreadcrumb).mockClear();
		proc = new FakeProcess();
		execArgs = [];
		sent = [];
		ytDlp = {
			exec: (args: string[]) => {
				execArgs = args;
				return proc as unknown as ReturnType<YtDlpInstance["exec"]>;
			},
		} as YtDlpInstance;
	});

	function run() {
		return tryYtDlpDownload({
			videoUrl: "https://www.youtube.com/watch?v=q9lZ4p5YRkY",
			outputPath: "/tmp/out",
			bgutilPotUrl: "http://bgutil-pot.railway.internal:4416",
			ffmpegPath: "/usr/bin/ffmpeg",
			pluginDir: "/tmp/yt-dlp-plugins",
			debugMode: false,
			ytDlp,
			titleState: {
				videoTitle: "",
				artist: "",
				trackTitle: "",
				uploader: "",
			},
			send: (data) => sent.push(data),
		});
	}

	it("enables a JS runtime so yt-dlp can solve YouTube's n challenge", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);
		await promise;

		// #then
		expect(execArgs).toEqual(
			expect.arrayContaining(["--js-runtimes", "node:/usr/bin/node"]),
		);
	});

	it("selects formats only from clients bgutil can mint a WebPO token for", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);
		await promise;

		// #then
		const clientArg = execArgs.find((arg) =>
			arg.startsWith("youtube:player_client="),
		);
		expect(clientArg).toBe("youtube:player_client=web_safari,mweb,tv");
	});

	it("never falls back to yt-dlp's default chain, whose visionos/android_vr formats 403", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);
		await promise;

		// #then
		const clientArg = execArgs.find((arg) =>
			arg.startsWith("youtube:player_client="),
		);
		expect(clientArg).not.toMatch(/default|visionos|android_vr/);
	});

	it("prefers an audio-only stream and caps the fallback at 360p", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);
		await promise;

		// #then
		expect(execArgs[execArgs.indexOf("-f") + 1]).toBe(
			"bestaudio[vcodec=none]/bestaudio/18/best[height<=360]/best",
		);
	});

	it("fetches fragmented fallback formats in parallel", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);
		await promise;

		// #then
		expect(execArgs[execArgs.indexOf("--concurrent-fragments") + 1]).toBe("4");
	});

	it("skips metadata postprocessors that NodeID3.write would overwrite anyway", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);
		await promise;

		// #then
		expect(execArgs).toEqual(
			expect.not.arrayContaining([
				"--embed-thumbnail",
				"--add-metadata",
				"--parse-metadata",
			]),
		);
	});

	it("leaves warnings visible so skipped-format diagnostics reach the logs", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);
		await promise;

		// #then
		expect(execArgs).not.toContain("--no-warnings");
	});

	it("records a Sentry breadcrumb for each yt-dlp warning", async () => {
		// #given
		const promise = run();

		// #when
		proc.emitStderr(PO_TOKEN_WARNING_STDERR);
		proc.emit("close", 0);
		await promise;

		// #then
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "yt-dlp",
				level: "warning",
				message: expect.stringContaining("GVS PO Token"),
			}),
		);
	});

	it("treats a warning-only stderr as success when yt-dlp exits cleanly", async () => {
		// #given
		const promise = run();

		// #when
		proc.emitStderr(PO_TOKEN_WARNING_STDERR);
		proc.emit("close", 0);

		// #then
		await expect(promise).resolves.toBeUndefined();
	});

	it("keeps warnings out of the rejection message when yt-dlp also errors", async () => {
		// #given
		const promise = run();

		// #when
		proc.emitStderr(PO_TOKEN_WARNING_STDERR);
		proc.emitStderr(BOT_CHECK_STDERR);
		proc.emit("close", 1);

		// #then
		await expect(promise).rejects.toThrow(new Error(BOT_CHECK_STDERR));
	});

	it("resolves when yt-dlp exits cleanly", async () => {
		// #given
		const promise = run();

		// #when
		proc.emit("close", 0);

		// #then
		await expect(promise).resolves.toBeUndefined();
	});

	it("rejects with the captured stderr when yt-dlp exits non-zero", async () => {
		// #given
		const promise = run();

		// #when
		proc.emitStderr(BOT_CHECK_STDERR);
		proc.emit("close", 1);

		// #then
		await expect(promise).rejects.toThrow(/not a bot/);
	});

	it("emits no error event of its own, leaving that to the single caller-side handler", async () => {
		// #given
		const promise = run();

		// #when
		proc.emitStderr(BOT_CHECK_STDERR);
		proc.emit("error", new Error("spawn failed"));
		proc.emit("close", 1);
		await promise.catch(() => {});

		// #then
		expect(sent.filter((event) => event.type === "error")).toHaveLength(0);
	});
});

describe("tryYtDlpDownload() concurrency limiting", () => {
	function runAgainst(process: FakeProcess) {
		const ytDlp: YtDlpInstance = {
			exec: () => process as unknown as ReturnType<YtDlpInstance["exec"]>,
		} as YtDlpInstance;

		return tryYtDlpDownload({
			videoUrl: "https://www.youtube.com/watch?v=q9lZ4p5YRkY",
			outputPath: "/tmp/out",
			bgutilPotUrl: "http://bgutil-pot.railway.internal:4416",
			ffmpegPath: "/usr/bin/ffmpeg",
			pluginDir: "/tmp/yt-dlp-plugins",
			debugMode: false,
			ytDlp,
			titleState: { videoTitle: "", artist: "", trackTitle: "", uploader: "" },
			send: () => {},
		});
	}

	function flushMicrotasks() {
		return new Promise<void>((resolve) => setTimeout(resolve, 0));
	}

	it("queues a download past the global concurrency limit until a slot frees up", async () => {
		// #given — MAX_CONCURRENT_YT_DLP_PROCESSES is 3; start 4 downloads and
		// leave every process open (no "close" emitted yet).
		const processes = Array.from({ length: 4 }, () => new FakeProcess());
		const promises = processes.map((p) => runAgainst(p));
		await flushMicrotasks();

		// #when — the 4th caller is still queued, so its process never received
		// any listeners because tryYtDlpDownload hasn't called ytDlp.exec for it
		const fourthHasListeners = Object.keys(processes[3].handlers).length > 0;

		// #then
		expect(fourthHasListeners).toBe(false);

		// #cleanup — release the first three so the 4th can run and the test
		// doesn't leak a queued promise into later tests.
		for (const p of processes.slice(0, 3)) p.emit("close", 0);
		await flushMicrotasks();
		processes[3].emit("close", 0);
		await Promise.all(promises);
	});
});
