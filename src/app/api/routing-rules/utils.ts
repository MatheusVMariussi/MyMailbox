import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { labels } from "@/db/schema";
import type { routingRuleSchema } from "@/lib/validators";
import type { z } from "zod";
import type { RuleTarget } from "./types";

/**
 * Turns a mailbox rule's `destination` into the columns that store it. Returns an
 * `error` and `status` instead when the destination is missing or not usable.
 */
export async function resolveRuleTarget(
	db: AppDatabase,
	mailboxId: string,
	input: z.infer<typeof routingRuleSchema>,
): Promise<RuleTarget | { error: string; status: number }> {
	const destination = input.destination ?? (input.labelId ? `label:${input.labelId}` : "");

	if (destination === "forward") {
		// Forwards are actioned while the message is still being received, before its body is
		// available, so a rule that matches on content can never fire.
		if (input.matchField === "content") {
			return { error: "Forwarding rules cannot match on message content", status: 400 };
		}
		if (!input.forwardTo) return { error: "A forwarding address is required", status: 400 };
		return {
			action: "forward",
			labelId: null,
			skipInbox: false,
			forwardTo: input.forwardTo,
			keepCopy: input.keepCopy ?? false,
		};
	}

	if (destination === "spam" || destination === "trash") {
		return { action: destination, labelId: null, skipInbox: false, forwardTo: null, keepCopy: false };
	}

	// "Skip the inbox" without a label: a store rule that only archives.
	if (destination === "archive") {
		return { action: "store", labelId: null, skipInbox: true, forwardTo: null, keepCopy: false };
	}

	// `folder:` is what rules saved before labels sent; the id is the same.
	const prefix = destination.startsWith("label:") ? "label:" : destination.startsWith("folder:") ? "folder:" : null;
	const labelId = prefix ? destination.slice(prefix.length) : null;
	if (!labelId) return { error: "Destination is required", status: 400 };

	const [label] = await db
		.select({ id: labels.id })
		.from(labels)
		.where(and(eq(labels.id, labelId), eq(labels.mailboxId, mailboxId)))
		.limit(1);
	if (!label) return { error: "Label not found", status: 404 };

	return { action: "store", labelId, skipInbox: input.skipInbox ?? false, forwardTo: null, keepCopy: false };
}
