import { expect, type Page, test } from "@playwright/test";

const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const FILENAME = "Test Artist - Test Title.mp3";
const TOKEN = "token-abc";
const EXPIRED_MESSAGE =
	"The prepared file expired before it reached you. Press Download to try again.";
const RETRIEVAL_MESSAGE =
	"Download finished but the file could not be retrieved";

function sse(...events: Record<string, unknown>[]): string {
	return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function mockPreview(page: Page): Promise<void> {
	await page.route("**/api/preview/details", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, duration: 213 }),
		}),
	);
	await page.route("**/api/preview", (route) =>
		route.fulfill({
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
		}),
	);
}

async function mockStream(page: Page, body: string): Promise<void> {
	await page.route("**/api/download-stream**", (route) =>
		route.fulfill({
			status: 200,
			headers: { "Cache-Control": "no-cache" },
			contentType: "text/event-stream",
			body,
		}),
	);
}

async function mockFile(page: Page): Promise<void> {
	await page.route("**/api/download-file**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "audio/mpeg",
			body: "fake-mp3-bytes",
		}),
	);
}

async function startDownload(page: Page): Promise<void> {
	await page.goto("/");
	await page.locator('input[data-slot="input"]').fill(YOUTUBE_URL);
	const button = page.getByRole("button", { name: "Download" });
	await expect(button).toBeEnabled();
	await button.click();
}

const completeStream = sse(
	{ type: "status", message: "Fetching audio..." },
	{ type: "info", title: "Test Video" },
	{ type: "progress", percent: 50, speed: "1.0MiB/s", eta: "00:05" },
	{ type: "complete", token: TOKEN, filename: FILENAME },
);

test.describe("Download flow", () => {
	test.beforeEach(async ({ page }) => {
		await mockPreview(page);
	});

	test("saves the file and reports success", async ({ page }) => {
		// #given
		let requestedToken: string | null = null;
		await mockStream(page, completeStream);
		await page.route("**/api/download-file**", (route) => {
			requestedToken = new URL(route.request().url()).searchParams.get("token");
			return route.fulfill({
				status: 200,
				contentType: "audio/mpeg",
				body: "fake-mp3-bytes",
			});
		});

		// #when
		const downloadPromise = page.waitForEvent("download");
		await startDownload(page);
		const download = await downloadPromise;

		// #then
		expect(download.suggestedFilename()).toBe(FILENAME);
		await expect(page.getByText("Downloaded!")).toBeVisible();
		await page.waitForTimeout(1000);
		await expect(page.getByText("Downloaded!")).toBeVisible();
		expect(requestedToken).toBe(TOKEN);
		await expect(page.locator('input[data-slot="input"]')).toHaveValue("");
		await expect(page.locator(".text-destructive")).toHaveCount(0);
	});

	test("shows the server's error message when the stream reports an error", async ({
		page,
	}) => {
		// #given
		let fileRequested = false;
		await mockStream(
			page,
			sse(
				{ type: "status", message: "Fetching audio..." },
				{ type: "error", message: "This video is private." },
			),
		);
		await page.route("**/api/download-file**", (route) => {
			fileRequested = true;
			return route.abort();
		});

		// #when
		await startDownload(page);

		// #then
		await expect(page.getByText("This video is private.")).toBeVisible();
		await expect(page.getByText("Connection lost")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
		expect(fileRequested).toBe(false);
	});

	test("shows 'Connection lost' when the stream cannot connect", async ({
		page,
	}) => {
		// #given
		await page.route("**/api/download-stream**", (route) =>
			route.abort("connectionreset"),
		);

		// #when
		await startDownload(page);

		// #then
		await expect(page.getByText("Connection lost")).toBeVisible();
		await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
	});

	test("shows 'Connection lost' when the stream ends mid-download", async ({
		page,
	}) => {
		// #given
		await mockStream(
			page,
			sse(
				{ type: "info", title: "Test Video" },
				{ type: "progress", percent: 30 },
			),
		);

		// #when
		await startDownload(page);

		// #then
		await expect(page.getByText("Connection lost")).toBeVisible();
		await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
	});

	test("tells the user to retry when the prepared file has expired (404)", async ({
		page,
	}) => {
		// #given
		await mockStream(page, completeStream);
		await page.route("**/api/download-file**", (route) =>
			route.fulfill({
				status: 404,
				contentType: "application/json",
				body: JSON.stringify({ error: "File not found" }),
			}),
		);

		// #when
		await startDownload(page);

		// #then
		await expect(page.getByText(EXPIRED_MESSAGE)).toBeVisible();
		await expect(page.getByText("Downloaded!")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
		await expect(page.locator('input[data-slot="input"]')).toHaveValue(
			YOUTUBE_URL,
		);
	});

	test("shows a generic retrieval error for an unexpected file status", async ({
		page,
	}) => {
		// #given
		await mockStream(page, completeStream);
		await page.route("**/api/download-file**", (route) =>
			route.fulfill({ status: 500, body: "boom" }),
		);

		// #when
		await startDownload(page);

		// #then
		await expect(page.getByText(RETRIEVAL_MESSAGE)).toBeVisible();
		await expect(page.getByText("Downloaded!")).toHaveCount(0);
	});

	test("shows a generic retrieval error when the file fetch fails outright", async ({
		page,
	}) => {
		// #given
		await mockStream(page, completeStream);
		await page.route("**/api/download-file**", (route) => route.abort());

		// #when
		await startDownload(page);

		// #then
		await expect(page.getByText(RETRIEVAL_MESSAGE)).toBeVisible();
	});

	test("ignores a malformed stream event and keeps the download going", async ({
		page,
	}) => {
		// #given
		await mockStream(
			page,
			`data: {not json\n\n${sse({ type: "complete", token: TOKEN, filename: FILENAME })}`,
		);
		await mockFile(page);

		// #when
		const downloadPromise = page.waitForEvent("download");
		await startDownload(page);
		const download = await downloadPromise;

		// #then
		expect(download.suggestedFilename()).toBe(FILENAME);
		await expect(page.getByText("Downloaded!")).toBeVisible();
	});

	test("allows a retry after a failure and then succeeds", async ({ page }) => {
		// #given
		let attempts = 0;
		await page.route("**/api/download-stream**", (route) => {
			attempts += 1;
			return route.fulfill({
				status: 200,
				contentType: "text/event-stream",
				body:
					attempts === 1
						? sse({ type: "error", message: "Temporary failure." })
						: completeStream,
			});
		});
		await mockFile(page);
		await startDownload(page);
		await expect(page.getByText("Temporary failure.")).toBeVisible();

		// #when
		const downloadPromise = page.waitForEvent("download");
		await page.getByRole("button", { name: "Download" }).click();
		const download = await downloadPromise;

		// #then
		expect(download.suggestedFilename()).toBe(FILENAME);
		await expect(page.getByText("Temporary failure.")).toHaveCount(0);
		await expect(page.getByText("Downloaded!")).toBeVisible();
	});
});
