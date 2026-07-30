import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import * as Sentry from "@sentry/sveltekit";
import {
	discardDownload,
	releaseDownload,
	resolveDownload,
} from "$lib/download-pipeline/download-tokens";
import type { RequestHandler } from "./$types";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Builds a Content-Disposition value that survives the filename being derived
 * from a YouTube title. The UTF-8 form carries the real name; the ASCII form is
 * the fallback for clients that ignore RFC 5987. Both are escaped rather than
 * merely stripped of the shell-unsafe set, because anything reaching a response
 * header must not be able to introduce CR/LF or close the quoted string.
 */
function buildContentDisposition(filename: string): string {
	let ascii = "";
	for (const char of filename) {
		const code = char.codePointAt(0) ?? 0;
		const printable = code >= 0x20 && code <= 0x7e;
		ascii += printable && char !== '"' && char !== "\\" ? char : "_";
	}
	const safeAscii = ascii.trim() || "audio.mp3";
	return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET: RequestHandler = async ({ url }) => {
	const token = url.searchParams.get("token");

	if (!token || !TOKEN_PATTERN.test(token)) {
		return new Response("Invalid download token", { status: 400 });
	}

	const download = resolveDownload(token);
	if (!download) {
		// The registry is in-process and the file is container-local, so a
		// container replaced between the SSE `complete` event and this request —
		// a deploy, a crash, a sleep/wake — takes both with it. The window is
		// milliseconds and re-running the download recovers it.
		//
		// Reported here rather than in the browser because this is the only layer
		// that knows *why* the token missed; the client breadcrumbs the rejection
		// instead, so one incident stays one issue. Warning, not error: like the
		// transient yt-dlp category, it is real but recoverable.
		console.warn(
			"Unknown download token; the issuing container was likely replaced",
		);
		Sentry.captureMessage("Download token not found", {
			level: "warning",
			tags: { service: "download-file", operation: "resolve-token" },
		});
		return new Response("Download expired or already retrieved", {
			status: 404,
		});
	}

	let size: number;
	try {
		size = (await stat(download.filePath)).size;
	} catch (err) {
		discardDownload(token);
		// Distinct from an unknown token: the registry still had the entry, so the
		// file was removed underneath us rather than lost with its container.
		console.warn("Download token resolved but its file is gone");
		Sentry.captureException(
			err instanceof Error ? err : new Error(String(err)),
			{
				level: "warning",
				tags: { service: "download-file", operation: "stat-file" },
			},
		);
		return new Response("Download file is no longer available", {
			status: 404,
		});
	}

	const fileStream = createReadStream(download.filePath);
	fileStream.on("end", () => releaseDownload(token));
	fileStream.on("error", (err) => {
		// Mid-transfer read failure. Nothing else observes it: the response has
		// already been handed to the adapter, so the client only sees a truncated
		// body and no route-level catch ever runs.
		console.error("Download file stream error:", err);
		Sentry.captureException(err, {
			tags: { service: "download-file", operation: "stream-file" },
		});
	});

	return new Response(Readable.toWeb(fileStream) as ReadableStream, {
		headers: {
			"Content-Type": "audio/mpeg",
			"Content-Length": String(size),
			"Content-Disposition": buildContentDisposition(download.filename),
			"Cache-Control": "no-store",
		},
	});
};
