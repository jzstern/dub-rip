import { describe, expect, it } from "vitest";
import {
	buildQueueFullClassification,
	classifyCanaryRun,
	isCanaryFailure,
} from "$lib/canary/classify-canary-run";

// The 2026-09-18 incident signature: yt-dlp does not retry a watch-page 429,
// so the run has no visitor data afterwards and the player request is
// bot-checked — the ERROR line names the second failure, never the first.
const WATCH_PAGE_429_STDERR = [
	"WARNING: [youtube] jNQXAC9IVRw: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)",
	"ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.",
].join("\n");

describe("classifyCanaryRun()", () => {
	it("classifies a successful run as ok and extracts the itag used", () => {
		// #given — production currently falls back to itag 18 (360p progressive)
		const stdout = [
			"[youtube] jNQXAC9IVRw: Downloading webpage",
			"[info] jNQXAC9IVRw: Downloading 1 format(s): 18",
			"[download] Destination: /tmp/canary-abc.mp4",
			"[download] 100% of 1.23MiB in 00:00:01",
			"[ExtractAudio] Destination: /tmp/canary-abc.mp3",
		].join("\n");

		// #when
		const result = classifyCanaryRun({
			succeeded: true,
			stdout,
			stderr: "",
			durationMs: 4200,
		});

		// #then
		expect(result).toEqual({
			stage: "ok",
			itag: "18",
			durationMs: 4200,
			detail: "Downloaded successfully using itag 18",
		});
	});

	it("classifies player_bot_check when YouTube refuses the player request before any format is chosen", () => {
		// #given — the 2026-09-14 incident signature: no format line, no PO
		// token line, and yt-dlp never learns the video's title
		const stdout =
			"[youtube] jNQXAC9IVRw: Downloading webpage\nWARNING: [youtube] jNQXAC9IVRw: No title found in player responses; falling back to title from initial data.";
		const stderr =
			"ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 1800,
		});

		// #then
		expect(result.stage).toBe("player_bot_check");
	});

	it("classifies page_rate_limited when the watch page is 429'd, even though the run ends in a bot-check", () => {
		// #given
		const stdout = "[youtube] jNQXAC9IVRw: Downloading webpage";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr: WATCH_PAGE_429_STDERR,
			durationMs: 1500,
		});

		// #then
		expect(result.stage).toBe("page_rate_limited");
	});

	it("names the watch-page 429 as the cause in the page_rate_limited detail", () => {
		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr: WATCH_PAGE_429_STDERR,
			durationMs: 1500,
		});

		// #then
		expect(result.detail).toContain(
			"rate-limited the watch page with HTTP 429",
		);
	});

	it("includes an excerpt of the raw stderr in the page_rate_limited detail", () => {
		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr: WATCH_PAGE_429_STDERR,
			durationMs: 1500,
		});

		// #then
		expect(result.detail).toContain(
			"Unable to download webpage: HTTP Error 429: Too Many Requests",
		);
	});

	it("collapses whitespace in the stderr excerpt so the detail stays on one line", () => {
		// #given
		const stderr =
			"WARNING: Unable to download webpage:\n\tHTTP Error 429:   Too Many Requests\nERROR: Sign in to confirm you’re not a bot";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr,
			durationMs: 1500,
		});

		// #then
		expect(result.detail).toContain(
			"Unable to download webpage: HTTP Error 429: Too Many Requests ERROR:",
		);
	});

	it("truncates the stderr excerpt in the page_rate_limited detail", () => {
		// #given
		const stderr = `${WATCH_PAGE_429_STDERR}\n${"padding ".repeat(200)}TAIL-MARKER`;

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr,
			durationMs: 1500,
		});

		// #then
		expect(result.detail).not.toContain("TAIL-MARKER");
	});

	it("does not treat a watch-page 429 as the cause once a format was chosen", () => {
		// #given — a format was picked and its media fetch was refused, so the
		// earlier 429 warning is not what ended the run
		const stdout = "[info] jNQXAC9IVRw: Downloading 1 format(s): 251";
		const stderr = [
			"WARNING: [youtube] jNQXAC9IVRw: Unable to download webpage: HTTP Error 429: Too Many Requests",
			"ERROR: unable to download video data: HTTP Error 403: Forbidden",
		].join("\n");

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 2500,
		});

		// #then
		expect(result.stage).toBe("media_refused");
	});

	it("includes an excerpt of the raw stderr in the player_bot_check detail", () => {
		// #given — a bot-check with no 429 anywhere in the run
		const stderr =
			"ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr,
			durationMs: 1800,
		});

		// #then
		expect(result.detail).toContain("Sign in to confirm you’re not a bot");
	});

	it("truncates the stderr excerpt in the player_bot_check detail", () => {
		// #given
		const stderr = `ERROR: Sign in to confirm you’re not a bot\n${"padding ".repeat(200)}TAIL-MARKER`;

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr,
			durationMs: 1800,
		});

		// #then
		expect(result.detail).not.toContain("TAIL-MARKER");
	});

	it("classifies media_refused when the media fetch 403s right after the format is chosen", () => {
		// #given — a format was picked but no Destination: line ever appears
		const stdout =
			"[youtube] jNQXAC9IVRw: Downloading visionos player API JSON\n[info] jNQXAC9IVRw: Downloading 1 format(s): 251";
		const stderr =
			"ERROR: unable to download video data: HTTP Error 403: Forbidden";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 2500,
		});

		// #then
		expect(result.stage).toBe("media_refused");
	});

	it("reports the itag that was refused when classifying media_refused", () => {
		// #given
		const stdout = "[info] jNQXAC9IVRw: Downloading 1 format(s): 251";
		const stderr =
			"ERROR: unable to download video data: HTTP Error 403: Forbidden";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 2500,
		});

		// #then
		expect(result.itag).toBe("251");
	});

	it("classifies fragments_refused when every HLS fragment is refused and skipped", () => {
		// #given — the 2026-09-17 incident signature: fragments start downloading
		// then every one is refused, escalating from 403 to 401, and the file
		// ends up empty
		const stdout = [
			"[info] jNQXAC9IVRw: Downloading 1 format(s): 233",
			"[hlsnative] Total fragments: 34",
			"[download] Destination: /tmp/canary-abc.mp4",
			"[download] Got error: HTTP Error 403: Forbidden. Retrying fragment 1 (attempt 1 of 10) ...",
			"[download] Got error: HTTP Error 401: Unauthorized. Retrying fragment 1 (attempt 2 of 10) ...",
			"[download] Skipping fragment 1 ...",
		].join("\n");
		const stderr = "ERROR: The downloaded file is empty";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 9000,
		});

		// #then
		expect(result.stage).toBe("fragments_refused");
	});

	it("classifies format_unavailable when YouTube forces SABR streaming", () => {
		// #given
		const stdout =
			"[youtube] jNQXAC9IVRw: YouTube is forcing SABR streaming for this client";
		const stderr = "ERROR: Requested format is not available";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 1200,
		});

		// #then
		expect(result.stage).toBe("format_unavailable");
	});

	it("classifies format_unavailable from the 'Requested format is not available' message alone", () => {
		// #given
		const stdout = "[youtube] jNQXAC9IVRw: Downloading webpage";
		const stderr = "ERROR: Requested format is not available";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 1200,
		});

		// #then
		expect(result.stage).toBe("format_unavailable");
	});

	it("classifies unknown when nothing recognizable matched", () => {
		// #given
		const stdout = "[youtube] jNQXAC9IVRw: Downloading webpage";
		const stderr = "ERROR: something bizarre happened";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout,
			stderr,
			durationMs: 500,
		});

		// #then
		expect(result.stage).toBe("unknown");
	});

	it("includes a snippet of stderr in the detail for an unknown failure", () => {
		// #given
		const stderr = "ERROR: something bizarre happened";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr,
			durationMs: 500,
		});

		// #then
		expect(result.detail).toContain("something bizarre happened");
	});

	it("carries the measured duration through on every stage", () => {
		// #given
		const stderr = "ERROR: something bizarre happened";

		// #when
		const result = classifyCanaryRun({
			succeeded: false,
			stdout: "",
			stderr,
			durationMs: 12345,
		});

		// #then
		expect(result.durationMs).toBe(12345);
	});
});

describe("buildQueueFullClassification()", () => {
	it("returns the queue_full stage with no itag", () => {
		// #given — the shared yt-dlp concurrency limiter rejected the run before
		// any process was spawned

		// #when
		const result = buildQueueFullClassification(0);

		// #then
		expect(result.stage).toBe("queue_full");
		expect(result.itag).toBeNull();
	});
});

describe("isCanaryFailure()", () => {
	it("treats page_rate_limited as a failure", () => {
		// #when
		const result = isCanaryFailure("page_rate_limited");

		// #then
		expect(result).toBe(true);
	});
});
