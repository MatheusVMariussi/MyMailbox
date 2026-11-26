import type { MessageCounts, MessageFolder } from "@/hooks/types";
import type { messages } from "@/db/schema";

export type MessageCountRow = Pick<
	typeof messages.$inferSelect,
	"mailboxId" | "direction" | "status" | "read" | "starred" | "snoozedUntil"
> & { projectId?: string | null; total?: number; scheduledTotal?: number };

/** Grouped Promotions rows: received, unsnoozed promotions per mailbox, read state and project. */
export type PromotionCountRow = { mailboxId: string | null; read: boolean; total: number; projectId?: string | null };

/** Narrows folder counts to one project; per-project counts always cover every project. */
export type MessageCountScope = { projectId?: string | null };

export type FolderAccumulator = MessageCounts["folders"];

export type CountableFolder = MessageFolder | null;
