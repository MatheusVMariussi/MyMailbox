"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/components/language-provider";
import { useSidebar } from "@/components/sidebar-state";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useListScope } from "@/components/list-scope-provider";
import { useProjects } from "@/components/projects/use-projects";
import { useIsDesktop } from "@/components/sidebar-mobile-utils";
import { readColumnWidth, readInitialColumnWidth, saveColumnWidth } from "@/components/column-width-preferences";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { BulkMessageActionBar } from "./bulk-message-action-bar";
import { MessageFolderPage } from "./message-folder-page";
import { MessageDetailNavigationProvider } from "./message-detail-navigation";
import { MessageListStateContext } from "./message-list-state";
import { MessageListVisibilityContext } from "./message-list-visibility";
import { readInitialMessageListVisible, saveMessageListVisible } from "./message-list-visibility-utils";
import { ReadingPaneEmpty } from "./reading-pane-empty";
import { useConversationView } from "./use-conversation-view";
import { useTwoColumnReading } from "./use-two-column-reading";
import type { MessageListStateControl, MessageSplitLayoutProps, SelectedMessage } from "./types";

/** The list column: about 400 px by default, never under 320 px. */
const LIST_DEFAULT_WIDTH = 400;
const LIST_MIN_WIDTH = 320;
const LIST_MAX_WIDTH = 1200;
/** The reading pane keeps at least this much room beside the list. */
const READER_MIN_WIDTH = 400;
/** Dragging the list this far below its minimum folds the sidebar into its icon rail. */
const SIDEBAR_FOLD_WIDTH = LIST_MIN_WIDTH - 70;

/**
 * Sidebar | list | reading pane. With the reading pane on the right (the default) the pane is always there
 * from tablet width up: the open conversation, or an empty prompt. With it off, the list fills the page and
 * opens conversations full-width. Phones always show the list, then the conversation full-screen.
 */
