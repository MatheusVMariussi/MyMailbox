import { truncateUtf8 } from "@/lib/email/inbound-limits";

/**
 * Budget for the header map an inbound queue message carries. Cloudflare Queues refuse messages over
 * 128 KB, and a refused send fails the SMTP transaction, so a sender with huge headers would retry
 * forever; half the limit leaves room for the rest of the payload.
 */
export const MAX_QUEUED_HEADERS_BYTES = 48 * 1024;
const MAX_QUEUED_HEADER_COUNT = 200;
/** Value caps: generous for the headers the pipeline reads, small for the rest. */
const PIPELINE_HEADER_VALUE_BYTES = 8 * 1024;
const OTHER_HEADER_VALUE_BYTES = 1024;

/**
 * Headers the queue consumer reads from the map (authentication verdicts, threading and display,
 * bulk and auto-reply detection, spam signals, the forwarding loop guard). They are kept first, so
 * a sender cannot push them out with filler.
 */
const PIPELINE_HEADERS = [
	"authentication-results",
	"from",
	"subject",
	"reply-to",
	"to",
	"cc",
	"date",
	"message-id",
	"in-reply-to",
	"references",
	"content-type",
	"x-mymailbox-forwarded",
	"list-id",
	"list-unsubscribe",
	"list-unsubscribe-post",
	"list-post",
	"precedence",
	"auto-submitted",
	"x-autoreply",
	"x-autorespond",
	"x-auto-response-suppress",
	"feedback-id",
	"x-campaign",
	"x-campaign-id",
	"x-campaignid",
	"received",
	"x-ses-spam-verdict",
	"x-ses-virus-verdict",
];
const PIPELINE_HEADER_SET = new Set(PIPELINE_HEADERS);
const encoder = new TextEncoder();

/**
 * The header map to enqueue: the pipeline's headers first (each capped at 8 KB), then the others in
 * order (each capped at 1 KB) while the total stays within MAX_QUEUED_HEADERS_BYTES and 200 entries.
 * An ordinary message passes through unchanged.
 */
export function boundQueuedHeaders(headers: Record<string, string>): Record<string, string> {
	const entries = Object.entries(headers);
	const byName = new Map(entries.map(([name, value]) => [name.toLowerCase(), [name, value] as const]));
	const bounded: Record<string, string> = {};
	let total = 0;
	let count = 0;
	const add = (name: string, value: string, maxValueBytes: number): boolean => {
		if (count >= MAX_QUEUED_HEADER_COUNT) return false;
		const kept = truncateUtf8(String(value), maxValueBytes);
		const size = encoder.encode(name).byteLength + encoder.encode(kept).byteLength + 6;
		if (total + size > MAX_QUEUED_HEADERS_BYTES) return false;
		bounded[name] = kept;
		total += size;
		count += 1;
		return true;
	};
	for (const name of PIPELINE_HEADERS) {
		const entry = byName.get(name);
		if (entry) add(entry[0], entry[1], PIPELINE_HEADER_VALUE_BYTES);
	}
	for (const [name, value] of entries) {
		if (PIPELINE_HEADER_SET.has(name.toLowerCase()) || name in bounded) continue;
		add(name, value, OTHER_HEADER_VALUE_BYTES);
	}
	// Keep the sender's order for an unchanged map (the common case), so nothing downstream sees a difference.
	return entries.every(([name, value]) => bounded[name] === value) ? headers : bounded;
}
