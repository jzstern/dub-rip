import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CobaltError, fetchCobaltAudio, requestCobaltAudio } from "$lib/cobalt";

describe("Cobalt API Integration", () => {
	// #given
	const mockYouTubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
	const mockDownloadUrl = "https://download.cobalt.example/audio.mp3";

	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("requestCobaltAudio()", () => {
		it("returns download URL when Cobalt responds with stream status", async () => {
			// #given
			const mockResponse = {
				status: "stream",
				url: mockDownloadUrl,
			};
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			// #when
			const result = await requestCobaltAudio(mockYouTubeUrl);

			// #then
			expect(result).toBe(mockDownloadUrl);
			expect(fetch).toHaveBeenCalledWith(
				"https://api.cobalt.tools/api/json",
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
				}),
			);
		});

		it("returns download URL when Cobalt responds with redirect status", async () => {
			// #given
			const mockResponse = {
				status: "redirect",
				url: mockDownloadUrl,
			};
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			// #when
			const result = await requestCobaltAudio(mockYouTubeUrl);

			// #then
			expect(result).toBe(mockDownloadUrl);
		});

		it("throws CobaltError with isRateLimit when receiving 429 status", async () => {
			// #given
			vi.mocked(fetch).mockResolvedValue({
				ok: false,
				status: 429,
			} as Response);

			// #when / #then
			await expect(requestCobaltAudio(mockYouTubeUrl)).rejects.toThrow(
				CobaltError,
			);

			try {
				await requestCobaltAudio(mockYouTubeUrl);
			} catch (error) {
				expect(error).toBeInstanceOf(CobaltError);
				expect((error as CobaltError).isRateLimit).toBe(true);
			}
		});

		it("throws CobaltError with isUnavailable for 5xx server errors", async () => {
			// #given
			vi.mocked(fetch).mockResolvedValue({
				ok: false,
				status: 500,
			} as Response);

			// #when / #then
			await expect(requestCobaltAudio(mockYouTubeUrl)).rejects.toThrow(
				CobaltError,
			);

			try {
				await requestCobaltAudio(mockYouTubeUrl);
			} catch (error) {
				expect(error).toBeInstanceOf(CobaltError);
				expect((error as CobaltError).isUnavailable).toBe(true);
			}
		});

		it("throws CobaltError when response has error status", async () => {
			// #given
			const mockResponse = {
				status: "error",
				text: "Video is private",
			};
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			// #when / #then
			await expect(requestCobaltAudio(mockYouTubeUrl)).rejects.toThrow(
				"Video is private",
			);
		});

		it("throws CobaltError on timeout", async () => {
			// #given
			vi.mocked(fetch).mockImplementation(
				() =>
					new Promise((_, reject) => {
						const error = new Error("The operation was aborted");
						error.name = "AbortError";
						setTimeout(() => reject(error), 10);
					}),
			);

			// #when / #then
			await expect(requestCobaltAudio(mockYouTubeUrl, 5)).rejects.toThrow(
				CobaltError,
			);
		});

		it("sends correct request body with audio-only settings", async () => {
			// #given
			const mockResponse = {
				status: "stream",
				url: mockDownloadUrl,
			};
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			// #when
			await requestCobaltAudio(mockYouTubeUrl);

			// #then
			const callArgs = vi.mocked(fetch).mock.calls[0];
			const body = JSON.parse(callArgs[1]?.body as string);
			expect(body).toEqual({
				url: mockYouTubeUrl,
				isAudioOnly: true,
				aFormat: "mp3",
			});
		});
	});

	describe("fetchCobaltAudio()", () => {
		it("returns ArrayBuffer on successful download", async () => {
			// #given
			const mockAudioData = new ArrayBuffer(1024);
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(mockAudioData),
			} as Response);

			// #when
			const result = await fetchCobaltAudio(mockDownloadUrl);

			// #then
			expect(result).toBeInstanceOf(ArrayBuffer);
			expect(result.byteLength).toBe(1024);
		});

		it("throws CobaltError on download failure", async () => {
			// #given
			vi.mocked(fetch).mockResolvedValue({
				ok: false,
				status: 404,
			} as Response);

			// #when / #then
			await expect(fetchCobaltAudio(mockDownloadUrl)).rejects.toThrow(
				CobaltError,
			);
		});

		it("throws CobaltError on network error", async () => {
			// #given
			vi.mocked(fetch).mockRejectedValue(new Error("Network failed"));

			// #when / #then
			await expect(fetchCobaltAudio(mockDownloadUrl)).rejects.toThrow(
				"Network failed",
			);
		});

		it("throws CobaltError with timeout message on abort", async () => {
			// #given
			vi.mocked(fetch).mockImplementation(
				() =>
					new Promise((_, reject) => {
						const error = new Error("The operation was aborted");
						error.name = "AbortError";
						setTimeout(() => reject(error), 10);
					}),
			);

			// #when / #then
			await expect(fetchCobaltAudio(mockDownloadUrl, 5)).rejects.toThrow(
				"timed out",
			);
		});
	});

	describe("CobaltError", () => {
		it("has correct name property", () => {
			// #when
			const error = new CobaltError("Test error");

			// #then
			expect(error.name).toBe("CobaltError");
		});

		it("preserves isRateLimit flag", () => {
			// #when
			const error = new CobaltError("Rate limited", true, false);

			// #then
			expect(error.isRateLimit).toBe(true);
			expect(error.isUnavailable).toBe(false);
		});

		it("preserves isUnavailable flag", () => {
			// #when
			const error = new CobaltError("Service down", false, true);

			// #then
			expect(error.isRateLimit).toBe(false);
			expect(error.isUnavailable).toBe(true);
		});
	});
});
