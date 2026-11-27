import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxes, users } from "@/db/schema";
import { formatEmailAddress } from "@/lib/email/address";
import { assertSendingConfigured, sendThroughProvider } from "@/lib/email/outbound-provider";
import type { SystemMailInput } from "@/lib/email/system-mail-types";

/**
 * Mail the application sends on its own behalf (password resets). It goes
 * straight through the send binding: no Sent copy, no contact upsert, no
 * webhooks, and the auto-generated headers mail systems expect.
 *
 * The From address is the primary mailbox of the first administrator on a
 * domain that can send; if no domain has sending enabled there is nothing to
 * send from, and the caller decides what to tell the user.
 */
export async function sendSystemEmail(env: CloudflareEnv, input: SystemMailInput): Promise<boolean> {
	const sender = await pickSystemSender(env, input.hostname);
	if (!sender) return false;

	const from = formatEmailAddress(sender.address, sender.name);
	await assertSendingConfigured(env, from);
	await sendThroughProvider(env, {
		from,
		to: [input.to],
		subject: input.subject,
		text: input.text,
		html: input.html,
		headers: {
			"Auto-Submitted": "auto-generated",
			"X-Auto-Response-Suppress": "All",
		},
	});
	return true;
}

export async function pickSystemSender(
	env: CloudflareEnv,
	hostname?: string,
): Promise<{ address: string; name: string } | null> {
	const db = getDb(env);
	const rows = await db
		.select({
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			hostname: domains.hostname,
			role: users.role,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.innerJoin(users, eq(mailboxes.userId, users.id))
		.where(and(
			...sendingDomain(hostname),
			eq(mailboxes.disabled, false),
			eq(users.disabled, false),
		))
		.orderBy(asc(mailboxes.createdAt))
		.limit(50);
	const chosen = rows.find((row) => row.role === "admin") ?? rows[0];
	if (chosen) return { address: `${chosen.localPart}@${chosen.hostname}`, name: chosen.displayName ?? "MyMailbox" };

	// No enabled mailbox on a sending domain: system mail does not need one, so
	// send from no-reply@ on any domain that can send.
	const [domain] = await db
		.select({ hostname: domains.hostname })
		.from(domains)
		.where(and(...sendingDomain(hostname)))
		.limit(1);
	return domain ? { address: `no-reply@${domain.hostname}`, name: "MyMailbox" } : null;
}

/** Domains that send through Cloudflare, which works only once the zone's sending subdomain is enabled. */
function sendingDomain(hostname?: string) {
	return [
		eq(domains.sendingProvider, "cloudflare"),
		eq(domains.sendingEnabled, true),
		...(hostname ? [eq(domains.hostname, hostname.toLowerCase())] : []),
	];
}
