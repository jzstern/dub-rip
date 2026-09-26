import * as Sentry from "@sentry/sveltekit";
import { type MediaLink, parseMediaLink } from "$lib/media-link";
import { parseSoundCloudTrackUrl } from "$lib/soundcloud/soundcloud-url";

const SHORT_LINK_TIMEOUT_MS = 5000;

/**
 * An on.soundcloud.com link is a plain 302 to the track page. Its Location is
 * read rather than followed, so the only request made is to a URL built from
 * a validated code, and wherever it points must itself parse as a track.
 */
async function resolveShortLink(code: string): Promise<MediaLink | null> {
	try {
		const response = await fetch(`https://on.soundcloud.com/${code}`, {
			redirect: "manual",
			signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS),
		});
		const location = response.headers.get("location");
		const track = location ? parseSoundCloudTrackUrl(location) : null;
		if (!track) {
			Sentry.addBreadcrumb({
				category: "soundcloud",
				level: "info",
				message: "Share link did not resolve to a track",
				data: { status: response.status },
			});
			return null;
		}
		return { kind: "soundcloud", ...track };
	} catch (error) {
		Sentry.captureException(error, {
			level: "warning",
			tags: { service: "soundcloud", operation: "resolve-short-link" },
		});
		return null;
	}
}

export async function resolveMediaLink(
	input: string,
): Promise<MediaLink | null> {
	const parsed = parseMediaLink(input);
	if (!parsed) return null;
	if (parsed.kind === "soundcloud-short-link")
		return resolveShortLink(parsed.code);
	return parsed;
}
