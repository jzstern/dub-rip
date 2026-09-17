import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as Sentry from "@sentry/sveltekit";

export interface CleanupTempFilesInput {
	tempDir: string;
	prefix: string;
	tags: Record<string, string>;
	extra?: Record<string, unknown>;
}

/**
 * A prefix scan rather than a list of known names: an interrupted HLS
 * download leaves numbered `.part-FragN` files and a `.ytdl` resume-state
 * file that no fixed list can enumerate. Callers pass a random-bits prefix so
 * it can never match another request's files.
 */
function reportCleanupFailure(
	error: unknown,
	tags: Record<string, string>,
	extra: Record<string, unknown> | undefined,
): void {
	// A file vanishing mid-cleanup is the outcome cleanup wants.
	if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
	console.error("Temp file cleanup failed:", error);
	Sentry.captureException(error, {
		level: "warning",
		tags: { operation: "temp-cleanup", ...tags },
		extra,
	});
}

export async function cleanupTempFiles({
	tempDir,
	prefix,
	tags,
	extra,
}: CleanupTempFilesInput): Promise<void> {
	let leftovers: string[];
	try {
		leftovers = (await readdir(tempDir)).filter((name) =>
			name.startsWith(`${prefix}.`),
		);
	} catch (readdirError) {
		reportCleanupFailure(readdirError, tags, extra);
		return;
	}

	// Each file is unlinked independently so one missing/unwritable file
	// doesn't strand the rest of the run's leftovers on disk.
	for (const name of leftovers) {
		try {
			await unlink(join(tempDir, name));
		} catch (unlinkError) {
			reportCleanupFailure(unlinkError, tags, extra);
		}
	}
}
