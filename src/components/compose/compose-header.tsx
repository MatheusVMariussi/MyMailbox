"use client";

import type { TouchEvent } from "react";
import { ChevronUp, Forward, Maximize2, Minimize2, Minus, Reply, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import { COMPOSE_HEADER_BUTTON, composeTitleSlug } from "./compose-ui-utils";

type SheetDragHandlers = {
	onTouchStart?: (event: TouchEvent) => void;
	onTouchMove?: (event: TouchEvent) => void;
	onTouchEnd?: () => void;
};

type ComposeHeaderProps = {
	title: string;
	/** A reply or forward gets its icon before the title. */
	kind: "reply" | "forward" | null;
	subject: string;
	popup: boolean;
	minimized: boolean;
	modalMode: boolean;
	onToggleMinimized: () => void;
	onToggleModal: () => void;
	onClose: () => void;
	sheetDrag: SheetDragHandlers;
};

/**
 * The composer's title bar: the state as a terminal path (`~/new-message`), the subject once there is one,
 * and the window controls. On phones it is also the handle that drags the sheet away.
 */
export function ComposeHeader({ title, kind, subject, popup, minimized, modalMode, onToggleMinimized, onToggleModal, onClose, sheetDrag }: ComposeHeaderProps) {
	const { t } = useLanguage();
	const trimmedSubject = subject.trim();
	return (
		<div
			{...sheetDrag}
			className="relative flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 text-sm max-md:h-12 max-md:touch-none"
		>
			{popup && <span aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-line-strong md:hidden" />}
			<span className="flex min-w-0 items-center gap-2">
				{kind === "reply" && <Reply aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-muted" />}
				{kind === "forward" && <Forward aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-muted" />}
				<span className="sr-only">{title}</span>
				<span aria-hidden="true" className="shrink-0 font-mono text-[13px] font-medium text-ink">
					<span className="text-accent">~/</span>
					{composeTitleSlug(title)}
				</span>
				{trimmedSubject && (
					<span className="min-w-0 truncate text-[13px] text-ink-muted">
						<span aria-hidden="true" className="mr-2 text-line-strong">/</span>
						{trimmedSubject}
					</span>
				)}
			</span>
			{popup && (
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={onToggleMinimized}
						aria-label={minimized ? t("compose.restore") : t("compose.minimize")}
						title={minimized ? t("compose.restore") : t("compose.minimize")}
						className={cn(COMPOSE_HEADER_BUTTON, "max-md:hidden")}
					>
						{minimized ? <ChevronUp className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
					</button>
					<button
						type="button"
						onClick={onToggleModal}
						aria-label={modalMode ? t("compose.restoreFloating") : t("compose.openModal")}
						title={modalMode ? t("compose.restoreFloating") : t("compose.openModal")}
						className={cn(COMPOSE_HEADER_BUTTON, "max-md:hidden")}
					>
						{modalMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
					</button>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("compose.close")}
						title={t("compose.close")}
						className={cn(COMPOSE_HEADER_BUTTON, "max-md:-mr-2 max-md:p-2.5")}
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			)}
		</div>
	);
}
