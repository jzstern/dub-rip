# E2E Testing with Playwright

Run end-to-end tests for the full user journey.

## Instructions

1. **Check Playwright installation**:
```bash
bunx playwright --version || bun add -d @playwright/test && bunx playwright install
```

2. **Start dev server** (if not running):
```bash
bun run dev &
```

3. **Run E2E tests**:
```bash
bunx playwright test
```

4. **If no tests exist**, create them in `tests/e2e/`:

### Core User Journeys to Test

#### Journey 1: Single Video Download
```typescript
// tests/e2e/single-video.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Single Video Download', () => {
	test('should preview and download a video', async ({ page }) => {
		await page.goto('/');

		// Enter valid YouTube URL
		await page.fill('input[type="text"]', 'https://youtube.com/watch?v=dQw4w9WgXcQ');

		// Click preview/submit
		await page.click('button[type="submit"]');

		// Wait for preview to load
		await expect(page.locator('[data-testid="video-preview"]')).toBeVisible({ timeout: 30000 });

		// Verify title is displayed
		await expect(page.locator('[data-testid="video-title"]')).not.toBeEmpty();

		// Click download
		await page.click('[data-testid="download-button"]');

		// Verify download started (progress visible)
		await expect(page.locator('[data-testid="progress"]')).toBeVisible();
	});
});
```

#### Journey 2: Error Handling
```typescript
test('should show error for invalid URL', async ({ page }) => {
	await page.goto('/');
	await page.fill('input[type="text"]', 'not-a-valid-url');
	await page.click('button[type="submit"]');

	await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
});

test('should show error for private video', async ({ page }) => {
	await page.goto('/');
	await page.fill('input[type="text"]', 'https://youtube.com/watch?v=PRIVATE_VIDEO_ID');
	await page.click('button[type="submit"]');

	await expect(page.locator('[data-testid="error-message"]')).toContainText(/private|unavailable/i);
});
```

#### Journey 3: Playlist Handling
```typescript
test('should handle playlist URL correctly', async ({ page }) => {
	await page.goto('/');
	await page.fill('input[type="text"]', 'https://youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
	await page.click('button[type="submit"]');

	// Should show playlist preview or option
	await expect(page.locator('[data-testid="playlist-preview"]')).toBeVisible({ timeout: 30000 });
});
```

5. **Create Playwright config** if not present:
```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60000,
	webServer: {
		command: 'bun run dev',
		port: 5173,
		reuseExistingServer: true,
	},
	use: {
		baseURL: 'http://localhost:5173',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
});
```

6. **Report results** with screenshots/videos for failures.

7. **AI Analysis**: After tests complete, analyze any failures:
   - Read the error messages
   - Check screenshots in `test-results/`
   - Suggest fixes for failing tests
