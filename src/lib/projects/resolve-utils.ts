import { getEmailAddress, getEmailAddressList, normalizeEmailAddress } from "@/lib/email/address";
import { normalizeRecipientLocalPart } from "@/lib/email/recipient-address";
import type {
	ProjectAddressInput,
	ProjectAddressRow,
	ProjectHostMapping,
	ProjectLocalPartMapping,
	ProjectStampSource,
} from "./types";

/** Longest local part a project may own (RFC 5321 allows 64). */
export const PROJECT_LOCAL_PART_MAX = 64;

/** The bare, lower-cased local part and hostname of an address (display names and angle brackets removed). */
export function splitProjectAddress(address: string): { localPart: string; hostname: string } | null {
	const bare = normalizeEmailAddress(address ?? "");
	const at = bare.lastIndexOf("@");
	if (at <= 0 || at === bare.length - 1) return null;
	const localPart = bare.slice(0, at);
	const hostname = bare.slice(at + 1);
	if (/\s/.test(localPart) || /[\s@]/.test(hostname)) return null;
	return { localPart, hostname };
}

/**
 * The project owning `localPart` on one domain: the mapping whose local part normalizes alike (dots and
 * plus tags ignored, as routing does), else the domain default (empty local part), else none. Ties go to
 * the first mapping, so callers pass rows in a stable order.
 */
export function pickProjectForLocalPart(mappings: readonly ProjectLocalPartMapping[], localPart: string): string | null {
	const wanted = normalizeRecipientLocalPart(localPart);
	let fallback: string | null = null;
	for (const mapping of mappings) {
		if (!mapping.localPart) {
			fallback ??= mapping.projectId;
			continue;
		}
		if (wanted && normalizeRecipientLocalPart(mapping.localPart) === wanted) return mapping.projectId;
	}
	return fallback;
}

/** The project owning an address, looking only at mappings on the address's own domain. */
export function resolveProjectForAddress(mappings: readonly ProjectHostMapping[], address: string): string | null {
	const parts = splitProjectAddress(address);
	if (!parts) return null;
	return pickProjectForLocalPart(mappings.filter((mapping) => mapping.hostname.toLowerCase() === parts.hostname), parts.localPart);
}

/**
 * A local part as stored: trimmed and lower-cased, "" for the whole domain. Null when it cannot be one
 * address: whitespace, `@`, a plus tag (it would claim the base address too) or longer than 64.
 */
export function normalizeProjectLocalPart(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const localPart = value.trim().toLowerCase();
	if (localPart.length > PROJECT_LOCAL_PART_MAX) return null;
	if (/[\s@+"<>,;\\]/.test(localPart) || /\p{Cc}/u.test(localPart)) return null;
	return localPart;
}

/**
 * Requested addresses that would share a normalized local part with another project's address on the
 * same domain, or with an earlier entry of the same request. Rows of `projectId` itself are being replaced.
 */
export function findLocalPartConflicts(
	existing: readonly ProjectAddressRow[],
	requested: readonly ProjectAddressInput[],
	projectId: string,
): ProjectAddressInput[] {
	const key = (entry: ProjectAddressInput) => `${entry.domainId}\u0000${entry.localPart ? normalizeRecipientLocalPart(entry.localPart) : ""}`;
	const taken = new Set(existing.filter((row) => row.projectId !== projectId).map(key));
	const conflicts: ProjectAddressInput[] = [];
	for (const entry of requested) {
		const entryKey = key(entry);
		if (taken.has(entryKey)) {
			conflicts.push(entry);
			continue;
		}
		taken.add(entryKey);
	}
	return conflicts;
}

/**
 * The addresses a message belongs to, in order: the envelope recipient for inbound mail (or, for mail
 * stored before it was kept, every To and Cc address), the From address otherwise.
 */
export function messageOwnAddresses(message: ProjectStampSource): string[] {
	if (message.direction !== "inbound") {
		const from = getEmailAddress(message.fromAddr ?? "").trim().toLowerCase();
		return from ? [from] : [];
	}
	if (message.deliveredTo) return [message.deliveredTo.trim().toLowerCase()];
	return [...new Set([...getEmailAddressList(message.toAddr), ...getEmailAddressList(message.ccAddr)])];
}

/** The project of a message: the first of its own addresses that resolves to one. */
export function resolveMessageProject(mappings: readonly ProjectHostMapping[], message: ProjectStampSource): string | null {
	for (const address of messageOwnAddresses(message)) {
		const projectId = resolveProjectForAddress(mappings, address);
		if (projectId) return projectId;
	}
	return null;
}
