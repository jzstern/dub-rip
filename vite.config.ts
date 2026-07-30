import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { resolveRelease } from "./src/lib/sentry-options";

const railwayEnvironmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? "";
const commitSha = process.env.RAILWAY_GIT_COMMIT_SHA ?? "";
const release = resolveRelease(commitSha);

export default defineConfig({
	plugins: [
		sentrySvelteKit({
			org: "jzs-yw",
			project: "dub-rip",
			telemetry: false,
			/**
			 * Uploading needs SENTRY_AUTH_TOKEN, which only exists on Railway.
			 * Without it the plugin logs a warning and continues, so local and
			 * CI builds still succeed — they just produce no source maps.
			 */
			authToken: process.env.SENTRY_AUTH_TOKEN,
			release: release ? { name: release } : undefined,
		}),
		sveltekit(),
	],
	/**
	 * The browser bundle can't read Railway's runtime env, so these are inlined
	 * at build time to give client-side events the same environment and release
	 * tags the server sets from `$env/dynamic/private`.
	 */
	define: {
		__RAILWAY_ENVIRONMENT_NAME__: JSON.stringify(railwayEnvironmentName),
		__RAILWAY_COMMIT_SHA__: JSON.stringify(commitSha),
	},
	ssr: {
		external: [
			"yt-dlp-wrap",
			"@ffmpeg-installer/ffmpeg",
			"node-id3",
			"youtube-po-token-generator",
		],
	},
});
