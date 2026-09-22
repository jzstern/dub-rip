import { buildJsRuntimeArgs } from "$lib/yt-dlp-binary";
import { runYtDlpDownload, type YtDlpInstance } from "./try-yt-dlp";

/**
 * MP3 first: SoundCloud serves 128 kbps MP3 for most tracks, and taking it
 * means `--audio-format mp3` copies the stream (yt-dlp logs "file is already
 * in target format mp3") instead of re-encoding lossy AAC/Opus into lossy MP3.
 * `format_id!*=preview` refuses Go+ 30-second snippets, which yt-dlp itself
 * only deprioritises; a preview-only track then fails with "Requested format
 * is not available" rather than shipping 30 seconds as a finished download.
 */
export const SOUNDCLOUD_FORMAT_SELECTOR =
	"bestaudio[acodec=mp3][format_id!*=preview]/bestaudio[format_id!*=preview]";

export interface SoundCloudDownloadArgsInput {
	videoUrl: string;
	outputPath: string;
	ffmpegPath: string;
	debugMode: boolean;
}

/**
 * No bgutil plugin, PO-token or `youtube:` extractor args: those answer
 * YouTube's bot checks, and passing them would make SoundCloud downloads
 * depend on the bgutil-pot sidecar being configured and awake.
 * `buildJsRuntimeArgs()` is inert here but kept, so "every yt-dlp invocation
 * passes it" stays a rule without exceptions.
 */
export function buildSoundCloudDownloadArgs({
	videoUrl,
	outputPath,
	ffmpegPath,
	debugMode,
}: SoundCloudDownloadArgsInput): string[] {
	const args = [
		videoUrl,
		"-x",
		"--audio-format",
		"mp3",
		"--audio-quality",
		"128K",
		"-f",
		SOUNDCLOUD_FORMAT_SELECTOR,
		"--concurrent-fragments",
		"4",
		"--ffmpeg-location",
		ffmpegPath,
		"--newline",
		"--no-playlist",
		"--no-update",
		...buildJsRuntimeArgs(),
		"-o",
		`${outputPath}.%(ext)s`,
	];
	if (debugMode) {
		args.push("-v", "--list-formats");
	}
	return args;
}

export interface TrySoundCloudInput extends SoundCloudDownloadArgsInput {
	ytDlp: YtDlpInstance;
	send: (data: Record<string, unknown>) => void;
	signal?: AbortSignal;
}

export async function trySoundCloudDownload({
	ytDlp,
	send,
	signal,
	...argsInput
}: TrySoundCloudInput): Promise<void> {
	await runYtDlpDownload({
		args: buildSoundCloudDownloadArgs(argsInput),
		ytDlp,
		send,
		signal,
	});
}
