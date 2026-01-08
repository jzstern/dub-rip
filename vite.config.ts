import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		sentrySvelteKit({
			org: "jzs-yw",
			project: "dub-rip",
		}),
		sveltekit(),
	],
	ssr: {
		external: ["yt-dlp-wrap", "@ffmpeg-installer/ffmpeg"],
	},
});
