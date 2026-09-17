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
export async function cleanupTempFiles({
	tempDir,
	prefix,
	tags,
	extra,
}: CleanupTempFilesInput): Promise<void> {
	try {
		const leftovers = (await readdir(tempDir)).filter((name) =>
			name.startsWith(`${prefix}.`),
		);
		for (const name of leftovers) {
			await unlink(join(tempDir, name));
		}
	} catch (cleanupError) {
		// A file vanishing mid-cleanup is the outcome cleanup wants.
		if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
			console.error("Temp file cleanup failed:", cleanupError);
			Sentry.captureException(cleanupError, {
				level: "warning",
				tags: { operation: "temp-cleanup", ...tags },
				extra,
			});
		}
	}
}
