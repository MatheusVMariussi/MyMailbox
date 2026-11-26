import type { AppDatabase } from "@/db";
import type { SessionUser } from "@/lib/auth/types";
import { getLabel } from "@/lib/labels/service";
import type { LabelRecord } from "@/lib/labels/types";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";

/** The label when the user may read its mailbox, with whether they may change it; null hides it entirely. */
export async function getLabelAccess(
	db: AppDatabase,
	user: SessionUser,
	labelId: string,
): Promise<{ label: LabelRecord; canManage: boolean } | null> {
	const label = await getLabel(db, labelId);
	if (!label) return null;
	const access = await getMailboxAccessLevel(db, user, label.mailboxId);
	if (!access?.canRead) return null;
	return { label, canManage: access.canManage };
}
