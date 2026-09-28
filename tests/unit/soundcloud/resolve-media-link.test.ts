import * as Sentry from "@sentry/sveltekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMediaLink } from "$lib/resolve-media-link";

function redirectTo(location: string | null) {
	return vi.fn(async () => ({
		status: location ? 302 : 404,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "location" ? location : null,
		},
	}));
}

describe("resolveMediaLink()", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureException).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns a YouTube link without any network request", async () => {
		// #given
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const link = await resolveMediaLink(
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		);

		// #then
		expect(link?.kind).toBe("youtube");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("follows a share link's redirect header to the track", async () => {
		// #given
		const fetchMock = redirectTo(
			"https://soundcloud.com/ilaytsa/crashout?si=34a2&utm_source=clipboard",
		);
		vi.stubGlobal("fetch", fetchMock);

		// #when
		const link = await resolveMediaLink(
			"https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9",
		);

		// #then
		expect(link).toEqual({
			kind: "soundcloud",
			id: "ilaytsa/crashout",
			canonicalUrl: "https://soundcloud.com/ilaytsa/crashout",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://on.soundcloud.com/2iQZMwo9IQ8wLY3vf9",
			expect.objectContaining({ redirect: "manual" }),
		);
	});

	it("rejects a share link that points at a playlist", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			redirectTo("https://soundcloud.com/billieeilish/sets/album"),
		);

		// #when
		const link = await resolveMediaLink("https://on.soundcloud.com/abc123");

		// #then
		expect(link).toBeNull();
	});

	it("reports a share-link lookup that throws, and rejects the link", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("socket hang up");
			}),
		);

		// #when
		const link = await resolveMediaLink("https://on.soundcloud.com/abc123");

		// #then
		expect(link).toBeNull();
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ level: "warning" }),
		);
	});

	it("keeps the share-link code out of the exception payload when the lookup throws", async () => {
		// #given
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("socket hang up");
			}),
		);

		// #when
		await resolveMediaLink("https://on.soundcloud.com/secretCode456");

		// #then
		const [, captureOptions] = vi
			.mocked(Sentry.captureException)
			.mock.calls.at(-1) as [unknown, Record<string, unknown> | undefined];
		expect(captureOptions).not.toHaveProperty("extra");
	});

	it("keeps the share-link code out of the breadcrumb when the link doesn't resolve to a track", async () => {
		// #given
		vi.mocked(Sentry.addBreadcrumb).mockClear();
		vi.stubGlobal(
			"fetch",
			redirectTo("https://soundcloud.com/billieeilish/sets/album"),
		);

		// #when
		await resolveMediaLink("https://on.soundcloud.com/secretCode789");

		// #then
		expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
			expect.objectContaining({ data: { status: 302 } }),
		);
	});
});
