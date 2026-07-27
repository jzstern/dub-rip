import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/yt-dlp-binary", () => ({
	buildJsRuntimeArgs: vi.fn(() => ["--js-runtimes", "node:/usr/bin/node"]),
}));

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

describe("tryYtDlpDownload()", () => {
	let proc: FakeProcess;
	let execArgs: string[];
	let sent: Record<string, unknown>[];
	let ytDlp: YtDlpInstance;

	beforeEach(() => {
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
