"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Archive, ArchiveRestore, Check, CheckSquare2, ChevronLeft, ChevronRight, Clock, FolderInput, Inbox, Mail, MailOpen, ShieldAlert, ShieldCheck, Star, Tag, Trash2, Undo2, X } from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { alertDialog, confirmDestructive } from "@/components/ui/confirm-dialog";
import { getUserTimeZone } from "@/lib/time/utils";
import { getPermanentDeleteConfirmText } from "@/lib/messages/permanent-delete-utils";
import type { TranslationKey } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";
import { getSnoozePresets, isMessageSnoozed, snoozeMessage, unsnoozeMessage } from "./message-list-row-actions-utils";
import { getRowSheetActions } from "./message-row-action-sheet-utils";
import type { RowSheetMoveFolder, RowSheetPrimaryMove } from "./message-row-action-sheet-utils";
import { useScopeLabels } from "./use-scope-labels";
import type { MessageRowActionSheetProps, RowMessageAction } from "./types";

type Page = "root" | "snooze" | "label" | "move";
const PAGES: Page[] = ["root", "snooze", "label", "move"];

const pageClass = "flex max-h-[calc(85dvh-4rem)] w-full shrink-0 flex-col px-2 pb-3";
const rowClass = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-neutral-900 transition-colors duration-150 active:bg-neutral-100 motion-reduce:transition-none";
const ease = "duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none";

const PRIMARY_MOVES: Record<Exclude<RowSheetPrimaryMove, null>, { action: RowMessageAction; labelKey: TranslationKey; icon: LucideIcon }> = {
	archive: { action: "archive", labelKey: "common.archive", icon: Archive },
	unarchive: { action: "inbox", labelKey: "common.unarchive", icon: ArchiveRestore },
	notSpam: { action: "inbox", labelKey: "common.notSpam", icon: ShieldCheck },
	restore: { action: "inbox", labelKey: "common.restore", icon: Undo2 },
};

const MOVE_FOLDERS: Record<RowSheetMoveFolder, { labelKey: TranslationKey; icon: LucideIcon }> = {
	inbox: { labelKey: "navigation.inbox", icon: Inbox },
	archive: { labelKey: "navigation.archived", icon: Archive },
	spam: { labelKey: "navigation.spam", icon: ShieldAlert },
	trash: { labelKey: "navigation.trash", icon: Trash2 },
};

