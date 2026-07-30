import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";

const TOKEN_TTL_MS = 5 * 60 * 1000;
const TOKEN_BYTES = 32;

export interface PendingDownload {
	filePath: string;
	filename: string;
	size: number;
}

interface StoredDownload extends PendingDownload {
	expiresAt: number;
}

const pending = new Map<string, StoredDownload>();

/**
 * Expired entries are reaped on access rather than on a timer. A periodic timer
 * would be background activity on a service that is deliberately allowed to
 * sleep when idle (see docs/deployment-strategy.md), and the temp files it
 * would reap live in a container-local /tmp that is discarded on every restart.
 *
 * Unlink failures are deliberately unreported: the usual cause is the file
 * already being gone, which is the desired end state anyway.
 */
function sweepExpired(): void {
	const now = Date.now();
	for (const [token, entry] of pending) {
		if (entry.expiresAt <= now) {
			pending.delete(token);
			void unlink(entry.filePath).catch(() => {});
		}
	}
}

export function registerDownload(download: PendingDownload): string {
	sweepExpired();
	const token = randomBytes(TOKEN_BYTES).toString("hex");
	pending.set(token, { ...download, expiresAt: Date.now() + TOKEN_TTL_MS });
	return token;
}

/**
 * Resolves a token without consuming it. A browser may legitimately issue more
 * than one request for the same download (an aborted transfer the user retries,
 * a HEAD probe from a download manager), so the entry is released by
 * `releaseDownload` once a transfer actually completes, not on first lookup.
 */
export function resolveDownload(token: string): PendingDownload | null {
	sweepExpired();
	const entry = pending.get(token);
	if (!entry) return null;
	const { filePath, filename, size } = entry;
	return { filePath, filename, size };
}

export function releaseDownload(token: string): void {
	const entry = pending.get(token);
	if (!entry) return;
	pending.delete(token);
	void unlink(entry.filePath).catch(() => {});
}

export function discardDownload(token: string): void {
	pending.delete(token);
}

export function clearDownloadTokens(): void {
	pending.clear();
}
