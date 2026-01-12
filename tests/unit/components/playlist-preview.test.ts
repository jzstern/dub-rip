import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PlaylistPreview from "$lib/components/PlaylistPreview.svelte";
import type { PlaylistInfo } from "$lib/types";

describe("PlaylistPreview", () => {
	describe("rendering", () => {
		it("displays playlist title", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "80s Greatest Hits",
				count: 25,
				uploader: "MusicLover",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(
				screen.getByText("Playlist: 80s Greatest Hits"),
			).toBeInTheDocument();
		});

		it("displays video count", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 42,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(screen.getAllByText(/42 videos/).length).toBeGreaterThan(0);
		});

		it("displays uploader name", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 10,
				uploader: "Famous Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(screen.getByText(/Famous Creator/)).toBeInTheDocument();
		});

		it("displays checkbox for playlist download option", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 10,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			const checkbox = screen.getByRole("checkbox");
			expect(checkbox).toBeInTheDocument();
		});

		it("displays download option text with count", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 15,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(
				screen.getByText("Download entire playlist (15 videos)"),
			).toBeInTheDocument();
		});
	});

	describe("checkbox state", () => {
		it("checkbox is unchecked when downloadPlaylist is false", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 10,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			const checkbox = screen.getByRole("checkbox");
			expect(checkbox).not.toBeChecked();
		});

		it("checkbox is checked when downloadPlaylist is true", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 10,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: true, onToggle },
			});

			// #then
			const checkbox = screen.getByRole("checkbox");
			expect(checkbox).toBeChecked();
		});
	});

	describe("interactions", () => {
		it("checkbox can be toggled", async () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 10,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #when
			const checkbox = screen.getByRole("checkbox");
			await fireEvent.click(checkbox);

			// #then
			expect(checkbox).toBeChecked();
		});

		it("checkbox label is clickable", async () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "My Playlist",
				count: 10,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #when
			const label = screen.getByText("Download entire playlist (10 videos)");
			await fireEvent.click(label);

			// #then
			const checkbox = screen.getByRole("checkbox");
			expect(checkbox).toBeChecked();
		});
	});

	describe("edge cases", () => {
		it("handles playlist with single video", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "Single Video Playlist",
				count: 1,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(screen.getAllByText(/1 videos/).length).toBeGreaterThan(0);
		});

		it("handles playlist with zero videos", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "Empty Playlist",
				count: 0,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(screen.getAllByText(/0 videos/).length).toBeGreaterThan(0);
		});

		it("handles playlist with empty uploader", () => {
			// #given
			const playlist: PlaylistInfo = {
				title: "Anonymous Playlist",
				count: 5,
				uploader: "",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(
				screen.getByText("Playlist: Anonymous Playlist"),
			).toBeInTheDocument();
		});

		it("handles long playlist title", () => {
			// #given
			const playlist: PlaylistInfo = {
				title:
					"This is a very long playlist title that might need truncation in the UI",
				count: 100,
				uploader: "Creator",
			};
			const onToggle = vi.fn();

			// #when
			render(PlaylistPreview, {
				props: { playlist, downloadPlaylist: false, onToggle },
			});

			// #then
			expect(
				screen.getByText(
					/Playlist: This is a very long playlist title that might need truncation in the UI/,
				),
			).toBeInTheDocument();
		});
	});
});
