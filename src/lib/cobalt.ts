/**
 * Cobalt API integration for YouTube audio downloads
 * Handles bot detection bypass that yt-dlp cannot handle in serverless environments
 *
 * Environment variables:
 * - COBALT_API_URL: URL of your Cobalt instance (default: public API)
 * - COBALT_API_KEY: API key for authenticated requests to self-hosted instances
 * - COBALT_TUNNEL_HOST: Public hostname for Cobalt tunnel URLs (needed when using
 *   internal API URL but Cobalt returns public tunnel URLs)
 */

import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/private";
import { extractVideoId } from "$lib/video-utils";

function getCobaltApiUrl(): string {
	return env.COBALT_API_URL || "https://api.cobalt.tools/";
}

function getCobaltApiKey(): string | undefined {
	return env.COBALT_API_KEY;
}

function getCobaltTunnelHost(): string | undefined {
	return env.COBALT_TUNNEL_HOST;
}

const DEFAULT_TIMEOUT = 30000;
const MAX_REDIRECTS = 5;

const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = [
	"cobalt.tools",
	"api.cobalt.tools",
	"download.cobalt.tools",
	"cdn.cobalt.tools",
];

const PRIVATE_HOSTNAME_PATTERNS = [
	/\.internal$/,
	/\.railway\.internal$/,
	/^localhost$/,
	/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
	/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
	/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
	/^192\.168\.\d{1,3}\.\d{1,3}$/,
];

function isPrivateHostname(hostname: string): boolean {
	return PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isPrivateCobaltInstance(): boolean {
	try {
		const parsed = new URL(getCobaltApiUrl());
		if (parsed.protocol !== "http:") {
			return false;
		}
		return isPrivateHostname(parsed.hostname);
	} catch {
		return false;
	}
}

function getAllowedDownloadHosts(): Set<string> {
	const hosts = new Set(DEFAULT_ALLOWED_DOWNLOAD_HOSTS);
	try {
		hosts.add(new URL(getCobaltApiUrl()).hostname);
	} catch {
		// ignore invalid env value
	}
	const tunnelHost = getCobaltTunnelHost();
	if (tunnelHost) {
		hosts.add(tunnelHost);
	}
	return hosts;
}

function isAllowedDownloadUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const isPrivate = isPrivateCobaltInstance();
		if (!isPrivate && parsed.protocol !== "https:") {
			return false;
		}
		if (
			isPrivate &&
			parsed.protocol !== "http:" &&
			parsed.protocol !== "https:"
		) {
			return false;
		}
		const allowedHosts = getAllowedDownloadHosts();
		const cobaltHostname = new URL(getCobaltApiUrl()).hostname;
		return Array.from(allowedHosts).some((host) => {
			if (parsed.hostname === host) {
				return true;
			}
			if (host === cobaltHostname && isPrivateHostname(host)) {
				return parsed.hostname === host;
			}
			return parsed.hostname.endsWith(`.${host}`);
		});
	} catch {
		return false;
	}
}

function safeVideoId(youtubeUrl: string): string {
	return extractVideoId(youtubeUrl) || "unknown";
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
		public readonly errorCode?: string,
	) {
		super(message);
		this.name = "CobaltError";
	}
}

interface ParsedErrorCode {
	message: string;
	isAuth: boolean;
	isRateLimit: boolean;
	isUnavailable: boolean;
}

