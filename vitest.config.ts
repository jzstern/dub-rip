import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [sveltekit(), svelteTesting()],
	test: {
		include: ["tests/unit/**/*.{test,spec}.ts", "src/**/*.{test,spec}.ts"],
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/**",
				"tests/**",
				"**/*.d.ts",
				"**/*.config.*",
				"src/lib/components/ui/**",
			],
			thresholds: {
				statements: 50,
				branches: 50,
				functions: 50,
				lines: 50,
			},
		},
	},
});
