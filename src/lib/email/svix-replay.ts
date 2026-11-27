/**
 * Replay markers for Svix-signed provider webhooks. A signature stays valid for the timestamp
 * tolerance (5 minutes), so a captured delivery could be sent again within it; each verified
 * delivery leaves an empty R2 object named after its `svix-id`, whose custom metadata records its
 * state:
 *
 * - `processing` (with `claimedAt`, epoch milliseconds) while an attempt runs. A second delivery
 *   meanwhile is refused with a retryable status. An attempt whose isolate died never completes or
 *   releases its claim, so a claim older than `SVIX_CLAIM_STALE_MS` may be re-taken: the provider's
 *   retry (same `svix-id`) is processed instead of being ignored for the marker's lifetime.
 * - `done` once the delivery was handled; later deliveries with the same id are acknowledged
 *   without being processed. A marker without a state (written before states existed) counts as done.
 *
 * A failed attempt deletes its marker so the retry goes through at once. The daily raw-mail sweep
 * removes old markers (`raw-sweeper.ts`). Two deliveries racing between the check and the write
 * can both run; the intake is content-addressed and deduplicated downstream, so that only costs work.
 */
export const SVIX_SEEN_PREFIX = "svix-seen/";

/**
 * How long a `processing` claim blocks a retry. Longer than one request can run (the provider gives
 * up on the connection well before this, and the Worker stops with it), so only a dead attempt's
 * claim is ever this old.
 */
export const SVIX_CLAIM_STALE_MS = 2 * 60 * 1000;

/** Seconds a refused retry is told to wait, so it lands after a dead attempt's claim went stale. */
export const SVIX_CLAIM_RETRY_AFTER_SECONDS = Math.ceil(SVIX_CLAIM_STALE_MS / 1000);

export type SvixClaim =
	| { status: "claimed"; key: string }
	/** Already handled (or no usable id): acknowledge without processing. */
	| { status: "done" }
	/** Another attempt claimed it recently and may still be running: refuse with a retryable status. */
	| { status: "busy" };

/** The marker key for one delivery of one source, or null when the id has nothing usable. */
export function svixSeenKey(source: string, id: string): string | null {
	const safe = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 200);
	return safe ? `${SVIX_SEEN_PREFIX}${source}/${safe}` : null;
}

function isLiveClaim(metadata: Record<string, string> | undefined, now: number): boolean {
	const claimedAt = Number(metadata?.claimedAt);
	return Number.isFinite(claimedAt) && now - claimedAt < SVIX_CLAIM_STALE_MS;
}

/**
 * Claims a verified delivery: a new one, or one whose earlier claim went stale. Returns the marker
 * key to complete or release, `done` when the delivery was already handled, or `busy` while a recent
 * claim may still be processing it.
 */
export async function claimSvixDelivery(bucket: R2Bucket, source: string, id: string, now = Date.now()): Promise<SvixClaim> {
	const key = svixSeenKey(source, id);
	if (!key) return { status: "done" };
	const existing = await bucket.head(key);
	if (existing) {
		if (existing.customMetadata?.state !== "processing") return { status: "done" };
		if (isLiveClaim(existing.customMetadata, now)) return { status: "busy" };
	}
	await bucket.put(key, new Uint8Array(0), { customMetadata: { state: "processing", claimedAt: String(now) } });
	return { status: "claimed", key };
}

/**
 * Marks a claimed delivery handled, so replays are acknowledged without processing. A failure is only
 * logged: the claim then goes stale and a retry is processed again, which the intake deduplicates.
 */
export async function completeSvixDelivery(bucket: R2Bucket, key: string, now = Date.now()): Promise<void> {
	await bucket.put(key, new Uint8Array(0), { customMetadata: { state: "done", completedAt: String(now) } })
		.catch((error) => console.error("Could not complete a webhook replay marker", error));
}

/** Lets the provider's retry of a failed delivery be processed. */
export async function releaseSvixDelivery(bucket: R2Bucket, key: string): Promise<void> {
	await bucket.delete(key).catch((error) => console.error("Could not release a webhook replay marker", error));
}
