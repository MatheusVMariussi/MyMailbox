"use client";

import { useState } from "react";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { Message } from "@/hooks/types";
import { useHotkeys } from "@/components/shortcuts/use-hotkeys";
import { rememberOpenedUnreadMessage } from "./message-detail-navigation-utils";
import { toggleMessageStar } from "./message-list-row-actions-utils";
import type { ListKeyboardOptions } from "./use-list-keyboard-types";

/**
 * Gmail keys for the message list. A cursor row moves with `j`/`k` (beside the reading pane it opens the
 * conversation too) and follows the open message, so `u` comes back to where you were. With no message open
 * the list owns `o`/Enter, `e`, `#`, `!`, `s` and Shift+I/U, acting on the checked rows or else the cursor's
 * row; `x` checks the cursor's row, or the open conversation while reading. Returns the cursor's row id.
 */
export function useListKeyboard({
	messages,
	config,
	selectedMessageId,
	selectedIds,
	selectedIdSet,
	paneBeside,
	enabled,
	navigate,
	runAction,
	toggleSelected,
	updateMessages,
	onError,
	t,
}: ListKeyboardOptions): string | null {
	const [cursorId, setCursorId] = useState<string | null>(null);
	const [followedMessageId, setFollowedMessageId] = useState(selectedMessageId);
	if (selectedMessageId !== followedMessageId) {
		setFollowedMessageId(selectedMessageId);
		if (selectedMessageId) setCursorId(selectedMessageId);
	}
	const cursorRowId = cursorId && messages.some((message) => message.id === cursorId) ? cursorId : null;
	const cursorMessage = () => messages.find((message) => message.id === cursorRowId);

	const openMessage = (message: Message) => {
		if (!message.read && config.folder !== "drafts") rememberOpenedUnreadMessage(message.id);
		navigate(`${config.hrefPrefix}/${message.id}`);
	};
	const moveCursor = (delta: 1 | -1) => {
		if (messages.length === 0) return;
		const index = messages.findIndex((message) => message.id === cursorRowId);
		const nextIndex = index === -1
			? (delta > 0 ? 0 : messages.length - 1)
			: Math.min(messages.length - 1, Math.max(0, index + delta));
		const next = messages[nextIndex];
		setCursorId(next.id);
		document.querySelector(`[data-message-row="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
		// Beside the reading pane, moving the cursor opens the conversation, as Gmail does.
		if (paneBeside) openMessage(next);
	};
	const runKeyAction = (action: BulkMessageAction) => {
		const ids = selectedIds.length > 0 ? selectedIds : cursorRowId ? [cursorRowId] : [];
		if (ids.length > 0) runAction(ids, action);
	};
	const openCursor = () => {
		const message = cursorMessage();
		if (message) openMessage(message);
	};

	const listShortcuts = [
		{ key: "j", label: t("shortcut.next"), category: "Navigation" as const, action: () => moveCursor(1) },
		{ key: "k", label: t("shortcut.previous"), category: "Navigation" as const, action: () => moveCursor(-1) },
		{ key: "o", label: t("shortcut.open"), category: "Navigation" as const, action: openCursor },
		{
			key: "enter",
			label: t("shortcut.open"),
			category: "Navigation" as const,
			action: () => {
				// Enter on a focused control belongs to that control.
				const active = document.activeElement;
				if (active instanceof HTMLElement && active.closest("a, button, [role='button'], [role='menuitem']")) {
					active.click();
					return;
				}
				openCursor();
			},
		},
		{ key: "e", label: t("shortcut.archiveMessage"), category: "Actions" as const, action: () => { if (config.folder !== "archived") runKeyAction("archive"); } },
		{ key: "#", label: t("shortcut.moveToTrash"), category: "Actions" as const, action: () => { if (config.folder !== "trash") runKeyAction("trash"); } },
		{ key: "!", label: t("shortcut.reportSpam"), category: "Actions" as const, action: () => { if (config.folder !== "spam") runKeyAction("spam"); } },
		{ key: "i", modifiers: ["shift" as const], label: t("shortcut.markRead"), category: "Actions" as const, action: () => runKeyAction("read") },
		{ key: "u", modifiers: ["shift" as const], label: t("shortcut.markUnread"), category: "Actions" as const, action: () => runKeyAction("unread") },
		{
			key: "s",
			label: t("shortcut.star"),
			category: "Actions" as const,
			action: () => {
				const message = cursorMessage();
				if (!message) return;
				void toggleMessageStar(message.id, !message.starred)
					.then((result) => updateMessages((current) => current.map((item) => (item.id === message.id ? { ...item, starred: result.starred } : item))))
					.catch(() => onError(t("message.error.star")));
			},
		},
	];
	useHotkeys(listShortcuts, { enabled: enabled && !selectedMessageId });

	const selectShortcut = [{
		key: "x",
		label: t("shortcut.select"),
		category: "Selection" as const,
		action: () => {
			const id = selectedMessageId ?? cursorRowId;
			if (id) toggleSelected(id, !selectedIdSet.has(id));
		},
	}];
	useHotkeys(selectShortcut, { enabled });

	return cursorRowId;
}
