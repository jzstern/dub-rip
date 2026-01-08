import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			runtime: "nodejs20.x",
			maxDuration: 300,
		}),

		experimental: {
			tracing: {
				server: true,
			},

			instrumentation: {
				server: true,
			},
		},
	},
};

export default config;
