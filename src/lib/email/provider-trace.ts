import type { MessageAuthentication, MessageAuthenticationMethod } from "@/lib/email/authentication-types";
import { isSameOrSubdomain } from "@/lib/email/domain-match";
import { extractSenderIp } from "@/lib/spam/domain-utils";

type HeaderLine = { name: string; value: string };

const HEADER_SCAN_BYTES = 64 * 1024;
/** Headers SES prepends when it accepts a message; the trace ends at the first header it did not write. */
const SES_HEADERS = new Set(["return-path", "received", "received-spf", "authentication-results", "x-ses-receipt", "x-ses-dkim-signature", "x-ses-spam-verdict", "x-ses-virus-verdict"]);

function readHeaderLines(raw: ArrayBuffer): HeaderLine[] {
	const text = new TextDecoder().decode(raw.slice(0, Math.min(raw.byteLength, HEADER_SCAN_BYTES)));
	const end = text.search(/\r?\n\r?\n/);
	const block = end === -1 ? text : text.slice(0, end);
	const headers: HeaderLine[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1].value += ` ${line.trim()}`;
		else {
			const colon = line.indexOf(":");
			if (colon > 0) headers.push({ name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() });
		}
	}
	return headers;
}

/**
 * The leading run of headers SES wrote, or null when the message did not come
 * through SES. Reading stops at the first header SES did not add, so a sender
 * cannot forge an authentication result further down the message.
 */
function readSesHeaders(raw: ArrayBuffer): HeaderLine[] | null {
	const leading: HeaderLine[] = [];
	for (const header of readHeaderLines(raw)) {
		if (!SES_HEADERS.has(header.name)) break;
		leading.push(header);
	}
	return leading.some((header) => header.name === "x-ses-receipt") ? leading : null;
}

function headerValue(headers: HeaderLine[], name: string): string | undefined {
	return headers.find((header) => header.name === name)?.value;
}

/** Split an Authentication-Results value on semicolons outside comment parentheses. */
function splitResults(value: string): string[] {
	const sections: string[] = [];
	let current = "";
	let depth = 0;
	for (const char of value) {
		if (char === "(") depth += 1;
		else if (char === ")") depth = Math.max(0, depth - 1);
		if (char === ";" && depth === 0) {
			if (current.trim()) sections.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	if (current.trim()) sections.push(current.trim());
	return sections;
}

function methodSections(sections: string[], method: "spf" | "dkim" | "dmarc"): string[] {
	return sections.filter((section) => new RegExp(`^${method}\\s*=`, "i").test(section));
}

/** Prefer a passing signature when a message carries more than one of the same method. */
function methodSection(sections: string[], method: "spf" | "dkim" | "dmarc"): string | null {
	const matches = methodSections(sections, method);
	return matches.find((section) => new RegExp(`^${method}\\s*=\\s*pass\\b`, "i").test(section)) ?? matches[0] ?? null;
}

function methodStatus(section: string | null, method: "spf" | "dkim" | "dmarc"): string | null {
	return section?.match(new RegExp(`^${method}\\s*=\\s*([a-z]+)`, "i"))?.[1]?.toUpperCase() ?? null;
}

/** A domain from either `d=`/`smtp.mailfrom=` (a domain) or `i=` (a mailbox). */
function domainFromIdentity(value: string | null): string | null {
	if (!value) return null;
	const cleaned = value.replace(/^@/, "").replace(/^<|>$/g, "").trim().toLowerCase();
	const at = cleaned.lastIndexOf("@");
	const domain = at >= 0 ? cleaned.slice(at + 1) : cleaned;
	return domain || null;
}

function tlsVersion(received: string | undefined): string | null {
	const version = received?.match(/\bversion\s*=\s*(TLS(?:v|_)?[\d.]+)/i)?.[1];
	if (!version) return null;
	return version.replace(/^TLSv?/i, "TLS ").replace(/_/g, ".");
}

function senderDomainMatches(fromAddress: string, domains: string[]): boolean | null {
	const fromDomain = fromAddress.slice(fromAddress.lastIndexOf("@") + 1).trim().toLowerCase();
	if (!fromDomain || domains.length === 0) return null;
	return domains.some((domain) => isSameOrSubdomain(domain, fromDomain));
}

/** The domain named by the first of these properties a results section carries. */
function identityDomain(section: string, properties: string[]): string | null {
	for (const property of properties) {
		const value = section.match(new RegExp(`\\b${property.replace(".", "\\.")}\\s*=\\s*@?([^\\s;)]+)`, "i"))?.[1];
		if (value) return domainFromIdentity(value);
	}
	return null;
}

const MAILED_BY = ["smtp.mailfrom", "envelope-from"];
const SIGNED_BY = ["header.d", "header.i"];

/**
 * The SPF client IP the receiving server wrote: `client-ip=` (SES), its "(sender IP is ...)" comment, the
 * "designates ... as permitted sender" comment or `smtp.remote-ip=` (Cloudflare), then Received-SPF.
 */
function spfClientIp(spfSection: string | null, sections: string[], trace: HeaderLine[]): string | null {
	const fromSpf = spfSection?.match(/\bclient-ip\s*=\s*([^\s;)]+)/i)?.[1]
		?? spfSection?.match(/\(sender IP is ([^\s;)]+)\)/i)?.[1]
		?? spfSection?.match(/\bdesignates ([^\s;)]+) as permitted sender/i)?.[1];
	if (fromSpf) return fromSpf;
	for (const section of sections) {
		const remote = section.match(/\bsmtp\.remote-ip\s*=\s*([^\s;)]+)/i)?.[1];
		if (remote) return remote;
	}
	return headerValue(trace, "received-spf")?.match(/\bclient-ip\s*=\s*([^\s;)]+)/i)?.[1] ?? null;
}

