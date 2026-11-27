import { getEmailAddress, normalizeEmailAddress, splitEmailAddressList } from "@/lib/email/address";

export type SuppressionMode = "off" | "record" | "enforce";
export type SuppressionReason = "hard_bounce" | "complaint" | "manual";
/** `dsn`: a returned bounce message read by inbound mail; `admin`: added in the admin UI. */
export type SuppressionSource = "dsn" | "admin";

export const SUPPRESSED_RECIPIENT_CODE = "SUPPRESSED_RECIPIENT";
export const MAX_SUPPRESSION_DETAIL = 300;

/** Thrown before anything is stored or sent when a recipient is on the sending domain's suppression list. */
export class SuppressedRecipientError extends Error {
	readonly code = SUPPRESSED_RECIPIENT_CODE;
	constructor(readonly addresses: string[]) {
		super(`These addresses bounced or reported spam: ${addresses.join(", ")}`);
	}
}

/** Body of the 422 that /api/send and /api/v1/send answer with. */
export function suppressedRecipientBody(error: SuppressedRecipientError) {
	return { error: error.message, code: error.code, addresses: error.addresses };
}

/**
 * JMAP EmailSubmission/set `notCreated` entry (RFC 8621 section 7.5). `recipientHeaders` are the
 * client's To/Cc/Bcc values: the addresses are echoed the way the client wrote them, not lower-cased.
 */
export function suppressedSubmissionError(error: SuppressedRecipientError, recipientHeaders: (string | null | undefined)[] = []) {
	const written = new Map<string, string>();
	for (const header of recipientHeaders) {
		for (const recipient of splitEmailAddressList(header)) {
			const address = getEmailAddress(recipient).trim();
			if (!written.has(address.toLowerCase())) written.set(address.toLowerCase(), address);
		}
	}
	const invalidRecipients = error.addresses.map((address) => written.get(address) ?? address);
	return { type: "invalidRecipients", description: new SuppressedRecipientError(invalidRecipients).message, invalidRecipients };
}

const looksLikeAddress = (value: string) => /^[^\s@<>]+@[^\s@<>]+$/.test(value);

/** Bare lower-case address, or null for anything that is not one. */
export function cleanAddress(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const address = normalizeEmailAddress(value);
	return looksLikeAddress(address) ? address : null;
}

export const addressDomain = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/** Splits header-style recipients into those still allowed (original entries kept) and the suppressed bare addresses. */
export function filterSuppressed(recipients: string[], suppressed: ReadonlySet<string>): { allowed: string[]; suppressed: string[] } {
	const allowed: string[] = [];
	const dropped = new Set<string>();
	for (const recipient of recipients) {
		const address = normalizeEmailAddress(recipient);
		if (suppressed.has(address)) dropped.add(address);
		else allowed.push(recipient.trim());
	}
	return { allowed, suppressed: [...dropped] };
}
