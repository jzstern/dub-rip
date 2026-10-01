import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 4173;
const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [["html", { open: "never" }], ["list"]],
	timeout: 60000,

	use: {
		baseURL: E2E_ORIGIN,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},

	webServer: {
		command: "bun run vite build && node build/index.js",
		env: { PORT: String(E2E_PORT), HOST: "127.0.0.1" },
		url: `${E2E_ORIGIN}/api/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
	},

	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
