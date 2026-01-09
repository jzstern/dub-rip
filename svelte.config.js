import adapterAuto from "@sveltejs/adapter-auto";
import adapterVercel from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Use Vercel adapter on Vercel, adapter-auto elsewhere (avoids @vercel/nft issues on GitHub runners)
const adapter = process.env.VERCEL
	? adapterVercel({
			runtime: "nodejs20.x",
			maxDuration: 300,
		})
	: adapterAuto();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter,
	},
};

export default config;
