import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		external: ["yt-dlp-wrap", "@ffmpeg-installer/ffmpeg"],
	},
});
