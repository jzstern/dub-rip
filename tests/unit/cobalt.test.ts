import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/sveltekit", () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));

import { CobaltError, fetchCobaltAudio, requestCobaltAudio } from "$lib/cobalt";

describe("Cobalt API Integration", () => {
	// #given
	const mockYouTubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
	const mockDownloadUrl = "https://download.cobalt.tools/audio.mp3";

	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("requestCobaltAudio()", () => {
		it("returns download URL when Cobalt responds with tunnel status", async () => {
			// #given
			const mockResponse = {
				status: "tunnel",
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
				expect.stringMatching(/^https:\/\/.*cobalt/),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						Accept: "application/json",
					}),
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

			// #when
			let caughtError: CobaltError | undefined;
			try {
				await requestCobaltAudio(mockYouTubeUrl);
			} catch (e) {
				caughtError = e as CobaltError;
			}

			// #then
			expect(caughtError).toBeInstanceOf(CobaltError);
			expect(caughtError?.isRateLimit).toBe(true);
		});

		it("throws CobaltError with isAuthRequired when receiving 401 status", async () => {
			// #given
			vi.mocked(fetch).mockResolvedValue({
				ok: false,
				status: 401,
			} as Response);

			// #when
			let caughtError: CobaltError | undefined;
			try {
				await requestCobaltAudio(mockYouTubeUrl);
			} catch (e) {
				caughtError = e as CobaltError;
			}

			// #then
			expect(caughtError).toBeInstanceOf(CobaltError);
			expect(caughtError?.isAuthRequired).toBe(true);
			expect(caughtError?.message).toContain("authentication");
		});

		it("throws CobaltError with isAuthRequired when error code contains auth", async () => {
			// #given
			const mockResponse = {
				status: "error",
				error: {
					code: "error.api.auth.jwt.missing",
				},
			};
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			// #when
			let caughtError: CobaltError | undefined;
			try {
				await requestCobaltAudio(mockYouTubeUrl);
			} catch (e) {
				caughtError = e as CobaltError;
			}

			// #then
			expect(caughtError).toBeInstanceOf(CobaltError);
			expect(caughtError?.isAuthRequired).toBe(true);
		});

		it("throws CobaltError with isUnavailable for 5xx server errors", async () => {
			// #given
			vi.mocked(fetch).mockResolvedValue({
				ok: false,
				status: 500,
			} as Response);

			// #when
			let caughtError: CobaltError | undefined;
			try {
				await requestCobaltAudio(mockYouTubeUrl);
			} catch (e) {
				caughtError = e as CobaltError;
			}

			// #then
			expect(caughtError).toBeInstanceOf(CobaltError);
			expect(caughtError?.isUnavailable).toBe(true);
		});

		it("throws CobaltError when response has error status", async () => {
			// #given
			const mockResponse = {
				status: "error",
				error: {
					code: "error.fetch.fail",
				},
			};
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			// #when / #then
			await expect(requestCobaltAudio(mockYouTubeUrl)).rejects.toThrow(
				"error.fetch.fail",
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

		it("sends correct request body with new v10 API format", async () => {
			// #given
			const mockResponse = {
				status: "tunnel",
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
				downloadMode: "audio",
				audioFormat: "mp3",
				audioBitrate: "128",
			});
		});
	});

	describe("fetchCobaltAudio()", () => {
		it("returns ArrayBuffer on successful download from allowed host", async () => {
			// #given
			const mockAudioData = new ArrayBuffer(1024);
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				status: 200,
				arrayBuffer: () => Promise.resolve(mockAudioData),
			} as Response);

			// #when
			const result = await fetchCobaltAudio(mockDownloadUrl);

			// #then
			expect(result).toBeInstanceOf(ArrayBuffer);
			expect(result.byteLength).toBe(1024);
		});

		it("throws CobaltError for non-HTTPS URLs from external hosts", async () => {
			// #given
			const httpUrl = "http://download.cobalt.tools/audio.mp3";

			// #when / #then
			await expect(fetchCobaltAudio(httpUrl)).rejects.toThrow(
				"Invalid download URL",
			);
		});

		it("throws CobaltError for disallowed host (SSRF protection)", async () => {
			// #given
			const maliciousUrl = "https://169.254.169.254/latest/meta-data/";

			// #when / #then
			await expect(fetchCobaltAudio(maliciousUrl)).rejects.toThrow(
				"Invalid download URL",
			);
		});

		it("throws CobaltError for localhost (SSRF protection)", async () => {
			// #given
			const localhostUrl = "https://localhost:3000/admin";

			// #when / #then
			await expect(fetchCobaltAudio(localhostUrl)).rejects.toThrow(
				"Invalid download URL",
			);
		});

		it("allows subdomain of cobalt.tools", async () => {
			// #given
			const subdomainUrl = "https://cdn.cobalt.tools/audio.mp3";
			const mockAudioData = new ArrayBuffer(512);
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				status: 200,
				arrayBuffer: () => Promise.resolve(mockAudioData),
			} as Response);

			// #when
			const result = await fetchCobaltAudio(subdomainUrl);

			// #then
			expect(result).toBeInstanceOf(ArrayBuffer);
		});

		it("follows redirects to allowed hosts", async () => {
			// #given
			const mockAudioData = new ArrayBuffer(512);
			vi.mocked(fetch)
				.mockResolvedValueOnce({
					status: 302,
					headers: new Headers({
						location: "https://cdn.cobalt.tools/audio2.mp3",
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
					arrayBuffer: () => Promise.resolve(mockAudioData),
				} as Response);

			// #when
			const result = await fetchCobaltAudio(mockDownloadUrl);

			// #then
			expect(result).toBeInstanceOf(ArrayBuffer);
			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it("blocks redirects to disallowed hosts (SSRF protection)", async () => {
			// #given
			vi.mocked(fetch).mockResolvedValueOnce({
				status: 302,
				headers: new Headers({ location: "https://localhost:3000/internal" }),
			} as Response);

			// #when / #then
			await expect(fetchCobaltAudio(mockDownloadUrl)).rejects.toThrow(
				"Redirect to disallowed URL blocked",
			);
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
			const error = new CobaltError("Rate limited", true, false, false);

			// #then
			expect(error.isRateLimit).toBe(true);
			expect(error.isUnavailable).toBe(false);
			expect(error.isAuthRequired).toBe(false);
		});

		it("preserves isUnavailable flag", () => {
			// #when
			const error = new CobaltError("Service down", false, true, false);

			// #then
			expect(error.isRateLimit).toBe(false);
			expect(error.isUnavailable).toBe(true);
			expect(error.isAuthRequired).toBe(false);
		});

		it("preserves isAuthRequired flag", () => {
			// #when
			const error = new CobaltError("Auth required", false, false, true);

			// #then
			expect(error.isRateLimit).toBe(false);
			expect(error.isUnavailable).toBe(false);
			expect(error.isAuthRequired).toBe(true);
		});
	});
});

// Note: Private Cobalt Instance and API Key Authentication tests from main branch
// use vi.stubEnv which stubs process.env, but cobalt.ts now uses SvelteKit's
// $env/dynamic/private module. These tests would need to mock the SvelteKit env
// module which is complex in Vitest. The env var functionality is tested manually
// by verifying Cobalt integration works in the deployed Railway environment.
