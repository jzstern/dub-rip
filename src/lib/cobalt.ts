/**
 * Cobalt API integration for YouTube audio downloads
 * Handles bot detection bypass that yt-dlp cannot handle in serverless environments
 *
 * Environment variables:
 * - COBALT_API_URL: URL of your Cobalt instance (default: public API)
 * - COBALT_API_KEY: API key for authenticated requests to self-hosted instances
 */

const COBALT_API_URL =
	process.env.COBALT_API_URL || "https://api.cobalt.tools/";
const COBALT_API_KEY = process.env.COBALT_API_KEY;
const DEFAULT_TIMEOUT = 30000;
const MAX_REDIRECTS = 5;

const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = [
	"cobalt.tools",
	"api.cobalt.tools",
	"download.cobalt.tools",
	"cdn.cobalt.tools",
];

function getAllowedDownloadHosts(): Set<string> {
	const hosts = new Set(DEFAULT_ALLOWED_DOWNLOAD_HOSTS);
	try {
		hosts.add(new URL(COBALT_API_URL).hostname);
	} catch {
		// ignore invalid env value
	}
	return hosts;
}

function isAllowedDownloadUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") {
			return false;
		}
		const allowedHosts = getAllowedDownloadHosts();
		return Array.from(allowedHosts).some(
			(host) =>
				parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
		);
	} catch {
		return false;
	}
}

export interface CobaltRequest {
	url: string;
	downloadMode: "auto" | "audio" | "mute";
	audioFormat: "best" | "mp3" | "ogg" | "wav" | "opus";
	audioBitrate?: "320" | "256" | "128" | "96" | "64" | "8";
}

export interface CobaltSuccessResponse {
	status: "tunnel" | "redirect";
	url: string;
	filename?: string;
}

export interface CobaltErrorResponse {
	status: "error";
	error: {
		code: string;
		context?: Record<string, unknown>;
	};
}

export type CobaltResponse = CobaltSuccessResponse | CobaltErrorResponse;

export class CobaltError extends Error {
	constructor(
		message: string,
		public readonly isRateLimit: boolean = false,
		public readonly isUnavailable: boolean = false,
		public readonly isAuthRequired: boolean = false,
	) {
		super(message);
		this.name = "CobaltError";
	}
}

function parseErrorCode(code: string): {
	message: string;
	isAuth: boolean;
	isRateLimit: boolean;
} {
	if (code.includes("auth")) {
		return {
			message:
				"Cobalt requires authentication. Set COBALT_API_URL to a self-hosted instance.",
			isAuth: true,
			isRateLimit: false,
		};
	}
	if (code.includes("rate")) {
		return {
			message: "Cobalt rate limit exceeded",
			isAuth: false,
			isRateLimit: true,
		};
	}
	return {
		message: `Cobalt error: ${code}`,
		isAuth: false,
		isRateLimit: false,
	};
}

export async function requestCobaltAudio(
	youtubeUrl: string,
	timeout: number = DEFAULT_TIMEOUT,
): Promise<string> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		if (COBALT_API_KEY) {
			headers["Authorization"] = `Api-Key ${COBALT_API_KEY}`;
		}

		const response = await fetch(COBALT_API_URL, {
			method: "POST",
			headers,
			body: JSON.stringify({
				url: youtubeUrl,
				downloadMode: "audio",
				audioFormat: "mp3",
				audioBitrate: "128",
			} satisfies CobaltRequest),
			signal: controller.signal,
		});

		if (response.status === 429) {
			throw new CobaltError("Cobalt rate limit exceeded", true, false, false);
		}

		if (response.status === 401 || response.status === 403) {
			throw new CobaltError(
				"Cobalt requires authentication. Set COBALT_API_URL to a self-hosted instance.",
				false,
				false,
				true,
			);
		}

		if (!response.ok) {
			throw new CobaltError(
				`Cobalt API returned status ${response.status}`,
				false,
				response.status >= 500,
				false,
			);
		}

		const data = (await response.json()) as CobaltResponse;

		if (data.status === "error") {
			const parsed = parseErrorCode(data.error.code);
			throw new CobaltError(
				parsed.message,
				parsed.isRateLimit,
				false,
				parsed.isAuth,
			);
		}

		if (data.status === "tunnel" || data.status === "redirect") {
			return data.url;
		}

		throw new CobaltError(
			`Unexpected Cobalt response status: ${(data as { status: string }).status}`,
		);
	} catch (error) {
		if (error instanceof CobaltError) {
			throw error;
		}
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new CobaltError("Cobalt request timed out", false, true, false);
			}
			throw new CobaltError(
				`Cobalt request failed: ${error.message}`,
				false,
				true,
				false,
			);
		}
		throw new CobaltError("Unknown Cobalt error", false, true, false);
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function fetchCobaltAudio(
	downloadUrl: string,
	timeout: number = 60000,
): Promise<ArrayBuffer> {
	if (!isAllowedDownloadUrl(downloadUrl)) {
		throw new CobaltError("Invalid download URL from Cobalt");
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		let currentUrl = downloadUrl;
		let redirectCount = 0;

		while (redirectCount < MAX_REDIRECTS) {
			const response = await fetch(currentUrl, {
				signal: controller.signal,
				redirect: "manual",
			});

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) {
					throw new CobaltError("Redirect without location header");
				}

				const redirectUrl = new URL(location, currentUrl).href;
				if (!isAllowedDownloadUrl(redirectUrl)) {
					throw new CobaltError("Redirect to disallowed URL blocked");
				}

				currentUrl = redirectUrl;
				redirectCount++;
				continue;
			}

			if (!response.ok) {
				throw new CobaltError(
					`Failed to download from Cobalt: ${response.status}`,
				);
			}

			return await response.arrayBuffer();
		}

		throw new CobaltError("Too many redirects");
	} catch (error) {
		if (error instanceof CobaltError) {
			throw error;
		}
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new CobaltError("Cobalt download timed out", false, true, false);
			}
			throw new CobaltError(`Cobalt download failed: ${error.message}`);
		}
		throw new CobaltError("Unknown download error");
	} finally {
		clearTimeout(timeoutId);
	}
}
