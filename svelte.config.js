import adapterNode from "@sveltejs/adapter-node";
import adapterVercel from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

function getAdapter() {
	if (process.env.VERCEL) {
		return adapterVercel({
			runtime: "nodejs20.x",
			maxDuration: 300,
		});
	}
	return adapterNode();
}

const adapter = getAdapter();

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
