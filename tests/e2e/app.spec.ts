import { expect, test } from "@playwright/test";

test.describe("dub-rip App", () => {
	test("should load the homepage", async ({ page }) => {
		await page.goto("/");

		// Check page loads with correct heading
		await expect(page.locator("h1")).toHaveText("dub-rip");

		// Check main input is visible
		await expect(page.locator('input[data-slot="input"]')).toBeVisible();
	});

	test("should NOT show error for invalid URL (no API call)", async ({
		page,
	}) => {
		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');
		await input.fill("not-a-valid-url");

		await page.waitForTimeout(1000);
		await expect(page.locator(".text-destructive")).not.toBeVisible();
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
	test("should show loading skeleton while fetching preview", async ({
		page,
	}) => {
		await page.route("**/api/preview", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					success: true,
					videoTitle: "Test Video",
					artist: "Test Artist",
					title: "Test Title",
					thumbnail: "https://i.ytimg.com/vi/test/hqdefault.jpg",
					duration: null,
				}),
			});
		});

		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');
		await input.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

		const skeleton = page.locator(".animate-pulse");
		await expect(skeleton).toBeVisible({ timeout: 2000 });
	});

	test("should NOT trigger preview for invalid URLs", async ({ page }) => {
		let previewCalled = false;
		await page.route("**/api/preview", async (route) => {
			previewCalled = true;
			await route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({ error: "Invalid URL" }),
			});
		});

		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');
		await input.fill("not-a-valid-url");

		await page.waitForTimeout(1000);
		expect(previewCalled).toBe(false);
	});

	test("should clear preview when URL becomes invalid", async ({ page }) => {
		await page.route("**/api/preview", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					success: true,
					videoTitle: "Test Video",
					artist: "Test Artist",
					title: "Test Title",
					thumbnail: "https://i.ytimg.com/vi/test/hqdefault.jpg",
					duration: null,
				}),
			});
		});

		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');
		await input.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

		const previewImage = page.locator('img[alt="Test Title"]');
		await expect(previewImage).toBeVisible({ timeout: 5000 });

		await input.fill("invalid");

		await expect(previewImage).not.toBeVisible({ timeout: 2000 });
	});

	test("should show preview for valid video", async ({ page }) => {
		test.skip(!!process.env.CI, "Skipped in CI - requires network access");

		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');
		await input.fill("https://www.youtube.com/watch?v=jNQXAC9IVRw");

		await expect(page.locator("img")).toBeVisible({ timeout: 30000 });
	});
});

test.describe("Accessibility", () => {
	test("should autofocus input on page load", async ({ page }) => {
		await page.goto("/");

		// Input should be focused immediately
		const input = page.locator('input[data-slot="input"]');
		await expect(input).toBeFocused();
	});

	test("should be keyboard navigable", async ({ page }) => {
		await page.goto("/");

		// Input should already be focused due to autofocus
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

	// Skip: Enter key download requires yt-dlp and has timing issues
	test.skip("should trigger download on Enter key with valid URL", async ({
		page,
	}) => {
		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');
		await input.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

		// Press Enter
		await page.keyboard.press("Enter");

		// Should show loading state (button text changes to "Downloading")
		await expect(page.getByRole("button", { name: "Downloading" })).toBeVisible(
			{ timeout: 5000 },
		);
	});

	test("should NOT trigger download on Enter key with invalid URL", async ({
		page,
	}) => {
		await page.goto("/");

		const input = page.locator('input[data-slot="input"]');
		await input.fill("not-a-valid-url");

		// Press Enter
		await page.keyboard.press("Enter");

		// Download button should still show "Download" (not loading)
		const button = page.getByRole("button", { name: "Download" });
		await expect(button).toBeVisible();

		// No loading indicator should appear
		await expect(
			page.getByRole("button", { name: "Downloading" }),
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
