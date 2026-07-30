import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearDownloadTokens,
	registerDownload,
} from "$lib/download-pipeline/download-tokens";

const FILE_CONTENT = "fake mp3 bytes";

async function createTempMp3(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dub-rip-file-"));
	const filePath = join(dir, "track.mp3");
	await writeFile(filePath, FILE_CONTENT);
	return filePath;
}

function requestFor(token: string | null) {
	const url = new URL("http://localhost/api/download-file");
	if (token !== null) url.searchParams.set("token", token);
	return { url } as unknown as Parameters<
		Awaited<
			typeof import("../../../src/routes/api/download-file/+server")
		>["GET"]
	>[0];
}

async function callGet(token: string | null) {
	const { GET } = await import("../../../src/routes/api/download-file/+server");
	return GET(requestFor(token));
}

describe("GET /api/download-file", () => {
	beforeEach(() => {
		clearDownloadTokens();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		clearDownloadTokens();
	});

	it("returns 400 when the token is missing", async () => {
		// #given a request with no token

		// #when
		const res = await callGet(null);

		// #then
		expect(res.status).toBe(400);
	});

	it("returns 400 for a malformed token", async () => {
		// #given
		const malformed = "../../etc/passwd";

		// #when
		const res = await callGet(malformed);

		// #then
		expect(res.status).toBe(400);
	});

	it("returns 404 for a well-formed but unregistered token", async () => {
		// #given
		const unknown = "a".repeat(64);

		// #when
		const res = await callGet(unknown);

		// #then
		expect(res.status).toBe(404);
	});

	it("returns 404 when the registered file is gone from disk", async () => {
		// #given
		const token = registerDownload({
			filePath: join(tmpdir(), "dub-rip-missing-file.mp3"),
			filename: "Gone.mp3",
			size: 1,
		});

		// #when
		const res = await callGet(token);

		// #then
		expect(res.status).toBe(404);
	});

	it("serves the file with an audio content type", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: "Artist - Track.mp3",
			size: FILE_CONTENT.length,
		});

		// #when
		const res = await callGet(token);

		// #then
		expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
	});

	it("reports the on-disk size as Content-Length", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: "Artist - Track.mp3",
			size: 999,
		});

		// #when
		const res = await callGet(token);

		// #then
		expect(res.headers.get("Content-Length")).toBe(String(FILE_CONTENT.length));
	});

	it("attaches the filename for the browser", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: "Artist - Track.mp3",
			size: FILE_CONTENT.length,
		});

		// #when
		const res = await callGet(token);

		// #then
		expect(res.headers.get("Content-Disposition")).toContain(
			'attachment; filename="Artist - Track.mp3"',
		);
	});

	it("encodes a non-ASCII filename rather than emitting raw bytes", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: "Björk - Jóga.mp3",
			size: FILE_CONTENT.length,
		});

		// #when
		const res = await callGet(token);

		// #then
		expect(res.headers.get("Content-Disposition")).toContain(
			"filename*=UTF-8''Bj%C3%B6rk%20-%20J%C3%B3ga.mp3",
		);
	});

	it("neutralises CRLF in a filename so headers cannot be injected", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: 'evil\r\nX-Injected: 1"\\.mp3',
			size: FILE_CONTENT.length,
		});

		// #when
		const res = await callGet(token);
		const disposition = res.headers.get("Content-Disposition") ?? "";

		// #then
		expect(disposition).not.toMatch(/[\r\n]/);
	});

	it("streams the file contents", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: "Artist - Track.mp3",
			size: FILE_CONTENT.length,
		});

		// #when
		const res = await callGet(token);
		const body = await res.text();

		// #then
		expect(body).toBe(FILE_CONTENT);
	});

	it("deletes the temp file once the transfer completes", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: "Artist - Track.mp3",
			size: FILE_CONTENT.length,
		});

		// #when
		const res = await callGet(token);
		await res.text();
		await vi.waitFor(() => expect(existsSync(filePath)).toBe(false));

		// #then
		expect(existsSync(filePath)).toBe(false);
	});
});

describe("GET /api/download-file - error reporting", () => {
	beforeEach(() => {
		clearDownloadTokens();
		vi.mocked(Sentry.captureMessage).mockClear();
		vi.mocked(Sentry.captureException).mockClear();
	});

	afterEach(() => {
		clearDownloadTokens();
	});

	it("reports an unknown token so a lost container is visible", async () => {
		// #given a token whose issuing container is gone
		const orphaned = "c".repeat(64);

		// #when
		await callGet(orphaned);

		// #then
		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			"Download token not found",
			expect.objectContaining({ level: "warning" }),
		);
	});

	it("does not report a malformed token as an incident", async () => {
		// #given a token that never came from us
		// #when
		await callGet("not-a-token");

		// #then
		expect(Sentry.captureMessage).not.toHaveBeenCalled();
	});

	it("reports a registered token whose file vanished", async () => {
		// #given
		const token = registerDownload({
			filePath: join(tmpdir(), "dub-rip-vanished.mp3"),
			filename: "Gone.mp3",
			size: 1,
		});

		// #when
		await callGet(token);

		// #then
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ level: "warning" }),
		);
	});

	it("does not report a successful transfer", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = registerDownload({
			filePath,
			filename: "Artist - Track.mp3",
			size: FILE_CONTENT.length,
		});

		// #when
		const res = await callGet(token);
		await res.text();

		// #then
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});
});
