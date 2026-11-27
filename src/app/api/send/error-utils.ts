import { SendingNotConfiguredError } from "@/lib/email/outbound-provider";

export function getSendErrorStatus(message: string): number {
	if (message === "Mailbox is required") return 400;
	if (message.startsWith("Attachments exceed") || message.startsWith("Subject exceeds") || message.startsWith("Headers exceed") || message.startsWith("Message exceeds Cloudflare") || message.startsWith("A message can include at most")) return 400;
	if (
		message === "Mailbox not found" ||
		message === "Sender account not found" ||
		message === "You do not have permission to send from this mailbox" ||
		message === "Sender address does not match the selected mailbox"
	) {
		return 403;
	}
	return 500;
}

/** Status and JSON body for a failed send; a domain without sending gets a code the composer translates. */
export function sendErrorBody(error: unknown): { status: number; body: { error: string; code?: string } } {
	if (error instanceof SendingNotConfiguredError) return { status: 422, body: { error: error.message, code: error.code } };
	const message = error instanceof Error ? error.message : "Send failed";
	return { status: getSendErrorStatus(message), body: { error: message } };
}