/**
 * Read one Authentication-Results value the caller already trusts, with the trace headers the same
 * server wrote above it (Received, Received-SPF).
 */
function parseTrustedResults(results: string, trace: HeaderLine[], fromAddress: string): MessageAuthentication | null {
	const sections = splitResults(results);
	const spfSections = methodSections(sections, "spf");
	const dkimSections = methodSections(sections, "dkim");
	const spfSection = methodSection(sections, "spf");
	const dkimSection = methodSection(sections, "dkim");
	const dmarcSection = methodSection(sections, "dmarc");

	const spfStatus = methodStatus(spfSection, "spf");
	const dkimStatus = methodStatus(dkimSection, "dkim");
	const dmarcStatus = methodStatus(dmarcSection, "dmarc");
	if (!spfStatus && !dkimStatus && !dmarcStatus) return null;

	const spfIp = spfClientIp(spfSection, sections, trace);
	const mailedBy = spfSection ? identityDomain(spfSection, MAILED_BY) : null;
	const signedBy = dkimSection ? identityDomain(dkimSection, SIGNED_BY) : null;
	const dmarcDomain = dmarcSection?.match(/\bheader\.from\s*=\s*([^\s;)]+)/i)?.[1]?.toLowerCase() ?? null;
	// Only passing signatures say anything about alignment; a failing one must
	// not make an unrelated sender look aligned.
	const alignedDomains = [...spfSections, ...dkimSections]
		.filter((section) => /^(?:spf|dkim)\s*=\s*pass\b/i.test(section))
		.map((section) => identityDomain(section, /^spf\s*=/i.test(section) ? MAILED_BY : SIGNED_BY))
		.filter((domain): domain is string => !!domain);

	const method = (status: string | null, detail: string | null): MessageAuthenticationMethod | null =>
		status ? { status, detail } : null;
	const received = headerValue(trace, "received");
	const senderIp = spfIp ?? (received ? extractSenderIp({ received }) : null);

	return {
		spf: method(spfStatus, spfIp ? `IP ${spfIp}` : mailedBy ? `mailed by ${mailedBy}` : null),
		dkim: method(dkimStatus, signedBy ? `d=${signedBy}` : null),
		dmarc: method(dmarcStatus, dmarcDomain ? `header.from=${dmarcDomain}` : null),
		signedBy,
		mailedBy,
		senderIp,
		encryption: tlsVersion(received),
		aligned: senderDomainMatches(fromAddress, alignedDomains),
	};
}

/**
 * Authentication results for a message that arrived through SES. Returns null
 * when the message has no trusted provider trace, so callers can say results
 * are unavailable instead of trusting headers the sender could have written.
 */
