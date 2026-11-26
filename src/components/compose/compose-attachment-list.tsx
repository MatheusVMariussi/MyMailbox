"use client";

import { FileText, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { formatAttachmentSize } from "./utils";
import type { ComposeAttachment, ComposeStoredAttachment } from "./types";

type ComposeAttachmentListProps = {
	attachments: ComposeAttachment[];
	/** Files the draft already holds on the server (a forwarded message's attachments). */
	storedAttachments: ComposeStoredAttachment[];
	cloudThresholdBytes: number;
	onRemove: (attachmentId: string) => void;
	onRemoveStored: (attachmentId: string) => void;
};

const chipClass = "flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-ink";
const removeClass = "rounded-full p-1 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The files attached to the message, above the toolbar, with the Cloudflare size warning. */
export function ComposeAttachmentList({ attachments, storedAttachments, cloudThresholdBytes, onRemove, onRemoveStored }: ComposeAttachmentListProps) {
	const { t } = useLanguage();
	if (attachments.length === 0 && storedAttachments.length === 0) return null;
	const sizes = [...attachments.map((item) => item.file.size), ...storedAttachments.map((item) => item.size)];
	return (
		<div className="border-t border-line">
			<div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden px-3 py-2">
				{storedAttachments.map((attachment) => (
					<div key={attachment.id} className={chipClass} title={t("compose.carriedOver")}>
						<FileText className="h-4 w-4 shrink-0 text-ink-muted" />
						<span className="max-w-48 truncate">{attachment.filename}</span>
						<span className="font-mono text-[11px] text-ink-muted">{formatAttachmentSize(attachment.size)}</span>
						<button type="button" onClick={() => onRemoveStored(attachment.id)} className={removeClass}>
							<X className="h-3.5 w-3.5" />
							<span className="sr-only">{t("compose.removeAttachment")}</span>
						</button>
					</div>
				))}
				{attachments.map((attachment) => (
					<div key={attachment.id} className={chipClass}>
						<FileText className="h-4 w-4 shrink-0 text-ink-muted" />
						<span className="max-w-48 truncate font-medium">{attachment.file.name}</span>
						<span className="font-mono text-[11px] text-ink-muted">{formatAttachmentSize(attachment.file.size)}</span>
						<button type="button" onClick={() => onRemove(attachment.id)} className={removeClass}>
							<X className="h-3.5 w-3.5" />
							<span className="sr-only">{t("compose.removeAttachment")}</span>
						</button>
					</div>
				))}
			</div>
			<p className="px-3 pb-2 text-xs text-amber-700">
				{sizes.some((size) => size > cloudThresholdBytes) ? t("compose.cloudWarning.will") : t("compose.cloudWarning.may")}
			</p>
		</div>
	);
}
