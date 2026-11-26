import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_OUTBOUND_ATTACHMENT_MAX_MB, clampOutboundAttachmentMb } from "./attachment-limits";

export { CLOUD_ATTACHMENT_THRESHOLD_BYTES, DEFAULT_OUTBOUND_ATTACHMENT_MAX_MB } from "./attachment-limits";

/** The administrator's limit, clamped to the ceiling every time it is used. */
export async function getOutboundAttachmentMaxMb(env: CloudflareEnv): Promise<number> {
	const [settings] = await getDb(env)
		.select({ maxMb: appSettings.outboundAttachmentMaxMb })
		.from(appSettings)
		.where(eq(appSettings.id, "default"))
		.limit(1);
	return clampOutboundAttachmentMb(settings?.maxMb ?? DEFAULT_OUTBOUND_ATTACHMENT_MAX_MB);
}

