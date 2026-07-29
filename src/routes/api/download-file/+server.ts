import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
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
		return new Response("Download expired or already retrieved", {
			status: 404,
		});
	}

	let size: number;
	try {
		size = (await stat(download.filePath)).size;
	} catch {
		discardDownload(token);
		return new Response("Download file is no longer available", {
			status: 404,
		});
	}

	const fileStream = createReadStream(download.filePath);
	fileStream.on("end", () => releaseDownload(token));
	fileStream.on("error", (err) => {
		console.error("Download file stream error:", err);
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
