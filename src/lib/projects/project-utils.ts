/** Longest project name, in characters. */
export const PROJECT_NAME_MAX = 60;

/** Most addresses one project may own; a PUT replaces them all at once. */
export const PROJECT_ADDRESSES_MAX = 100;

/** Rows one `project_addresses` insert writes: six parameters each keeps a statement under D1's 100. */
export const PROJECT_ADDRESS_INSERT_CHUNK = 15;

/** Trimmed name with inner whitespace collapsed, or null when empty, too long or holding control characters. */
export function normalizeProjectName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.replace(/\s+/g, " ").trim();
	if (!name || name.length > PROJECT_NAME_MAX) return null;
	if (/\p{Cc}/u.test(name)) return null;
	return name;
}

/** `local@hostname`, or `@hostname` for a project owning the whole domain. */
export function formatProjectAddress(address: { localPart: string; hostname: string }): string {
	return `${address.localPart}@${address.hostname}`;
}

/**
 * The addresses a project owns plus `domainId` as a whole-domain mapping (empty local part), unless the project
 * already owns that whole domain. Specific addresses on the domain stay: they still win over the domain.
 */
export function withWholeDomain<T extends { domainId: string; localPart: string }>(addresses: readonly T[], domainId: string): (T | { domainId: string; localPart: string })[] {
	if (addresses.some((address) => address.domainId === domainId && address.localPart === "")) return [...addresses];
	return [...addresses, { domainId, localPart: "" }];
}

/** A re-stamp cursor: the index into the sorted mailbox list and the last rowid done in that mailbox. */
export function parseRestampCursor(cursor: string | null | undefined): { mailboxIndex: number; afterRowId: number } {
	const match = /^(\d{1,6}):(\d{1,15})$/.exec(cursor ?? "");
	if (!match) return { mailboxIndex: 0, afterRowId: 0 };
	return { mailboxIndex: Number(match[1]), afterRowId: Number(match[2]) };
}

export function formatRestampCursor(mailboxIndex: number, afterRowId: number): string {
	return `${mailboxIndex}:${afterRowId}`;
}

/** A `projectId` query parameter: a plausible id, or null (absent, empty or malformed). */
export function parseProjectParam(value: string | null | undefined): string | null {
	const id = value?.trim();
	return id && id.length <= 100 && /^[\w-]+$/.test(id) ? id : null;
}
