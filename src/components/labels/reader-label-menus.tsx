"use client";

import { useMemo, useState } from "react";
import { FolderInput, Tag } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useHotkeys, useShortcuts } from "@/components/shortcuts";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useMailboxLabels } from "@/components/messages/use-mailbox-labels";
import { LabelMenu } from "./label-menu";

type Props = {
	mailboxId: string | null;
	labelIds?: string[];
	disabled?: boolean;
	onLabel: (labelId: string, add: boolean) => void;
	onMove: (labelId: string) => void;
};

/** "Label as" and "Move to a label" for the open message; `l` and `v` open them. */
export function ReaderLabelMenus({ mailboxId, labelIds, disabled, onLabel, onMove }: Props) {
	const { t } = useLanguage();
	const { shortcutsEnabled } = useShortcuts();
	const labels = useMailboxLabels(mailboxId ?? undefined);
	const [menu, setMenu] = useState<"label" | "move" | null>(null);
	const applied = useMemo(() => new Set(labelIds ?? []), [labelIds]);
	const shortcuts = useMemo(() => {
		// With rows selected, the list toolbar owns `l` and `v`.
		const open = (kind: "label" | "move") => () => {
			if (!document.querySelector("[data-bulk-toolbar]")) setMenu(kind);
		};
		return [
			{ key: "l", label: t("labels.labelAs"), category: "Actions" as const, action: open("label") },
			{ key: "v", label: t("common.moveTo"), category: "Actions" as const, action: open("move") },
		];
	}, [t]);
	useHotkeys(shortcuts, { enabled: shortcutsEnabled && !disabled && !!mailboxId });
	if (!mailboxId) return null;

	const button = (label: string, icon: React.ReactNode, data: Record<string, string>) => (
		<Button type="button" variant="ghost" size="roundedSM" className="h-8 w-8 shrink-0 p-0" aria-label={label} disabled={disabled} {...data}>
			{icon}
		</Button>
	);
	return (
		<>
			<Tooltip label={t("labels.labelAs")}>
				<span className="inline-flex">
					<LabelMenu
						mode="label"
						labels={labels}
						labelState={(labelId) => applied.has(labelId)}
						onPick={onLabel}
						open={menu === "label"}
						onOpenChange={(open) => setMenu(open ? "label" : null)}
						disabled={disabled}
						trigger={button(t("labels.labelAs"), <Tag size={16} />, { "data-reader-label-as": "" })}
					/>
				</span>
			</Tooltip>
			<Tooltip label={t("common.moveTo")}>
				<span className="inline-flex">
					<LabelMenu
						mode="move"
						labels={labels}
						onPick={(labelId) => onMove(labelId)}
						open={menu === "move"}
						onOpenChange={(open) => setMenu(open ? "move" : null)}
						disabled={disabled}
						trigger={button(t("common.moveTo"), <FolderInput size={16} />, { "data-reader-move-to": "" })}
					/>
				</span>
			</Tooltip>
		</>
	);
}
