import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { getEmailAddress } from "@/lib/email/address";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";

export const SENDING_NOT_CONFIGURED = "SENDING_NOT_CONFIGURED";

/** The From domain does not send yet: a setup step the user can take, not a server failure. */
export class SendingNotConfiguredError extends Error {
	readonly code = SENDING_NOT_CONFIGURED;

	constructor(readonly hostname: string | null) {
		super(`Sending is not set up for ${hostname ?? "this domain"}. Turn on Cloudflare Email Sending on the Domains page.`);
		this.name = "SendingNotConfiguredError";
	}
}

/**
 * Each domain either sends through Cloudflare Email Sending or not at all
 * (receive-only). Throws when the From domain does not send, so nothing is
 * handed to the send binding for a domain Cloudflare would refuse.
 */
export async function assertSendingConfigured(env: CloudflareEnv, fromAddress: string): Promise<void> {
	const hostname = getEmailAddress(fromAddress).split("@")[1]?.toLowerCase();
	const [domain] = hostname
		? await getDb(env).select({ provider: domains.sendingProvider }).from(domains).where(eq(domains.hostname, hostname)).limit(1)
		: [];
	if (domain?.provider === "cloudflare") return;
	throw new SendingNotConfiguredError(hostname ?? null);
}

/**
 * Sends through the `EMAIL` send_email binding (Cloudflare Email Sending); returns the Message-ID
 * Cloudflare gave the message. Callers check the From domain with `assertSendingConfigured` first.
 */
export async function sendThroughProvider(env: CloudflareEnv, message: OutboundProviderMessage): Promise<{ messageId: string }> {
	const response = await env.EMAIL.send({
		from: message.from,
		to: message.to,
		...(message.cc?.length ? { cc: message.cc } : {}),
		...(message.bcc?.length ? { bcc: message.bcc } : {}),
		subject: message.subject,
		headers: message.headers && Object.keys(message.headers).length ? message.headers : undefined,
		html: message.html,
		text: message.text,
		attachments: message.attachments?.map((attachment) =>
			attachment.disposition === "inline" && attachment.contentId
				? { filename: attachment.filename, type: attachment.type, content: attachment.content, disposition: "inline" as const, contentId: attachment.contentId }
				: { filename: attachment.filename, type: attachment.type, content: attachment.content, disposition: "attachment" as const },
		),
	});
	return { messageId: response.messageId };
}
