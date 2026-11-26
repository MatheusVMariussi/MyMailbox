/** R2 deletes at most 1,000 keys per call; 500 keeps each request small. */
const DELETE_CHUNK = 500;

/**
 * Deletes the stored objects of attachment rows that are being removed. `message_attachments.r2_key`
 * is unique, so no other row can still point at one of these objects.
 */
export async function deleteAttachmentObjects(env: CloudflareEnv, keys: string[]): Promise<void> {
	const unique = [...new Set(keys)];
	for (let index = 0; index < unique.length; index += DELETE_CHUNK) await env.BUCKET.delete(unique.slice(index, index + DELETE_CHUNK));
}
