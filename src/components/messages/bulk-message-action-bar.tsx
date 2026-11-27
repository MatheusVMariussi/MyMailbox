"use client";

import { useMemo, useState } from "react";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import { useLanguage } from "@/components/language-provider";
import { BulkMessageToolbar } from "./bulk-message-toolbar";
import type { BulkMessageActionBarProps } from "./types";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { PartialDeleteError, getPermanentDeleteConfirmText } from "@/lib/messages/permanent-delete-utils";
import { runBulkMessageAction } from "./utils";
import { useHotkeys } from "@/components/shortcuts/use-hotkeys";
import { useShortcutsActive } from "@/components/shortcuts/shortcuts-enabled-context";

/**
 * Bulk actions for a selection whose messages are listed beside the reading
 * pane. It sits at the top of the pane, above the open message or the empty prompt.
 */
export function BulkMessageActionBar({
	folder,
	selectedMessages,
	onClearSelection,
	shortcutsEnabled = false,
}: BulkMessageActionBarProps) {
	const { t } = useLanguage();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasUnreadSelection = selectedMessages.some((message) => !message.read);
	// With no message open, `l` and `v` open "Label as" and "Move to" for the selection (the reader owns them otherwise).
	const shortcutsActive = useShortcutsActive();
	const [menuRequest, setMenuRequest] = useState<{ kind: "label" | "move"; key: number } | null>(null);
	const menuShortcuts = useMemo(() => [
		{ key: "l", label: t("labels.labelAs"), category: "Actions" as const, action: () => setMenuRequest({ kind: "label", key: Date.now() }) },
		{ key: "v", label: t("common.moveTo"), category: "Actions" as const, action: () => setMenuRequest({ kind: "move", key: Date.now() }) },
	], [t]);
	useHotkeys(menuShortcuts, { enabled: shortcutsActive && shortcutsEnabled });

	async function runAction(action: BulkMessageAction, labelId?: string) {
		if (selectedMessages.length === 0) return;
		if (action === "delete" && !await confirmDestructive(getPermanentDeleteConfirmText(selectedMessages.length, t))) return;

		setPending(true);
		setError(null);
		try {
			await runBulkMessageAction(
				selectedMessages.map((message) => message.id),
				action,
				true,
				labelId,
			);
			onClearSelection();
		} catch (actionError) {
			setError(actionError instanceof PartialDeleteError ? t("actions.error.deleteSkipped") : t("actions.error.update"));
		} finally {
			setPending(false);
		}
	}

	return (
		<div
			role="region"
			aria-label={t("common.selectedCount", { count: selectedMessages.length })}
			className="reader-enter shrink-0 border-b border-line bg-accent-soft/60 px-3 py-2"
		>
			<div className="min-w-0 overflow-x-auto">
				<BulkMessageToolbar
					selectedCount={selectedMessages.length}
					hasUnreadSelection={hasUnreadSelection}
					onAction={runAction}
					onClearSelection={onClearSelection}
					pending={pending}
					folder={folder}
					openMenu={menuRequest}
				/>
			</div>
			{error && <p role="alert" className="mt-1 text-sm font-medium text-red-700">{error}</p>}
		</div>
	);
}