export function MessageSplitLayout({
	children,
	config,
}: MessageSplitLayoutProps) {
	const pathname = usePathname();
	const { query } = useMailSearch();
	const scope = useListScope();
	const { projects } = useProjects();
	const [conversationView] = useConversationView();
	const [selectedMessages, setSelectedMessages] = useState<SelectedMessage[]>([]);
	const [offset, setOffset] = useState(0);
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH);
	const [containerWidth, setContainerWidth] = useState(0);
	const [manualListVisible, setManualListVisible] = useState(true);
	const [readingPaneRight] = useTwoColumnReading();
	const containerRef = useRef<HTMLDivElement>(null);
	const startWidth = useRef(listWidth);
	const resizedWidth = useRef(listWidth);
	const { t } = useLanguage();
	const { userId, setForcedMinimal } = useSidebar();
	const splitViewport = useIsDesktop();
	const detailPrefix = `${config.hrefPrefix}/`;
	const selectedMessageId = pathname.startsWith(detailPrefix)
		? pathname.slice(detailPrefix.length).split("/")[0]
		: undefined;
	const hasSelectedMessage = Boolean(selectedMessageId);
	// The list can be folded away while reading, never while the pane is empty.
	const listVisible = readingPaneRight && (manualListVisible || !hasSelectedMessage);
	const maxListWidth = Math.max(LIST_MIN_WIDTH, (containerWidth || 1100) - READER_MIN_WIDTH);
	const renderedListWidth = Math.max(LIST_MIN_WIDTH, Math.min(listWidth, maxListWidth));
	const grouped = conversationView && config.folder !== "drafts";
	const listState = useMemo<MessageListStateControl>(() => ({
		selectedMessages,
		setSelectedMessages,
		offset,
		setOffset,
		unreadOnly,
		setUnreadOnly,
	}), [selectedMessages, offset, unreadOnly]);
	// The layout outlives the page that renders the list, so a filter change
	// resets the shared list here instead of from the page that happens to be
	// mounted. Comparing keys keeps the initial mount from wiping a selection
	// that the split view is about to show.
	const viewKey = [query, scope.mailboxId ?? "", scope.projectId ?? "", config.folder, config.labelId ?? "", grouped, unreadOnly].join("\u0000");
	const previousViewKey = useRef(viewKey);
	const folderKey = `${config.folder}\u0000${config.labelId ?? ""}`;
	const previousFolderKey = useRef(folderKey);
	// Bulk actions for a selection sit at the top of the reading pane whenever the list is beside it.
	const showBulkBar = selectedMessages.length > 0 && readingPaneRight && splitViewport;
	const project = scope.projectId ? projects.find((item) => item.id === scope.projectId) : undefined;
	const folderPath = useMemo(() => {
		const folder = query.trim()
			? ["search"]
			: config.labelId
				? ["labels", config.title]
				: [config.hrefPrefix.replace(/^\/+/, "") || config.folder];
		return project ? [project.name, ...folder] : folder;
	}, [config.folder, config.hrefPrefix, config.labelId, config.title, project, query]);

	useEffect(() => {
		if (previousViewKey.current === viewKey) return;
		previousViewKey.current = viewKey;
		setOffset(0);
		setSelectedMessages([]);
	}, [viewKey]);

	useEffect(() => {
		if (previousFolderKey.current === folderKey) return;
		previousFolderKey.current = folderKey;
		setUnreadOnly(false);
	}, [folderKey]);

	useLayoutEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; restoring it in a lazy initialiser would mismatch the server-rendered markup.
		setListWidth(readInitialColumnWidth("message-list", LIST_DEFAULT_WIDTH, LIST_MIN_WIDTH, LIST_MAX_WIDTH));
		setManualListVisible(readInitialMessageListVisible());
	}, []);

	useEffect(() => {
		if (!userId) return;
		const savedWidth = readColumnWidth(userId, "message-list", readInitialColumnWidth("message-list", LIST_DEFAULT_WIDTH, LIST_MIN_WIDTH, LIST_MAX_WIDTH), LIST_MIN_WIDTH, LIST_MAX_WIDTH);
		// eslint-disable-next-line react-hooks/set-state-in-effect -- the per-user width lives in localStorage and is only known once the user id resolves.
		setListWidth(savedWidth);
		saveColumnWidth(userId, "message-list", savedWidth);
	}, [userId]);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		setContainerWidth(container.clientWidth);
		const observer = new ResizeObserver(() => setContainerWidth(container.clientWidth));
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	useEffect(() => () => setForcedMinimal(false), [setForcedMinimal]);

	// The list lives in the layout, not in a route page, so opening and closing a
	// message never unmounts it. That keeps its state (and its paint) intact when
	// an action sends the reader back to the folder.
	const listHidden = hasSelectedMessage && !listVisible;
	const gridTemplateColumns = readingPaneRight
		? `${listVisible ? renderedListWidth : 0}px minmax(0,1fr)`
		: "minmax(0,1fr)";

	const listVisibility = {
		visible: listVisible,
		toggle: () => { const visible = !manualListVisible; setManualListVisible(visible); saveMessageListVisible(visible); },
		singleColumn: !readingPaneRight,
		backHref: config.hrefPrefix,
		backLabel: config.titleKey ? t(config.titleKey) : config.title,
	};

	return (
		<MessageListStateContext.Provider value={listState}>
			<div ref={containerRef} className={clsx("h-full min-h-0 overflow-hidden", readingPaneRight && "md:grid")} style={{ gridTemplateColumns }}>
				<div
					className={clsx(
						"relative h-full min-h-0 min-w-0 overflow-hidden bg-white",
						hasSelectedMessage && (readingPaneRight ? "hidden md:block" : "hidden"),
						readingPaneRight && listVisible && "md:border-r md:border-line",
						listHidden && "pointer-events-none",
					)}
					aria-hidden={listHidden || undefined}
					inert={listHidden || undefined}
					data-message-list-pane=""
				>
					<div className="h-full overflow-hidden" style={{ width: readingPaneRight && splitViewport ? renderedListWidth : "100%" }}>
						<MessageFolderPage
							config={config}
							compact={readingPaneRight}
							selectedMessageId={selectedMessageId}
						/>
					</div>
					{readingPaneRight && listVisible && (
						<ResizeHandle
							label={t("list.resize")}
							onResizeStart={() => { startWidth.current = renderedListWidth; resizedWidth.current = renderedListWidth; }}
							onResize={(delta) => {
								const requestedWidth = startWidth.current + delta;
								setForcedMinimal(requestedWidth < SIDEBAR_FOLD_WIDTH);
								resizedWidth.current = Math.max(LIST_MIN_WIDTH, Math.min(requestedWidth, Math.max(LIST_MIN_WIDTH, (containerRef.current?.clientWidth ?? 1100) - READER_MIN_WIDTH)));
								setListWidth(resizedWidth.current);
							}}
							onResizeEnd={() => saveColumnWidth(userId, "message-list", resizedWidth.current)}
						/>
					)}
				</div>
				{(selectedMessageId || readingPaneRight) && (
					<section
						aria-label={selectedMessageId ? undefined : t("readingPane.label")}
						className={clsx(
							"h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white",
							selectedMessageId ? "flex" : "hidden md:flex",
						)}
					>
						{showBulkBar && (
							<BulkMessageActionBar
								folder={config.labelId ? undefined : config.folder}
								selectedMessages={selectedMessages}
								onClearSelection={() => setSelectedMessages([])}
								shortcutsEnabled={!selectedMessageId}
							/>
						)}
						{selectedMessageId ? (
							<MessageListVisibilityContext.Provider value={listVisibility}>
								<MessageDetailNavigationProvider config={config} currentMessageId={selectedMessageId}>
									{children}
								</MessageDetailNavigationProvider>
							</MessageListVisibilityContext.Provider>
						) : (
							<div className="min-h-0 flex-1">
								<ReadingPaneEmpty folderPath={folderPath} />
							</div>
						)}
					</section>
				)}
			</div>
		</MessageListStateContext.Provider>
	);
}
