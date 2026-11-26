const encoder = new TextEncoder();

/**
 * Bytes of a message we compose (`messages.size_bytes`, for `larger:`/`smaller:`): the UTF-8 text and HTML
 * bodies plus every attachment. Received and imported mail store their raw MIME length instead.
 */
export function outboundMessageSize(message: {
	text?: string | null;
	html?: string | null;
	attachments?: ReadonlyArray<{ content: ArrayBuffer }>;
}): number {
	const body = encoder.encode(message.text ?? "").byteLength + encoder.encode(message.html ?? "").byteLength;
	return body + (message.attachments ?? []).reduce((total, attachment) => total + attachment.content.byteLength, 0);
}
