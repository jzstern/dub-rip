import { buildJsRuntimeArgs } from "$lib/yt-dlp-binary";
import { runYtDlpDownload, type YtDlpInstance } from "./try-yt-dlp";

/**
 * A paid track exposes only `mp3-128`, the public stream. A name-your-price
 * track with a $0 minimum also exposes the free-download formats (`mp3-320`,
 * `mp3-v0`, FLAC, WAV…), which yt-dlp reads without a purchase. MP3 320 is
 * the best of those for an MP3 file: `--audio-format mp3` copies it as-is,
 * where FLAC would be re-encoded into a lossy file no better than it.
 */
export const BANDCAMP_FORMAT_SELECTOR =
	"mp3-320/mp3-v0/mp3-128/bestaudio[acodec=mp3]/bestaudio";

export interface BandcampDownloadArgsInput {
	videoUrl: string;
	outputPath: string;
	ffmpegPath: string;
	debugMode: boolean;
}

/**
 * No bgutil plugin, PO-token or `youtube:` extractor args, for the reason
 * buildSoundCloudDownloadArgs gives. `--audio-quality 0` only matters if the
 * selector ever falls through to a non-MP3 format and forces a re-encode.
 */
export function buildBandcampDownloadArgs({
	videoUrl,
	outputPath,
	ffmpegPath,
	debugMode,
}: BandcampDownloadArgsInput): string[] {
	const args = [
		videoUrl,
		"-x",
		"--audio-format",
		"mp3",
		"--audio-quality",
		"0",
		"-f",
		BANDCAMP_FORMAT_SELECTOR,
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

export interface TryBandcampInput extends BandcampDownloadArgsInput {
	ytDlp: YtDlpInstance;
	send: (data: Record<string, unknown>) => void;
	signal?: AbortSignal;
}

export async function tryBandcampDownload({
	ytDlp,
	send,
	signal,
	...argsInput
}: TryBandcampInput): Promise<void> {
	await runYtDlpDownload({
		args: buildBandcampDownloadArgs(argsInput),
		ytDlp,
		send,
		signal,
	});
}
