import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /api/health", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("successful health check", () => {
		it("returns ok status when dependencies load successfully", async () => {
			// #given
			vi.doMock("yt-dlp-wrap", () => ({
				default: class MockYTDlpWrap {},
			}));
			vi.doMock("@ffmpeg-installer/ffmpeg", () => ({
				default: { path: "/usr/local/bin/ffmpeg" },
			}));

			const module = await import("../../../src/routes/api/health/+server");
			const GET = module.GET;
			const event = {} as Parameters<typeof GET>[0];

			// #when
			const response = await GET(event);
			const data = await response.json();

			// #then
			expect(response.status).toBe(200);
			expect(data.status).toBe("ok");
			expect(data.ytdlp).toBe("imported");
			expect(data.ffmpeg).toBe("/usr/local/bin/ffmpeg");
			expect(data.timestamp).toBeDefined();
		});

		it("returns valid ISO timestamp", async () => {
			// #given
			vi.doMock("yt-dlp-wrap", () => ({
				default: class MockYTDlpWrap {},
			}));
			vi.doMock("@ffmpeg-installer/ffmpeg", () => ({
				default: { path: "/usr/bin/ffmpeg" },
			}));

			const module = await import("../../../src/routes/api/health/+server");
			const GET = module.GET;
			const event = {} as Parameters<typeof GET>[0];

			// #when
			const response = await GET(event);
			const data = await response.json();

			// #then
			const timestamp = new Date(data.timestamp);
			expect(timestamp.getTime()).not.toBeNaN();
		});
	});
});
