"use client";

import { Tag } from "@/components/icons";
import { useMemo } from "react";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useMailboxLabels } from "./use-mailbox-labels";
import type { MessageFolderConfig } from "./types";

/** The list configuration of a label view: every message with the label, any direction, but Trash and Spam. */
export function useLabelConfig(labelId: string): MessageFolderConfig {
	const { t } = useLanguage();
	const { selectedMailbox } = useSelectedMailbox();
	const labels = useMailboxLabels(selectedMailbox?.id);
	const name = labels.find((label) => label.id === labelId)?.name;

	return useMemo(
		() => ({
			folder: "inbox",
			labelId,
			title: name ?? t("labels.title"),
			emptyText: t("labels.empty"),
			hrefPrefix: `/labels/${labelId}`,
			icon: Tag,
			showRowBadge: false,
		}),
		[labelId, name, t],
	);
}
