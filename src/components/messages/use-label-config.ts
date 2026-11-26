"use client";

import { Tag } from "@/components/icons";
import { useMemo } from "react";
import { useLanguage } from "@/components/language-provider";
import { splitLabelFilter } from "@/lib/labels/group-utils";
import { useScopeLabels } from "./use-scope-labels";
import type { MessageFolderConfig } from "./types";

/**
 * The list configuration of a label view: every message with the label, any direction, but Trash and Spam.
 * `labelId` may be a comma-separated group of same-named labels (the unified sidebar's entry).
 */
export function useLabelConfig(labelId: string): MessageFolderConfig {
	const { t } = useLanguage();
	const { labelsById } = useScopeLabels();
	const name = splitLabelFilter(labelId).map((id) => labelsById.get(id)?.name).find(Boolean);

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
