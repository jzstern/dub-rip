import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";

const nodeRequire = createRequire(import.meta.url);

const FFMPEG_PATH_ENV = "FFMPEG_PATH";
const VERSION_PROBE_TIMEOUT_MS = 5_000;

export type FfmpegSource = "env" | "path" | "ffmpeg-static";

export interface FfmpegResolution {
	path: string;
	source: FfmpegSource;
}

export interface FfmpegResolverDeps {
	env: Record<string, string | undefined>;
	platform: NodeJS.Platform;
	isExecutable: (path: string) => boolean;
	loadBundledPath: () => string | null;
}

export class FfmpegNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FfmpegNotFoundError";
	}
}

function isExecutableFile(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function loadBundledFfmpegPath(): string | null {
	try {
		const bundled: unknown = nodeRequire("ffmpeg-static");
		return typeof bundled === "string" ? bundled : null;
	} catch {
		return null;
	}
}

function findOnPath(deps: FfmpegResolverDeps): string | null {
	const executableName = deps.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	const directories = (deps.env.PATH ?? "").split(delimiter).filter(Boolean);
	for (const directory of directories) {
		const candidate = join(directory, executableName);
		if (deps.isExecutable(candidate)) return candidate;
	}
	return null;
}

/**
 * Order: explicit `FFMPEG_PATH`, then `ffmpeg` on `PATH` (a system install,
 * which production gets from `RAILPACK_DEPLOY_APT_PACKAGES`), then the
 * `ffmpeg-static` build. An `FFMPEG_PATH` that points at nothing is an error
 * rather than a silent fall-through, so a typo can't quietly select a
 * different binary than the one the operator asked for.
 */
export function findFfmpeg(
	deps: FfmpegResolverDeps = {
		env: process.env,
		platform: process.platform,
		isExecutable: isExecutableFile,
		loadBundledPath: loadBundledFfmpegPath,
	},
): FfmpegResolution {
	const override = deps.env[FFMPEG_PATH_ENV];
	if (override) {
		if (!deps.isExecutable(override)) {
			throw new FfmpegNotFoundError(
				`${FFMPEG_PATH_ENV} is set to "${override}", which is not an executable file.`,
			);
		}
		return { path: override, source: "env" };
	}

	const onPath = findOnPath(deps);
	if (onPath) return { path: onPath, source: "path" };

	const bundled = deps.loadBundledPath();
	if (bundled && deps.isExecutable(bundled)) {
		return { path: bundled, source: "ffmpeg-static" };
	}

	throw new FfmpegNotFoundError(
		`ffmpeg was not found. Set ${FFMPEG_PATH_ENV}, install ffmpeg on PATH ` +
			`(on Railway: RAILPACK_DEPLOY_APT_PACKAGES="python3 ffmpeg"), or reinstall dependencies so ffmpeg-static can fetch its binary.`,
	);
}

let cached: FfmpegResolution | null = null;

function logVersionOnce({ path }: FfmpegResolution): void {
	execFile(
		path,
		["-version"],
		{ timeout: VERSION_PROBE_TIMEOUT_MS },
		(error, stdout) => {
			if (error) {
				console.warn(`ffmpeg -version failed for ${path}:`, error.message);
				return;
			}
			console.log(`ffmpeg version: ${stdout.split("\n")[0]}`);
		},
	);
}

export function resolveFfmpegPath(): string {
	if (!cached) {
		cached = findFfmpeg();
		console.log(`Using ffmpeg at ${cached.path} (${cached.source})`);
		logVersionOnce(cached);
	}
	return cached.path;
}

export function resetFfmpegPathCache(): void {
	cached = null;
}
