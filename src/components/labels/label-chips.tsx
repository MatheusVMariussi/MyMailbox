"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/language-provider";
import { useMailboxLabels } from "@/components/messages/use-mailbox-labels";
import type { NavLabel } from "@/components/dashboard-nav-types";

type Props = {
	labelIds?: string[];
	labelsById: ReadonlyMap<string, NavLabel>;
	/** The label being viewed (one id, or a comma-separated same-named group); its chip would only repeat the page title. */
	exclude?: string;
	className?: string;
	/** Accessible name for the group, for example "Labels". */
	ariaLabel?: string;
};

/** Small colored chips for a message's labels, in the order they were added. Unknown ids are skipped. */
function LabelChipsComponent({ labelIds, labelsById, exclude, className, ariaLabel }: Props) {
	const excluded = exclude ? exclude.split(",") : [];
	const labels = (labelIds ?? []).flatMap((id) => {
		const label = excluded.includes(id) ? undefined : labelsById.get(id);
		return label ? [label] : [];
	});
	if (labels.length === 0) return null;
	return (
		<span className={cn("inline-flex shrink-0 items-center gap-1 overflow-hidden", className)} aria-label={ariaLabel} data-label-chips="">
			{labels.map((label) => (
				<span
					key={label.id}
					className="inline-flex max-w-32 shrink-0 items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 text-[11px] font-medium leading-[18px] text-ink-muted"
					title={label.name}
					data-label-chip={label.id}
				>
					<span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
					<span className="truncate">{label.name}</span>
				</span>
			))}
		</span>
	);
}

export const LabelChips = memo(LabelChipsComponent);

/** The chips under the reader's subject, from the labels of the message's mailbox. */
export function ReaderLabelChips({ mailboxId, labelIds, className }: { mailboxId: string | null; labelIds?: string[]; className?: string }) {
	const { t } = useLanguage();
	const labels = useMailboxLabels(mailboxId ?? undefined);
	const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
	if (!labelIds?.length || labels.length === 0) return null;
	return (
		<div className={className} data-reader-labels="">
			<LabelChips labelIds={labelIds} labelsById={labelsById} ariaLabel={t("labels.chipsLabel")} className="flex-wrap" />
		</div>
	);
}
