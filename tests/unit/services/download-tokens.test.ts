import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearDownloadTokens,
	discardDownload,
	MAX_PENDING_DOWNLOADS,
	registerDownload,
	releaseDownload,
	resolveDownload,
} from "$lib/download-pipeline/download-tokens";

const TTL_MS = 5 * 60 * 1000;

async function createTempMp3(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dub-rip-tokens-"));
	const filePath = join(dir, "track.mp3");
	await writeFile(filePath, "audio");
	return filePath;
}

function register(filePath: string): string {
	return registerDownload({
		filePath,
		filename: "Artist - Track.mp3",
		size: 5,
	});
}

describe("download token registry", () => {
	beforeEach(() => {
		clearDownloadTokens();
	});

	afterEach(() => {
		vi.useRealTimers();
		clearDownloadTokens();
	});

	it("issues an unguessable token", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		const token = register(filePath);

		// #then
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it("issues a distinct token per registration", async () => {
		// #given
		const filePath = await createTempMp3();

		// #when
		const tokens = new Set([register(filePath), register(filePath)]);

		// #then
		expect(tokens.size).toBe(2);
	});

	it("resolves a registered token to its file", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = register(filePath);

		// #when
		const resolved = resolveDownload(token);

		// #then
		expect(resolved).toEqual({
			filePath,
			filename: "Artist - Track.mp3",
			size: 5,
		});
	});

	it("returns null for an unknown token", () => {
		// #given
		const unknown = "f".repeat(64);

		// #when
		const resolved = resolveDownload(unknown);

		// #then
		expect(resolved).toBeNull();
	});

	it("keeps the token resolvable across repeated lookups", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = register(filePath);

		// #when
		resolveDownload(token);

		// #then
		expect(resolveDownload(token)).not.toBeNull();
	});

	it("stops resolving a token once released", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = register(filePath);

		// #when
		releaseDownload(token);

		// #then
		expect(resolveDownload(token)).toBeNull();
	});

	it("deletes the temp file when released", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = register(filePath);

		// #when
		releaseDownload(token);
		await vi.waitFor(() => expect(existsSync(filePath)).toBe(false));

		// #then
		expect(existsSync(filePath)).toBe(false);
	});

	it("stops resolving a token after the TTL elapses", async () => {
		// #given
		const filePath = await createTempMp3();
		vi.useFakeTimers();
		const token = register(filePath);

		// #when
		vi.setSystemTime(Date.now() + TTL_MS + 1);

		// #then
		expect(resolveDownload(token)).toBeNull();
	});

	it("deletes the temp file of an expired token", async () => {
		// #given
		const filePath = await createTempMp3();
		vi.useFakeTimers();
		const token = register(filePath);

		// #when
		vi.setSystemTime(Date.now() + TTL_MS + 1);
		resolveDownload(token);
		vi.useRealTimers();
		await vi.waitFor(() => expect(existsSync(filePath)).toBe(false));

		// #then
		expect(existsSync(filePath)).toBe(false);
	});

	it("forgets a token without deleting its file when discarded", async () => {
		// #given
		const filePath = await createTempMp3();
		const token = register(filePath);

		// #when
		discardDownload(token);

		// #then
		expect(resolveDownload(token)).toBeNull();
	});

	it("evicts the oldest pending download once MAX_PENDING_DOWNLOADS is reached", async () => {
		// #given — fill the registry to capacity
		let oldestToken = "";
		let oldestFilePath = "";
		for (let i = 0; i < MAX_PENDING_DOWNLOADS; i++) {
			const filePath = await createTempMp3();
			const token = register(filePath);
			if (i === 0) {
				oldestToken = token;
				oldestFilePath = filePath;
			}
		}

		// #when — one more registration pushes the registry past capacity
		const newFilePath = await createTempMp3();
		const newToken = register(newFilePath);

		// #then — the oldest entry is gone, but the newest one and its file survive
		expect(resolveDownload(oldestToken)).toBeNull();
		await vi.waitFor(() => expect(existsSync(oldestFilePath)).toBe(false));
		expect(resolveDownload(newToken)).not.toBeNull();
	});

	it("does not evict anything while under MAX_PENDING_DOWNLOADS", async () => {
		// #given
		const filePaths: string[] = [];
		for (let i = 0; i < MAX_PENDING_DOWNLOADS - 1; i++) {
			filePaths.push(await createTempMp3());
		}

		// #when
		const tokens = filePaths.map((filePath) => register(filePath));

		// #then
		for (const token of tokens) {
			expect(resolveDownload(token)).not.toBeNull();
		}
	});
});
