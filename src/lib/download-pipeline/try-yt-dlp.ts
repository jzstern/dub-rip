import {
	parseArtistAndTitle,
	sanitizeUploaderAsArtist,
} from "$lib/video-utils";
import { parseYtDlpError } from "$lib/yt-dlp-errors";

interface YtDlpProcess {
	on(
		event: "progress",
		callback: (progress: Record<string, unknown>) => void,
	): void;
	on(
		event: "ytDlpEvent",
		callback: (eventType: string, eventData: string) => void,
	): void;
	on(event: "error", callback: (error: Error) => void): void;
	on(event: "close", callback: (code: number) => void): void;
	stderr?: { on(event: string, callback: (data: Buffer) => void): void };
}

export interface YtDlpInstance {
	exec(args: string[]): YtDlpProcess;
}

export interface TitleState {
	videoTitle: string;
	artist: string;
	trackTitle: string;
	uploader: string;
}

export interface TryYtDlpInput {
	videoUrl: string;
	outputPath: string;
	bgutilPotUrl: string;
	ffmpegPath: string;
	pluginDir: string;
	debugMode: boolean;
	ytDlp: YtDlpInstance;
	titleState: TitleState;
	send: (data: Record<string, unknown>) => void;
}

export async function tryYtDlpDownload({
	videoUrl,
	outputPath,
	bgutilPotUrl,
	ffmpegPath,
	pluginDir,
	debugMode,
	ytDlp,
	titleState,
	send,
}: TryYtDlpInput): Promise<void> {
	const args = [
		videoUrl,
		"-x",
		"--audio-format",
		"mp3",
		"--audio-quality",
		"0",
		"-f",
		"bestaudio/best",
		"--embed-thumbnail",
		"--add-metadata",
		"--ffmpeg-location",
		ffmpegPath,
		"--newline",
		"--no-warnings",
		"--parse-metadata",
		"%(title)s:%(meta_title)s",
		"--parse-metadata",
		"%(artist)s:%(meta_artist)s",
		"--no-playlist",
		"--plugin-dirs",
		pluginDir,
		// player_client=default,mweb: try yt-dlp's default chain first (web → ios → android
		// → ...) then fall back to mweb. mweb requires a PO token (provided by bgutil-pot)
		// but returns a narrower format set than web; some videos have no `bestaudio`-matching
		// format in mweb's response. Multi-client mode handles both cases.
		"--extractor-args",
		"youtube:player_client=default,mweb",
		"--extractor-args",
		`youtubepot-bgutilhttp:base_url=${bgutilPotUrl}`,
		"-o",
		`${outputPath}.%(ext)s`,
	];

	if (debugMode) {
		args.push("-v", "--list-formats");
	}

	const downloadProcess = ytDlp.exec(args);

	downloadProcess.on("progress", (progress: Record<string, unknown>) => {
		const rawPercent = Math.min(
			100,
			Math.max(0, (progress.percent as number) || 0),
		);
		send({
			type: "progress",
			percent: Math.round(5 + (rawPercent / 100) * 70),
			speed: (progress.currentSpeed as string) || "",
			eta: (progress.eta as string) || "",
		});
	});

	downloadProcess.on("ytDlpEvent", (eventType: string, eventData: string) => {
		console.log("yt-dlp event:", eventType, "|", eventData);

		if (!titleState.videoTitle) {
			if (eventType === "Destination") {
				const match = eventData.match(/\/([^/]+)\.\w+$/);
				if (match) {
					titleState.videoTitle = match[1].replace(/_/g, " ");
				}
			} else if (eventData.includes(".mp3") || eventData.includes(".webm")) {
				const match = eventData.match(/([^/]+)\.\w+/);
				if (match) {
					titleState.videoTitle = match[1].replace(/_/g, " ");
				}
			}

			if (titleState.videoTitle) {
				const parsed = parseArtistAndTitle(titleState.videoTitle);
				titleState.artist = parsed.artist;
				titleState.trackTitle = parsed.title;

				if (!titleState.artist && titleState.uploader) {
					titleState.artist = sanitizeUploaderAsArtist(titleState.uploader);
				}

				send({
					type: "info",
					title: titleState.videoTitle,
					artist: titleState.artist,
					track: titleState.trackTitle,
				});
			}
		}

		send({ type: "event", eventType, eventData });
	});

	let errorMessage = "";
	downloadProcess.stderr?.on("data", (data: Buffer) => {
		const text = data.toString();
		console.error("yt-dlp stderr:", text);
		if (text.includes("ERROR:")) {
			errorMessage += text;
		}
	});

	downloadProcess.on("error", (error: Error) => {
		console.error("Download process error:", error);
		send({
			type: "error",
			message: parseYtDlpError(error.message),
		});
	});

	await new Promise<void>((resolve, reject) => {
		downloadProcess.on("close", (code: number) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(errorMessage || `Process exited with code ${code}`));
			}
		});
		downloadProcess.on("error", reject);
	});
}
