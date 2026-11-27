import type { PermanentDeleteFolder } from "@/app/api/messages/bulk/types";
import { defaultTranslator, type Translator } from "../i18n/utils";

const folderLabelKeys = { trash: "navigation.trash", spam: "navigation.spam" } as const;

export function getPermanentDeleteFolderLabel(folder: PermanentDeleteFolder, t: Translator = defaultTranslator): string {
	return t(folderLabelKeys[folder]);
}

/** Whether the folder being viewed offers "Delete forever" and "Empty …". */
export function supportsPermanentDelete(folder: string | null | undefined): folder is PermanentDeleteFolder {
	return folder === "trash" || folder === "spam";
}

export function getEmptyFolderLabel(folder: PermanentDeleteFolder, t: Translator = defaultTranslator): string {
	return t("list.emptyFolder", { folder: getPermanentDeleteFolderLabel(folder, t) });
}

export function getPermanentDeleteConfirmText(count: number, t: Translator = defaultTranslator): string {
	return t("delete.confirm", { count });
}

/**
 * The confirmation for emptying Trash or Spam. From the unified view (`mailboxCount` above one) it empties
 * that folder in every mailbox the user manages, and the text says so.
 */
export function getEmptyFolderConfirmText(folder: PermanentDeleteFolder, total?: number, t: Translator = defaultTranslator, mailboxCount = 1): string {
	const vars = { count: total ?? 0, folder: getPermanentDeleteFolderLabel(folder, t), mailboxes: mailboxCount };
	if (mailboxCount > 1) {
		if (total === 1) return t("empty.confirm.everyMailbox.single", vars);
		return total && total > 1 ? t("empty.confirm.everyMailbox.multiple", vars) : t("empty.confirm.everyMailbox.all", vars);
	}
	if (total === 1) return t("empty.confirm.single", vars);
	return total && total > 1 ? t("empty.confirm.multiple", vars) : t("empty.confirm.all", vars);
}

/** Some of the requested messages were not in Trash or Spam any more, so the server kept them. */
export class PartialDeleteError extends Error {
	constructor(readonly skipped: number) {
		super("Some messages could not be deleted");
	}
}

export async function throwIfDeleteSkipped(response: Response, action: string): Promise<void> {
	if (action !== "delete") return;
	const result = (await response.json().catch(() => null)) as { skipped?: number } | null;
	if (!result?.skipped) return;
	window.dispatchEvent(new Event("mymailbox:messages-changed"));
	throw new PartialDeleteError(result.skipped);
}