function parseErrorCode(code: string): ParsedErrorCode {
	if (code.includes("auth")) {
		return {
			message:
				"Cobalt requires authentication. Set COBALT_API_URL to a self-hosted instance.",
			isAuth: true,
			isRateLimit: false,
			isUnavailable: false,
		};
	}
	if (code.includes("rate")) {
		return {
			message: "Cobalt rate limit exceeded",
			isAuth: false,
			isRateLimit: true,
			isUnavailable: false,
		};
	}
	if (
		code.includes("video.unavailable") ||
		code.includes("content.unavailable")
	) {
		return {
			message: "This video is unavailable or cannot be downloaded",
			isAuth: false,
			isRateLimit: false,
			isUnavailable: true,
		};
	}
	if (code.includes("youtube.login") || code.includes("youtube.token")) {
		return {
			message:
				"YouTube requires authentication. The server may need session tokens configured.",
			isAuth: true,
			isRateLimit: false,
			isUnavailable: false,
		};
	}
	if (code.includes("youtube.bot") || code.includes("youtube.captcha")) {
		return {
			message: "YouTube detected bot activity. Try again later.",
			isAuth: false,
			isRateLimit: false,
			isUnavailable: true,
		};
	}
	if (code.includes("invalid_body")) {
		return {
			message: "Invalid request sent to Cobalt",
			isAuth: false,
			isRateLimit: false,
			isUnavailable: false,
		};
	}
	return {
		message: `Cobalt error: ${code}`,
		isAuth: false,
		isRateLimit: false,
		isUnavailable: false,
	};
}

function redactUrlCredentials(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.username || parsed.password) {
			parsed.username = "***";
			parsed.password = "***";
		}
		return parsed.toString();
	} catch {
		return url;
	}
}

export async function requestCobaltAudio(
	youtubeUrl: string,
	timeout: number = DEFAULT_TIMEOUT,
): Promise<string> {
	const cobaltUrl = getCobaltApiUrl();
	const cobaltUrlForLogs = redactUrlCredentials(cobaltUrl);
	const videoId = safeVideoId(youtubeUrl);
	console.log(
		`[Cobalt] Requesting audio for ${videoId} from ${cobaltUrlForLogs}`,
	);

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		const apiKey = getCobaltApiKey();
		if (apiKey) {
			headers.Authorization = `Api-Key ${apiKey}`;
		}

		const response = await fetch(cobaltUrl, {
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

		let data: CobaltResponse;
		try {
			data = (await response.json()) as CobaltResponse;
		} catch {
			const errorCode = `http_${response.status}_parse_error`;
			console.error(
				`[Cobalt] Failed to parse response for ${videoId}: status ${response.status}`,
			);
			throw new CobaltError(
				`Cobalt returned invalid response (status ${response.status})`,
				false,
				response.status >= 500,
				false,
				errorCode,
			);
		}

		if (!response.ok || data.status === "error") {
			const errorCode =
				data.status === "error" ? data.error.code : `http_${response.status}`;
			console.error(`[Cobalt] API error for ${videoId}: ${errorCode}`);
			const parsed = parseErrorCode(errorCode);
			throw new CobaltError(
				parsed.message,
				parsed.isRateLimit,
				parsed.isUnavailable || response.status >= 500,
				parsed.isAuth,
				errorCode,
			);
		}

		if (data.status === "tunnel" || data.status === "redirect") {
			console.log(`[Cobalt] Got ${data.status} URL for ${videoId}`);
			return data.url;
		}

		throw new CobaltError(
			`Unexpected Cobalt response status: ${(data as { status: string }).status}`,
			false,
			false,
			false,
			`unexpected_status_${(data as { status: string }).status}`,
		);
	} catch (error) {
		const videoId = safeVideoId(youtubeUrl);
		if (error instanceof CobaltError) {
			console.error(
				`[Cobalt] CobaltError for ${videoId}:`,
				error.message,
				error.errorCode ? `(${error.errorCode})` : "",
			);
			if (!error.isRateLimit && !error.isAuthRequired) {
				Sentry.captureException(error, {
					tags: {
						service: "cobalt",
						operation: "request",
						cobaltErrorCode: error.errorCode,
					},
					extra: { videoId, errorCode: error.errorCode },
				});
			}
			throw error;
		}
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				console.error(
					`[Cobalt] Request timed out for ${videoId} after ${timeout}ms`,
				);
				Sentry.captureException(error, {
					tags: {
						service: "cobalt",
						operation: "request",
						errorType: "timeout",
					},
					extra: { videoId, cobaltUrl: cobaltUrlForLogs, timeout },
				});
				throw new CobaltError("Cobalt request timed out", false, true, false);
			}
			const errWithCause = error as {
				cause?: { code?: string };
				code?: string;
			};
			const errorCode =
				errWithCause.code ?? errWithCause.cause?.code ?? undefined;
			const isNetworkError =
				errorCode === "ECONNREFUSED" ||
				errorCode === "ENOTFOUND" ||
				errorCode === "EAI_AGAIN" ||
				errorCode === "ETIMEDOUT" ||
				error.message.includes("fetch failed") ||
				error.message.includes("getaddrinfo");
			if (isNetworkError) {
				console.error(
					`[Cobalt] Network error for ${videoId}: ${error.message} (Is COBALT_API_URL correct? Current: ${cobaltUrlForLogs})`,
				);
			} else {
				console.error(`[Cobalt] Error for ${videoId}:`, error.message);
			}
			Sentry.captureException(error, {
				tags: {
					service: "cobalt",
					operation: "request",
					errorType: isNetworkError ? "network" : "unknown",
				},
				extra: { videoId, cobaltUrl: cobaltUrlForLogs, errorCode },
			});
			throw new CobaltError(
				`Cobalt request failed: ${error.message}`,
				false,
				true,
				false,
			);
		}
		console.error(`[Cobalt] Unknown error for ${videoId}:`, error);
		const normalizedError = new Error(`Unknown Cobalt error: ${String(error)}`);
		Sentry.captureException(normalizedError, {
			tags: { service: "cobalt", operation: "request" },
			extra: { videoId },
		});
		throw new CobaltError("Unknown Cobalt error", false, true, false);
	} finally {
		clearTimeout(timeoutId);
	}
}

