/**
 * Replay markers for Svix-signed provider webhooks. A signature stays valid for the timestamp
 * tolerance (5 minutes), so a captured delivery could be sent again within it; each verified
 * delivery leaves an empty R2 object named after its `svix-id`, and a second delivery with the same
 * id is acknowledged without being processed. The daily raw-mail sweep removes old markers
 * (`raw-sweeper.ts`). Two deliveries racing between the check and the write can both run; the
 * intake is content-addressed and deduplicated downstream, so that only costs work.
 */
export const SVIX_SEEN_PREFIX = "svix-seen/";

/** The marker key for one delivery of one source, or null when the id has nothing usable. */
export function svixSeenKey(source: string, id: string): string | null {
	const safe = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 200);
	return safe ? `${SVIX_SEEN_PREFIX}${source}/${safe}` : null;
}

/**
 * Claims a verified delivery. Returns the marker key to release if processing fails, or null when
 * the delivery was already processed (or claimed by an attempt still running).
 */
export async function claimSvixDelivery(bucket: R2Bucket, source: string, id: string): Promise<string | null> {
	const key = svixSeenKey(source, id);
	if (!key) return null;
	if (await bucket.head(key)) return null;
	await bucket.put(key, new Uint8Array(0));
	return key;
}

/** Lets the provider's retry of a failed delivery be processed. */
export async function releaseSvixDelivery(bucket: R2Bucket, key: string): Promise<void> {
	await bucket.delete(key).catch((error) => console.error("Could not release a webhook replay marker", error));
}
