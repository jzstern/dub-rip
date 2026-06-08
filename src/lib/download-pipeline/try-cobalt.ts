import { writeFileSync } from "node:fs";
import { CobaltError, fetchCobaltAudio, requestCobaltAudio } from "$lib/cobalt";
import { formatBytes } from "$lib/video-utils";

export interface TryCobaltInput {
	videoUrl: string;
	outputPath: string;
	send: (data: Record<string, unknown>) => void;
}

export type TryCobaltResult =
	| { ok: true; method: "cobalt" }
	| { ok: false; error: Error };

export async function tryCobaltDownload({
	videoUrl,
	outputPath,
	send,
}: TryCobaltInput): Promise<TryCobaltResult> {
	try {
		const downloadUrl = await requestCobaltAudio(videoUrl, 20000);
		console.log("[Cobalt] Got download URL");

		send({ type: "progress", percent: 5 });

		const audioBuffer = await fetchCobaltAudio(downloadUrl, 55000, (p) => {
			if (p.totalBytes) {
				send({
					type: "progress",
					percent: Math.round(5 + (p.percent / 100) * 70),
				});
			} else {
				const pseudo = Math.min(70, Math.log10(1 + p.bytesReceived) * 10);
				send({
					type: "progress",
					percent: Math.round(5 + pseudo),
				});
				send({
					type: "status",
					message: `Downloading... (${formatBytes(p.bytesReceived)})`,
				});
			}
		});
		console.log("[Cobalt] Downloaded audio, size:", audioBuffer.byteLength);

		if (audioBuffer.byteLength === 0) {
			throw new CobaltError(
				"Cobalt returned empty content (video may be blocked)",
			);
		}

		send({ type: "progress", percent: 75 });

		writeFileSync(outputPath, Buffer.from(audioBuffer));
		console.log("[Cobalt] Download successful");

		return { ok: true, method: "cobalt" };
	} catch (err) {
		if (err instanceof CobaltError) {
			console.log("[Cobalt] Failed, falling back to yt-dlp:", err.message);
		} else {
			const errMsg = err instanceof Error ? err.message : "Unknown error";
			console.log("[Cobalt] Failed, falling back to yt-dlp:", errMsg);
		}
		return {
			ok: false,
			error: err instanceof Error ? err : new Error(String(err)),
		};
	}
}