export interface CobaltDownloadProgress {
	bytesReceived: number;
	totalBytes: number | null;
	percent: number;
}

export async function fetchCobaltAudio(
	downloadUrl: string,
	timeout: number = 60000,
	onProgress?: (progress: CobaltDownloadProgress) => void,
): Promise<ArrayBuffer> {
	if (!isAllowedDownloadUrl(downloadUrl)) {
		const error = new CobaltError("Invalid download URL from Cobalt");
		Sentry.captureException(error, {
			tags: { service: "cobalt", operation: "validation" },
			extra: {
				downloadUrlHost: new URL(downloadUrl).hostname,
				isPrivate: isPrivateCobaltInstance(),
			},
		});
		throw error;
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

			if (!onProgress || !response.body) {
				return await response.arrayBuffer();
			}

			const contentLength = response.headers.get("content-length");
			const totalBytes = contentLength
				? Number.parseInt(contentLength, 10)
				: null;
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let bytesReceived = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				chunks.push(value);
				bytesReceived += value.byteLength;
				const percent = totalBytes ? (bytesReceived / totalBytes) * 100 : 0;
				onProgress({ bytesReceived, totalBytes, percent });
			}

			const result = new Uint8Array(bytesReceived);
			let offset = 0;
			for (const chunk of chunks) {
				result.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return result.buffer;
		}

		throw new CobaltError("Too many redirects");
	} catch (error) {
		let downloadHost = "unknown";
		try {
			downloadHost = new URL(downloadUrl).hostname;
		} catch {
			// ignore
		}
		if (error instanceof CobaltError) {
			Sentry.captureException(error, {
				tags: { service: "cobalt", operation: "download" },
				extra: { downloadHost },
			});
			throw error;
		}
		if (error instanceof Error) {
			Sentry.captureException(error, {
				tags: { service: "cobalt", operation: "download" },
				extra: { downloadHost },
			});
			if (error.name === "AbortError") {
				throw new CobaltError("Cobalt download timed out", false, true, false);
			}
			throw new CobaltError(`Cobalt download failed: ${error.message}`);
		}
		const normalizedError = new Error(
			`Unknown Cobalt download error: ${String(error)}`,
		);
		Sentry.captureException(normalizedError, {
			tags: { service: "cobalt", operation: "download" },
			extra: { downloadHost },
		});
		throw new CobaltError("Unknown download error");
	} finally {
		clearTimeout(timeoutId);
	}
}
