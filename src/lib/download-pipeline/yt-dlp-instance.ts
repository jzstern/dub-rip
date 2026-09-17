import { createRequire } from "node:module";
import { ensureYtDlpBinary } from "$lib/yt-dlp-binary";
import type { YtDlpInstance } from "./try-yt-dlp";

const require = createRequire(import.meta.url);

let ytDlpWrap: YtDlpInstance | null = null;
let ytDlpPromise: Promise<YtDlpInstance> | null = null;

/**
 * Shared across every caller (real downloads and the canary) so there is one
 * `YTDlpWrap` instance per process, bound to the one resolved binary path.
 */
export async function getYTDlp(): Promise<YtDlpInstance> {
	if (ytDlpWrap) return ytDlpWrap;
	if (ytDlpPromise) return ytDlpPromise;

	ytDlpPromise = (async (): Promise<YtDlpInstance> => {
		try {
			const YTDlpWrapModule = require("yt-dlp-wrap");
			const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;
			const binaryPath = await ensureYtDlpBinary();
			ytDlpWrap = new YTDlpWrap(binaryPath) as YtDlpInstance;
			return ytDlpWrap;
		} catch (err) {
			ytDlpPromise = null;
			throw err;
		}
	})();

	return ytDlpPromise;
}
