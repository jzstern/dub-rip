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

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: getAdapter(),
	},
};

export default config;
