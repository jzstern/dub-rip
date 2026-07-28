import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractVideoId } from "$lib/video-utils";

describe("POST /api/preview/details - validation logic", () => {
	describe("URL validation", () => {
		it("extractVideoId returns null for invalid URLs", () => {
			// #given
			const invalidUrl = "https://vimeo.com/123456";

			// #when
			const result = extractVideoId(invalidUrl);

			// #then
			expect(result).toBeNull();
		});

		it("extractVideoId returns video ID for valid URLs", () => {
			// #given
			const validUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ";

			// #when
			const result = extractVideoId(validUrl);

			// #then
			expect(result).toBe("dQw4w9WgXcQ");
		});
	});

	describe("validation requirements", () => {
		it("accepts valid video ID for single video", () => {
			// #given
			const url = "https://youtube.com/watch?v=dQw4w9WgXcQ";

			// #when
			const videoId = extractVideoId(url);

			// #then
			expect(videoId).toBe("dQw4w9WgXcQ");
		});

		it("rejects invalid URL", () => {
			// #given
			const url = "https://vimeo.com/123456";

			// #when
			const videoId = extractVideoId(url);

			// #then
			expect(videoId).toBeNull();
		});
	});
});

const { execFileMock } = vi.hoisted(() => ({
	execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	default: {
		execFile: (...args: unknown[]) => execFileMock(...args),
	},
	execFile: (...args: unknown[]) => execFileMock(...args),
}));

const {
	ensureYtDlpBinaryMock,
	buildBgutilPotArgsMock,
	buildJsRuntimeArgsMock,
} = vi.hoisted(() => ({
	ensureYtDlpBinaryMock: vi.fn(),
	buildBgutilPotArgsMock: vi.fn(),
	buildJsRuntimeArgsMock: vi.fn(),
}));

vi.mock("$lib/yt-dlp-binary", () => ({
	ensureYtDlpBinary: (...args: unknown[]) => ensureYtDlpBinaryMock(...args),
	buildBgutilPotArgs: (...args: unknown[]) => buildBgutilPotArgsMock(...args),
	buildJsRuntimeArgs: (...args: unknown[]) => buildJsRuntimeArgsMock(...args),
}));

function mockYtDlpStdout(stdout: string) {
	execFileMock.mockImplementation(
		(
			_bin: string,
			_args: string[],
			_opts: unknown,
			cb: (err: Error | null, res: { stdout: string; stderr: string }) => void,
		) => {
			cb(null, { stdout, stderr: "" });
		},
	);
}

function mockYtDlpError(err: Error) {
	execFileMock.mockImplementation(
		(
			_bin: string,
			_args: string[],
			_opts: unknown,
			cb: (err: Error | null) => void,
		) => {
			cb(err);
		},
	);
}

async function importPost() {
	const mod = await import("../../../src/routes/api/preview/details/+server");
	return mod.POST;
}

function makeEvent(body: unknown) {
	return {
		request: { json: () => Promise.resolve(body) },
	} as unknown as Parameters<Awaited<ReturnType<typeof importPost>>>[0];
}

describe("POST /api/preview/details - duration extraction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureYtDlpBinaryMock.mockResolvedValue("/tmp/yt-dlp");
		buildBgutilPotArgsMock.mockResolvedValue([]);
		buildJsRuntimeArgsMock.mockReturnValue([]);
	});

	it("returns parsed duration on success", async () => {
		// #given
		mockYtDlpStdout("213\n");
		const POST = await importPost();

		// #when
		const response = await POST(
			makeEvent({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
		);
		const data = await response.json();

		// #then
		expect(data).toEqual({ success: true, duration: 213 });
	});

	it("attaches bgutil-pot args when BGUTIL_POT_URL is configured", async () => {
		// #given
		const potArgs = [
			"--plugin-dirs",
			"/tmp/yt-dlp-plugins",
			"--extractor-args",
			"youtube:player_client=web_safari,mweb,tv",
			"--extractor-args",
			"youtubepot-bgutilhttp:base_url=http://pot.internal:4416",
		];
		buildBgutilPotArgsMock.mockResolvedValue(potArgs);
		mockYtDlpStdout("100\n");
		const POST = await importPost();

		// #when
		await POST(makeEvent({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }));

		// #then
		const passedArgs = execFileMock.mock.calls[0][1] as string[];
		expect(passedArgs).toEqual(
			expect.arrayContaining([
				"--plugin-dirs",
				"/tmp/yt-dlp-plugins",
				"youtubepot-bgutilhttp:base_url=http://pot.internal:4416",
			]),
		);
	});

	it("omits bgutil-pot args when BGUTIL_POT_URL is unset", async () => {
		// #given
		buildBgutilPotArgsMock.mockResolvedValue([]);
		mockYtDlpStdout("100\n");
		const POST = await importPost();

		// #when
		await POST(makeEvent({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }));

		// #then
		const passedArgs = execFileMock.mock.calls[0][1] as string[];
		expect(passedArgs).not.toContain("--plugin-dirs");
	});

	it("returns 500 with friendly message when yt-dlp fails", async () => {
		// #given
		mockYtDlpError(new Error("Sign in to confirm you're not a bot"));
		const POST = await importPost();

		// #when
		const response = await POST(
			makeEvent({ url: "https://youtube.com/watch?v=dSA1oUhCdy8" }),
		);
		const data = await response.json();

		// #then
		expect(response.status).toBe(500);
		expect(data).toEqual({ error: "Failed to load details" });
	});

	it("returns 500 when duration output is not a number", async () => {
		// #given
		mockYtDlpStdout("NA\n");
		const POST = await importPost();

		// #when
		const response = await POST(
			makeEvent({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
		);

		// #then
		expect(response.status).toBe(500);
	});

	it("returns 400 when url is missing", async () => {
		// #given
		const POST = await importPost();

		// #when
		const response = await POST(makeEvent({}));
		const data = await response.json();

		// #then
		expect(response.status).toBe(400);
		expect(data).toEqual({ error: "URL is required" });
	});
});
