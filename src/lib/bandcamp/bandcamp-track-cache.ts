import type { MediaLink } from "$lib/media-link";
import { createSingleFlightCache } from "$lib/single-flight-cache";
import {
	type BandcampTrack,
	BandcampTrackError,
	fetchBandcampTrack,
} from "./bandcamp-track";

const TRACK_TTL_MS = 10 * 60 * 1000;
/** Long enough to span one user's preview, details and download. */
const FAILURE_TTL_MS = 2 * 60 * 1000;
const MAX_REMEMBERED_FAILURES = 1000;

const cache = createSingleFlightCache<BandcampTrack>();
const recentFailures = new Map<
	string,
	{ error: BandcampTrackError; expiresAt: number }
>();

function rememberFailure(id: string, error: BandcampTrackError): void {
	if (recentFailures.size >= MAX_REMEMBERED_FAILURES) recentFailures.clear();
	recentFailures.set(id, { error, expiresAt: Date.now() + FAILURE_TTL_MS });
}

/**
 * One page fetch per track across preview, details and download. A failed
 * lookup is remembered too: the single-flight cache never stores a
 * rejection, so without this the three requests of one download would each
 * refetch the page, and fetchBandcampTrack would report one incident three
 * times.
 */
export async function getBandcampTrack(
	link: MediaLink,
): Promise<BandcampTrack> {
	const failure = recentFailures.get(link.id);
	if (failure && failure.expiresAt > Date.now()) throw failure.error;
	recentFailures.delete(link.id);

	try {
		return await cache.get(
			link.id,
			() => fetchBandcampTrack(link.canonicalUrl),
			TRACK_TTL_MS,
		);
	} catch (error) {
		if (error instanceof BandcampTrackError) rememberFailure(link.id, error);
		throw error;
	}
}

export function clearBandcampTrackCache(): void {
	cache.clear();
	recentFailures.clear();
}
