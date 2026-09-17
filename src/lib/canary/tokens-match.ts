import { createHash, timingSafeEqual } from "node:crypto";

/**
 * `timingSafeEqual` throws on unequal-length buffers, which would leak
 * length through a thrown-vs-not-thrown timing difference. Hashing both
 * sides to a fixed-length digest first removes that branch entirely.
 */
export function tokensMatch(provided: string, expected: string): boolean {
	const providedDigest = createHash("sha256").update(provided).digest();
	const expectedDigest = createHash("sha256").update(expected).digest();
	return timingSafeEqual(providedDigest, expectedDigest);
}
