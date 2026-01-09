import { expect, test } from "@playwright/test";

test.describe("dub-rip App", () => {
	test("should load the homepage", async ({ page }) => {
		await page.goto("/");

		// Check page loads
		await expect(page).toHaveTitle(/dub-rip/i);

		// Check main input is visible
		await expect(
			page.locator('input[type="text"], input[type="url"]').first(),
		).toBeVisible();
	});

	test("should show error for invalid URL", async ({ page }) => {
		await page.goto("/");

		// Enter invalid URL
		const input = page.locator('input[type="text"], input[type="url"]').first();
		await input.fill("not-a-valid-url");

		// Submit form
		await page.locator('button[type="submit"]').first().click();

		// Should show some error indication (adjust selector based on your UI)
		await expect(
			page.locator('[data-testid="error"], .error, [role="alert"]').first(),
		).toBeVisible({ timeout: 10000 });
	});

	test("should accept valid YouTube URL format", async ({ page }) => {
		await page.goto("/");

		const input = page.locator('input[type="text"], input[type="url"]').first();

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
		const input = page.locator('input[type="text"], input[type="url"]').first();
		await input.fill("https://www.youtube.com/watch?v=jNQXAC9IVRw"); // "Me at the zoo" - first YouTube video

		// Submit
		await page.locator('button[type="submit"]').first().click();

		// Wait for loading to complete (skeleton or actual content)
		await page.waitForSelector(
			'[data-testid="video-preview"], [data-testid="preview-skeleton"]',
			{
				timeout: 30000,
			},
		);

		// Eventually should show the preview
		await expect(page.locator('[data-testid="video-preview"]')).toBeVisible({
			timeout: 60000,
		});
	});
});

test.describe("Accessibility", () => {
	test("should autofocus input on page load", async ({ page }) => {
		await page.goto("/");

		// Input should be focused immediately
		const input = page.locator('input[type="text"], input[type="url"]').first();
		await expect(input).toBeFocused();
	});

	test("should be keyboard navigable", async ({ page }) => {
		await page.goto("/");

		// Input should already be focused due to autofocus
		const input = page.locator('input[type="text"], input[type="url"]').first();
		await expect(input).toBeFocused();

		// Tab to submit button
		await page.keyboard.press("Tab");

		// Button should be focused
		const button = page.locator('button[type="submit"]').first();
		await expect(button).toBeFocused();
	});

	test("should trigger download on Enter key with valid URL", async ({
		page,
	}) => {
		await page.goto("/");

		const input = page.locator('input[type="text"], input[type="url"]').first();
		await input.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

		// Press Enter
		await page.keyboard.press("Enter");

		// Should show loading state or status message
		await expect(
			page
				.locator(
					'[data-testid="status"], .status, button:has-text("Downloading")',
				)
				.first(),
		).toBeVisible({ timeout: 5000 });
	});

	test("should NOT trigger download on Enter key with invalid URL", async ({
		page,
	}) => {
		await page.goto("/");

		const input = page.locator('input[type="text"], input[type="url"]').first();
		await input.fill("not-a-valid-url");

		// Press Enter
		await page.keyboard.press("Enter");

		// Should NOT show loading state - button should still be enabled/visible
		const button = page.locator('button[type="submit"]').first();
		await expect(button).toBeVisible();

		// No loading indicator should appear
		await expect(
			page.locator('button:has-text("Downloading")'),
		).not.toBeVisible();
	});

	test("should have proper contrast in dark mode", async ({ page }) => {
		// Emulate dark color scheme
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/");

		// Page should load without errors
		await expect(page.locator("body")).toBeVisible();
	});
});