export function readSesAuthentication(raw: ArrayBuffer, fromAddress: string): MessageAuthentication | null {
	const leading = readSesHeaders(raw);
	if (!leading) return null;
	const results = headerValue(leading, "authentication-results");
	if (!results || !/^amazonses\.com\s*;/i.test(results)) return null;
	return parseTrustedResults(results, leading, fromAddress);
}

/** Cloudflare Email Routing writes its verdicts under this authserv-id. */
const CLOUDFLARE_AUTHSERV_ID = "mx.cloudflare.net";
/** Headers that belong to the message the sender wrote; Cloudflare's trace always sits above them. */
const MESSAGE_HEADERS = new Set(["from", "sender", "reply-to", "to", "cc", "bcc", "subject", "date", "message-id", "in-reply-to", "references", "mime-version", "content-type", "content-transfer-encoding"]);

/** A header Cloudflare's receiving MX writes: its Received hop, its Received-SPF, or its ARC record. */
function isCloudflareTrace(header: HeaderLine): boolean {
	switch (header.name) {
		case "received":
			return /\bby\s+[\w.-]*cloudflare[\w.-]*/i.test(header.value);
		case "received-spf":
			return /\breceiver\s*=\s*mx\.cloudflare\.net\b/i.test(header.value);
		case "arc-authentication-results":
			return /;\s*mx\.cloudflare\.net\s*;/i.test(header.value);
		case "arc-seal":
			return /\bd\s*=\s*cloudflare-email\.net\b/i.test(header.value);
		default:
			return false;
	}
}

/**
 * Authentication results Cloudflare Email Routing recorded when it accepted the message. Cloudflare prepends
 * its trace above everything the sender wrote, so only that leading block (up to the first header of the
 * sender's message) is read: its topmost Authentication-Results counts when its authserv-id is exactly
 * `mx.cloudflare.net` and the block also carries Cloudflare's own trace (Received hop, Received-SPF or ARC).
 * A copy the sender wrote further down, an ARC record alone and a lookalike authserv-id are all ignored.
 */
export function readCloudflareAuthentication(raw: ArrayBuffer, fromAddress: string): MessageAuthentication | null {
	const block: HeaderLine[] = [];
	for (const header of readHeaderLines(raw)) {
		if (MESSAGE_HEADERS.has(header.name)) break;
		block.push(header);
	}
	const results = block.find((header) => header.name === "authentication-results");
	if (!results) return null;
	if (results.value.split(";", 1)[0]?.trim().toLowerCase() !== CLOUDFLARE_AUTHSERV_ID) return null;
	if (!block.some(isCloudflareTrace)) return null;
	return parseTrustedResults(results.value, block.filter((header) => header !== results), fromAddress);
}

/** Results from whichever receiving provider left a trusted trace: Cloudflare Email Routing, or SES for older mail. */
export function readProviderAuthentication(raw: ArrayBuffer, fromAddress: string): MessageAuthentication | null {
	return readCloudflareAuthentication(raw, fromAddress) ?? readSesAuthentication(raw, fromAddress);
}

/** Headers a provider has not vouched for: nothing the sender wrote here may count as authentication. */
const UNTRUSTED_PROVIDER_HEADERS = new Set(["authentication-results", "received-spf", "arc-authentication-results", "received", "return-path", "x-ses-receipt", "x-ses-spam-verdict", "x-ses-virus-verdict", "x-ses-dkim-signature"]);
const MAX_HEADER_ENTRIES = 200;
const MAX_HEADER_VALUE = 2000;

/**
 * A bounded header map (lower-case names, first value wins) read from the raw message, for a queued
 * message that carries none and for the promotions backfill, so auto-reply suppression, spam analysis
 * and bulk-mail detection can see Auto-Submitted, Precedence, List-Id and similar.
 */
export function readHeaderMap(raw: ArrayBuffer): Record<string, string> {
	const map: Record<string, string> = {};
	let count = 0;
	for (const header of readHeaderLines(raw)) {
		if (UNTRUSTED_PROVIDER_HEADERS.has(header.name) || header.name in map) continue;
		map[header.name] = header.value.slice(0, MAX_HEADER_VALUE);
		if (++count >= MAX_HEADER_ENTRIES) break;
	}
	return map;
}