/** Phone long-press menu for one list row: the quick actions up top, everything else below, label and snooze pickers as pages. */
export function MessageRowActionSheet({ open, onOpenChange, message, party, onAction, onToggleStar, onSelect, onSnoozeChange, promotionTarget, onPromotionMove }: MessageRowActionSheetProps) {
	const { t } = useLanguage();
	const { groups: labels, groupOf } = useScopeLabels();
	const [page, setPage] = useState<Page>("root");
	const [customSnooze, setCustomSnooze] = useState("");
	const pageRefs = useRef<Record<Page, HTMLDivElement | null>>({ root: null, snooze: null, label: null, move: null });
	const [height, setHeight] = useState<number | undefined>(undefined);
	const snoozed = isMessageSnoozed(message.snoozedUntil);
	const actions = getRowSheetActions({ status: message.status, direction: message.direction, snoozed });
	const primary = actions.primaryMove ? PRIMARY_MOVES[actions.primaryMove] : null;
	const labelGroupIds = new Set((message.labelIds ?? []).map((labelId) => groupOf.get(labelId)?.id ?? labelId));

	// Every opening starts on the first page.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) setPage("root");
	}

	// The sheet is as tall as the page showing and eases between heights as pages slide.
	useEffect(() => {
		const element = pageRefs.current[page];
		if (!open || !element) return;
		const measure = () => setHeight(element.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [open, page]);

	/** Close first so the list (and its undo toast) is visible while the action runs. */
	function run(action: RowMessageAction, labelId?: string) {
		onOpenChange(false);
		void onAction(action, labelId).catch(() => undefined);
	}

	async function deleteForever() {
		onOpenChange(false);
		const count = message.threadMessageIds?.length ?? 1;
		if (!await confirmDestructive(getPermanentDeleteConfirmText(count, t))) return;
		await onAction("delete").catch(() => undefined);
	}

	function snoozeUntil(value: string) {
		onOpenChange(false);
		void snoozeMessage(message.id, value)
			.then(() => onSnoozeChange?.(message.id, true))
			.catch(() => alertDialog(t("snooze.failed")));
	}

	function unsnooze() {
		onOpenChange(false);
		void unsnoozeMessage(message.id)
			.then(() => onSnoozeChange?.(message.id, false))
			.catch(() => alertDialog(t("snooze.failed")));
	}

	const subPageTitle = page === "snooze" ? t("snooze.title") : page === "label" ? t("labels.labelAs") : t("common.moveTo");
	const canMove = actions.moveFolders.length > 0 || labels.length > 0;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="slide-sheet-overlay fixed inset-0 z-[70] bg-black/40" />
				<DialogPrimitive.Content className="slide-sheet fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none">
					<span aria-hidden="true" className="mx-auto mt-2 block h-1 w-9 rounded-full bg-neutral-200" />
					<div className="flex h-14 items-center gap-1 px-2">
						{page === "root" ? (
							<div className="min-w-0 flex-1 px-3">
								<DialogPrimitive.Title className="truncate text-base font-semibold text-neutral-900">{party}</DialogPrimitive.Title>
								<DialogPrimitive.Description className="truncate text-sm text-neutral-500">{message.subject ?? t("list.noSubject")}</DialogPrimitive.Description>
							</div>
						) : (
							<>
								<button type="button" onClick={() => setPage("root")} className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-700 active:bg-neutral-100">
									<ChevronLeft className="h-6 w-6" />
									<span className="sr-only">{party}</span>
								</button>
								<p className="flex-1 truncate text-center text-base font-semibold text-neutral-900">{subPageTitle}</p>
							</>
						)}
						<DialogPrimitive.Close className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-700 active:bg-neutral-100">
							<X className="h-5 w-5" />
							<span className="sr-only">{t("navigation.close")}</span>
						</DialogPrimitive.Close>
					</div>
					<div className={cn("overflow-hidden transition-[height]", ease)} style={{ height }}>
						<div className={cn("flex items-start transition-transform", ease)} style={{ transform: `translateX(-${PAGES.indexOf(page) * 100}%)` }}>
							<div ref={(node) => { pageRefs.current.root = node; }} className={pageClass} inert={page !== "root"}>
								<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
									<div className="flex gap-2 px-1 pb-2">
										{actions.readToggle && (
											<Tile
												icon={message.read ? Mail : MailOpen}
												label={message.read ? t("list.markUnread") : t("list.markRead")}
												onClick={() => run(message.read ? "unread" : "read")}
											/>
										)}
										<Tile
											icon={Star}
											iconClassName={message.starred ? "fill-warm text-warm" : undefined}
											label={message.starred ? t("message.removeStar") : t("message.star")}
											onClick={() => {
												onOpenChange(false);
												onToggleStar();
											}}
										/>
										{primary && <Tile icon={primary.icon} label={t(primary.labelKey)} onClick={() => run(primary.action)} />}
										{actions.trash ? (
											<Tile icon={Trash2} label={t("common.delete")} destructive onClick={() => run("trash")} />
										) : (
											<Tile icon={Trash2} label={t("common.deleteForever")} destructive onClick={() => void deleteForever()} />
										)}
									</div>
									{actions.snooze === "snooze" && <PageRow icon={Clock} label={t("common.snooze")} onClick={() => setPage("snooze")} />}
									{actions.snooze === "unsnooze" && <Row icon={Clock} label={t("common.unsnooze")} onClick={unsnooze} />}
									{promotionTarget && onPromotionMove && (
										<Row
											icon={promotionTarget === "inbox" ? Inbox : Tag}
											label={promotionTarget === "inbox" ? t("promotions.move.toInbox") : t("promotions.move.toPromotions")}
											onClick={() => {
												onOpenChange(false);
												onPromotionMove();
											}}
										/>
									)}
									{labels.length > 0 && <PageRow icon={Tag} label={t("labels.labelAs")} onClick={() => setPage("label")} />}
									{canMove && <PageRow icon={FolderInput} label={t("common.moveTo")} onClick={() => setPage("move")} />}
									{actions.reportSpam && <Row icon={ShieldAlert} label={t("common.reportSpam")} onClick={() => run("spam")} />}
									{actions.trash && actions.deleteForever && (
										<Row icon={Trash2} label={t("common.deleteForever")} destructive onClick={() => void deleteForever()} />
									)}
									<div className="mx-3 my-1 h-px bg-neutral-100" />
									<Row
										icon={CheckSquare2}
										label={t("list.select")}
										onClick={() => {
											onOpenChange(false);
											onSelect();
										}}
									/>
								</div>
							</div>
							<div ref={(node) => { pageRefs.current.snooze = node; }} className={pageClass} inert={page !== "snooze"}>
								<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
									{page === "snooze" && getSnoozePresets().map((preset) => (
										<Row key={preset.labelKey} icon={Clock} label={t(preset.labelKey)} onClick={() => snoozeUntil(preset.value)} />
									))}
								</div>
								<div className="shrink-0 space-y-3 px-2 pt-3">
									<input
										type="datetime-local"
										value={customSnooze}
										onChange={(event) => setCustomSnooze(event.target.value)}
										aria-label={t("snooze.selectDateTime", { timeZone: getUserTimeZone() })}
										className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base text-neutral-900 outline-none focus:border-blue-400"
									/>
									<Button type="button" className="h-12 w-full rounded-xl text-base" disabled={!customSnooze} onClick={() => snoozeUntil(customSnooze)}>
										{t("common.snooze")}
									</Button>
								</div>
							</div>
							<div ref={(node) => { pageRefs.current.label = node; }} className={pageClass} inert={page !== "label"}>
								<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
									{labels.map((label) => {
										const applied = labelGroupIds.has(label.id);
										return (
											<button
												key={label.id}
												type="button"
												aria-pressed={applied}
												onClick={() => run(applied ? "unlabel" : "label", label.id)}
												className={rowClass}
											>
												<Tag className="h-5 w-5 shrink-0" style={{ color: label.color }} />
												<span className="min-w-0 flex-1 truncate">{label.name}</span>
												{applied && <Check className="h-5 w-5 shrink-0 text-blue-600" />}
											</button>
										);
									})}
								</div>
							</div>
							<div ref={(node) => { pageRefs.current.move = node; }} className={pageClass} inert={page !== "move"}>
								<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
									{actions.moveFolders.map((folder) => (
										<Row key={folder} icon={MOVE_FOLDERS[folder].icon} label={t(MOVE_FOLDERS[folder].labelKey)} onClick={() => run(folder)} />
									))}
									{actions.moveFolders.length > 0 && labels.length > 0 && (
										<p className="px-3 pb-1 pt-3 text-sm font-medium text-neutral-500">{t("navigation.labels")}</p>
									)}
									{labels.map((label) => (
										<button key={label.id} type="button" onClick={() => run("move", label.id)} className={rowClass}>
											<Tag className="h-5 w-5 shrink-0" style={{ color: label.color }} />
											<span className="min-w-0 flex-1 truncate">{label.name}</span>
										</button>
									))}
								</div>
							</div>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

type ActionProps = {
	icon: LucideIcon;
	label: string;
	onClick: () => void;
	destructive?: boolean;
};

function Tile({ icon: Icon, label, onClick, destructive, iconClassName }: ActionProps & { iconClassName?: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex min-h-[4.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-neutral-50 px-1 text-xs font-medium text-neutral-700 transition-[background-color,transform] duration-150 active:scale-[0.97] active:bg-neutral-100 motion-reduce:transition-none",
				destructive && "text-red-600",
			)}
		>
			<Icon className={cn("h-5 w-5", iconClassName)} />
			<span className="line-clamp-2 w-full text-center leading-tight">{label}</span>
		</button>
	);
}

function Row({ icon: Icon, label, onClick, destructive, trailing }: ActionProps & { trailing?: ReactNode }) {
	return (
		<button type="button" onClick={onClick} className={cn(rowClass, destructive && "text-red-600")}>
			<Icon className={cn("h-5 w-5 shrink-0", destructive ? "text-red-600" : "text-neutral-500")} />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{trailing}
		</button>
	);
}

function PageRow(props: ActionProps) {
	return <Row {...props} trailing={<ChevronRight className="h-5 w-5 shrink-0 text-neutral-400" />} />;
}
