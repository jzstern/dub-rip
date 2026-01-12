import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import VideoPreview from "$lib/components/VideoPreview.svelte";
import type { VideoPreview as VideoPreviewType } from "$lib/types";

function formatDuration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

describe("VideoPreview", () => {
	describe("rendering", () => {
		it("displays video title", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Rick Astley - Never Gonna Give You Up",
				artist: "Rick Astley",
				title: "Never Gonna Give You Up",
				thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.getByText("Never Gonna Give You Up")).toBeInTheDocument();
		});

		it("falls back to videoTitle when title is empty", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Some Video Title",
				artist: "Artist",
				title: "",
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.getByText("Some Video Title")).toBeInTheDocument();
		});

		it("displays artist name", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Test Video",
				artist: "Test Artist",
				title: "Test Title",
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.getByText("Test Artist")).toBeInTheDocument();
		});

		it("displays thumbnail with correct src and alt", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Test Video",
				artist: "Test Artist",
				title: "My Song",
				thumbnail: "https://i.ytimg.com/vi/xyz789/hqdefault.jpg",
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			const img = screen.getByRole("img");
			expect(img).toHaveAttribute(
				"src",
				"https://i.ytimg.com/vi/xyz789/hqdefault.jpg",
			);
			expect(img).toHaveAttribute("alt", "My Song");
		});
	});

	describe("duration display", () => {
		it("displays formatted duration when provided", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Test Video",
				artist: "Test Artist",
				title: "Test Title",
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
				duration: 212,
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.getByText("3:32")).toBeInTheDocument();
		});

		it("does not display duration when not provided", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Test Video",
				artist: "Test Artist",
				title: "Test Title",
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.queryByText(/^\d+:\d+$/)).not.toBeInTheDocument();
		});

		it("displays separator between artist and duration", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Test Video",
				artist: "Test Artist",
				title: "Test Title",
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
				duration: 180,
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.getByText("•")).toBeInTheDocument();
		});
	});

	describe("edge cases", () => {
		it("handles preview without artist", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Video Without Artist",
				artist: "",
				title: "Just a Title",
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
				duration: 60,
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.getByText("Just a Title")).toBeInTheDocument();
			expect(screen.getByText("1:00")).toBeInTheDocument();
			expect(screen.queryByText("•")).not.toBeInTheDocument();
		});

		it("handles zero duration", () => {
			// #given
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: "Test Video",
				artist: "Test Artist",
				title: "Test Title",
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
				duration: 0,
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			expect(screen.queryByText("0:00")).not.toBeInTheDocument();
		});

		it("handles long titles with truncation", () => {
			// #given
			const longTitle =
				"This is a very long video title that should be truncated in the UI to prevent layout issues";
			const preview: VideoPreviewType = {
				success: true,
				videoTitle: longTitle,
				artist: "Artist",
				title: longTitle,
				thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
			};

			// #when
			render(VideoPreview, { props: { preview, formatDuration } });

			// #then
			const titleElement = screen.getByText(longTitle);
			expect(titleElement).toHaveClass("truncate");
		});
	});
});
