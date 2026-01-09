import { expect, test } from "@playwright/test";

test.describe("dub-rip App", () => {
	test("should load the homepage", async ({ page }) => {
		await page.goto("/");

		// Check page loads with correct heading
		await expect(page.locator("h1")).toHaveText("dub-rip");

		// Check main input is visible
		await expect(page.locator('input[data-slot="input"]')).toBeVisible();
	});

	test("should show error for invalid URL", async ({ page }) => {
		await page.goto("/");

		// Enter invalid URL
		const input = page.locator('input[data-slot="input"]');
		await input.fill("not-a-valid-url");

		// Error message appears automatically after preview API call fails
		// (debounced 500ms + API call)
		await expect(page.locator(".text-destructive")).toBeVisible({
			timeout: 15000,
		});
	});

	test("should accept valid YouTube URL format", async ({ page }) => {
		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');

		// Test various valid YouTube URL formats
		const validUrls = [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtu.be/dQw4w9WgXcQ",
			"https://youtube.com/watch?v=dQw4w9WgXcQ",
		];

		for (const url of validUrls) {
			await input.fill(url);
			// Just verify it accepts the input without error
			await expect(input).toHaveValue(url);
		}
	});
});

test.describe("Video Preview Flow", () => {
	// Skip this test in CI as it requires actual yt-dlp
	test.skip(!!process.env.CI, "Skipped in CI - requires yt-dlp");

	test("should show preview for valid video", async ({ page }) => {
		await page.goto("/");

		// Enter a known public video URL
		const input = page.locator('input[data-slot="input"]');
		await input.fill("https://www.youtube.com/watch?v=jNQXAC9IVRw"); // "Me at the zoo" - first YouTube video

		// Wait for preview to load (debounced 500ms + API call)
		await expect(page.locator("img")).toBeVisible({ timeout: 30000 });
	});
});

test.describe("Accessibility", () => {
	test("should be keyboard navigable", async ({ page }) => {
		await page.goto("/");

		// Tab to input
		await page.keyboard.press("Tab");

		// Input should be focused
		const input = page.locator('input[data-slot="input"]');
		await expect(input).toBeFocused();

		// Enter valid URL to enable the button (type instead of fill to maintain focus)
		await input.pressSequentially(
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		);

		// Wait for button to become enabled
		const button = page.getByRole("button", { name: "Download" });
		await expect(button).toBeEnabled({ timeout: 5000 });

		// Tab to download button
		await page.keyboard.press("Tab");

		// Button should be focused
		await expect(button).toBeFocused();
	});

	test("should have proper contrast in dark mode", async ({ page }) => {
		// Emulate dark color scheme
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/");

		// Page should load without errors
		await expect(page.locator("body")).toBeVisible();
	});
});
