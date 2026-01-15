/**
 * Cobalt API integration for YouTube audio downloads
 * Handles bot detection bypass that yt-dlp cannot handle in serverless environments
 */

const COBALT_API_URL =
	process.env.COBALT_API_URL || "https://api.cobalt.tools/api/json";
const DEFAULT_TIMEOUT = 30000;

const ALLOWED_DOWNLOAD_HOSTS = [
	"cobalt.tools",
	"api.cobalt.tools",
	"download.cobalt.tools",
	"cdn.cobalt.tools",
];

function isAllowedDownloadUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") {
			return false;
		}
		return ALLOWED_DOWNLOAD_HOSTS.some(
			(host) =>
				parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
		);
	} catch {
		return false;
	}
}

export interface CobaltRequest {
	url: string;
	isAudioOnly: true;
	aFormat: "mp3";
	filenameStyle?: "basic" | "pretty" | "nerdy";
}

export interface CobaltSuccessResponse {
	status: "stream" | "redirect";
	url: string;
}

export interface CobaltErrorResponse {
	status: "error";
	text: string;
}

export type CobaltResponse = CobaltSuccessResponse | CobaltErrorResponse;

export class CobaltError extends Error {
	constructor(
		message: string,
		public readonly isRateLimit: boolean = false,
		public readonly isUnavailable: boolean = false,
	) {
		super(message);
		this.name = "CobaltError";
	}
}

export async function requestCobaltAudio(
	youtubeUrl: string,
	timeout: number = DEFAULT_TIMEOUT,
): Promise<string> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(COBALT_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				url: youtubeUrl,
				isAudioOnly: true,
				aFormat: "mp3",
			} satisfies CobaltRequest),
			signal: controller.signal,
		});

		if (response.status === 429) {
			throw new CobaltError("Cobalt rate limit exceeded", true, false);
		}

		if (!response.ok) {
			throw new CobaltError(
				`Cobalt API returned status ${response.status}`,
				false,
				response.status >= 500,
			);
		}

		const data = (await response.json()) as CobaltResponse;

		if (data.status === "error") {
			throw new CobaltError(data.text || "Unknown Cobalt error");
		}

		if (data.status === "stream" || data.status === "redirect") {
			return data.url;
		}

		throw new CobaltError(`Unexpected Cobalt response status: ${data.status}`);
	} catch (error) {
		if (error instanceof CobaltError) {
			throw error;
		}
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new CobaltError("Cobalt request timed out", false, true);
			}
			throw new CobaltError(
				`Cobalt request failed: ${error.message}`,
				false,
				true,
			);
		}
		throw new CobaltError("Unknown Cobalt error", false, true);
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
		const response = await fetch(downloadUrl, {
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new CobaltError(
				`Failed to download from Cobalt: ${response.status}`,
			);
		}

		return await response.arrayBuffer();
	} catch (error) {
		if (error instanceof CobaltError) {
			throw error;
		}
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new CobaltError("Cobalt download timed out", false, true);
			}
			throw new CobaltError(`Cobalt download failed: ${error.message}`);
		}
		throw new CobaltError("Unknown download error");
	} finally {
		clearTimeout(timeoutId);
	}
}
