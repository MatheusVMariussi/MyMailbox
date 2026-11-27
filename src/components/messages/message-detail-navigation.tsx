"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useListScope } from "@/components/list-scope-provider";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { authFetch } from "@/lib/auth/client";
import { fetchCachedMessageDetail, getCachedMessageDetail } from "@/lib/messages/detail-cache";
import { fetchInviteCard, getCachedInviteCard } from "@/lib/calendar/invite-cache";
import { findInviteAttachment } from "@/lib/calendar/invite-attachment";
import { FULL_ROUTE_PREFETCH } from "@/lib/navigation/prefetch";
import type { CachedMessageDetail } from "@/lib/messages/detail-cache-types";
import type { MessageNavigationResponse } from "@/app/api/messages/navigation/types";
import type { MessageDetailNavigationContextValue, MessageDetailNavigationProps, MessageDetailNavigationProviderProps, MessageDetailNavigationSnapshot, OpenedUnreadMessages } from "./message-detail-navigation-types";
import { getAutoAdvanceId, getMessageDetailNavigationState, takeOpenedUnreadMessage } from "./message-detail-navigation-utils";
import { useAutoAdvanceEnabled } from "./use-auto-advance";
import { useConversationView } from "./use-conversation-view";
import { useHotkeys } from "@/components/shortcuts/use-hotkeys";
import { useShortcutsActive } from "@/components/shortcuts/shortcuts-enabled-context";

const NavigationContext = createContext<MessageDetailNavigationContextValue | null>(null);

/** Seed the invite cache once the detail is known, or right away when the attachment state is still unknown. */
function warmMessageInvite(messageId: string, detail?: CachedMessageDetail) {
	if (getCachedInviteCard(messageId) !== undefined) return;
	if (detail?.attachments && !findInviteAttachment(detail.attachments)) return;
	void fetchInviteCard(messageId).catch(() => {});
}

export function MessageDetailNavigationProvider({ children, config, currentMessageId }: MessageDetailNavigationProviderProps) {
	// Prev/next walk the list as it is scoped: every mailbox or one, optionally one project.
	const { mailboxId, projectId, isLoading: mailboxesLoading } = useListScope();
	// While searching, prev/next walk the results (every folder), as the list does.
	const query = useMailSearch().query.trim();
	const [conversationView] = useConversationView();
	const grouped = conversationView && config.folder !== "drafts";
	const key = `${config.folder}:${config.labelId ?? ""}:${mailboxId ?? "all"}:${projectId ?? ""}:${grouped}:${query}`;
	const [snapshot, setSnapshot] = useState<MessageDetailNavigationSnapshot>({ key: "", entries: [] });
	const [openedUnread, setOpenedUnread] = useState<OpenedUnreadMessages>({ key: "", ids: new Set() });
	const recordUnread = useCallback((messageId: string) => {
		setOpenedUnread((current) => {
			const ids = new Set(current.key === key ? current.ids : []);
			ids.add(messageId);
			return { key, ids };
		});
	}, [key]);

	const [dropped, setDropped] = useState<OpenedUnreadMessages>({ key: "", ids: new Set() });
	const dropEntry = useCallback((messageId: string) => {
		setDropped((current) => {
			const ids = new Set(current.key === key ? current.ids : []);
			ids.add(messageId);
			return { key, ids };
		});
	}, [key]);

	useEffect(() => {
		const messageId = takeOpenedUnreadMessage();
		// eslint-disable-next-line react-hooks/set-state-in-effect -- consumes a one-shot sessionStorage handoff, a side effect that cannot run during render.
		if (messageId) recordUnread(messageId);
	}, [recordUnread]);

	// Re-anchor if the open message falls outside the loaded window.
	const currentIndex = snapshot.key === key && currentMessageId
		? snapshot.entries.findIndex((entry) => entry.id === currentMessageId)
		: -1;
	const beyondWindow = snapshot.key !== key
		|| (snapshot.entries.length > 0 && currentIndex === -1)
		|| (currentIndex === 0 && snapshot.hasNewer === true)
		|| (currentIndex === snapshot.entries.length - 1 && snapshot.hasOlder === true);
	const requestAnchor = currentMessageId && beyondWindow ? currentMessageId : undefined;

	useEffect(() => {
		if (mailboxesLoading || !requestAnchor) return;
		let cancelled = false;
		const params = new URLSearchParams({ folder: config.folder });
		if (query) {
			params.set("scope", "search");
			params.set("q", query);
		} else if (config.labelId) params.set("labelId", config.labelId);
		if (mailboxId) params.set("mailboxId", mailboxId);
		if (projectId) params.set("projectId", projectId);
		if (grouped) params.set("group", "thread");
		params.set("around", requestAnchor);
		void authFetch(`/api/messages/navigation?${params.toString()}`)
			.then((response) => {
				if (!response.ok) throw new Error("Unable to load message navigation");
				return response.json() as Promise<MessageNavigationResponse>;
			})
			.then((response) => {
				if (!cancelled) setSnapshot({ key, entries: response.messages, hasNewer: response.hasNewer, hasOlder: response.hasOlder });
			})
			.catch(() => {
				if (!cancelled) setSnapshot({ key, entries: [] });
			});
		return () => { cancelled = true; };
	}, [config.folder, config.labelId, grouped, key, mailboxId, mailboxesLoading, projectId, query, requestAnchor]);

	const unreadIds = openedUnread.key === key ? openedUnread.ids : null;
	const droppedIds = dropped.key === key ? dropped.ids : null;
	const entries = snapshot.key === key
		? snapshot.entries
			.filter((entry) => !droppedIds?.has(entry.id))
			.map((entry) => ({ ...entry, unread: entry.unread || !!unreadIds?.has(entry.id) }))
		: [];
	return <NavigationContext.Provider value={{ entries, hrefPrefix: config.hrefPrefix, recordUnread, dropEntry }}>{children}</NavigationContext.Provider>;
}

/**
 * Call after `messageId` was moved out of the open list. With auto-advance on it
 * returns the next message's href (and hides the moved one from the arrows);
 * otherwise null, so the caller falls back to the list.
 */
export function useAutoAdvance(messageId: string): () => string | null {
	const context = useContext(NavigationContext);
	const [enabled] = useAutoAdvanceEnabled();
	return useCallback(() => {
		if (!enabled || !context) return null;
		const targetId = getAutoAdvanceId(context.entries, messageId);
		if (!targetId) return null;
		context.dropEntry(messageId);
		return `${context.hrefPrefix}/${targetId}`;
	}, [context, enabled, messageId]);
}

export function MessageDetailNavigation({ messageId, unread }: MessageDetailNavigationProps) {
	const { t } = useLanguage();
	const context = useContext(NavigationContext);
	const recordUnread = context?.recordUnread;
	const router = useRouter();
	useEffect(() => {
		if (unread) recordUnread?.(messageId);
	}, [recordUnread, messageId, unread]);

	const navigation = context
		? getMessageDetailNavigationState(context.entries, messageId)
		: null;
	const previousId = navigation?.previousId ?? null;
	const nextId = navigation?.nextId ?? null;
	const unreadOrder = navigation?.unreadOrder ?? 0;
	const totalUnread = navigation?.totalUnread ?? 0;
	const hrefPrefixForKeys = context?.hrefPrefix;
	// `j` is the next (older) conversation and `k` the previous (newer) one, as in Gmail.
	const shortcutsActive = useShortcutsActive();
	const navigationShortcuts = [
		{ key: "j", label: t("shortcut.next"), category: "Navigation" as const, action: () => { if (nextId && hrefPrefixForKeys) router.push(`${hrefPrefixForKeys}/${nextId}`); } },
		{ key: "k", label: t("shortcut.previous"), category: "Navigation" as const, action: () => { if (previousId && hrefPrefixForKeys) router.push(`${hrefPrefixForKeys}/${previousId}`); } },
	];
	useHotkeys(navigationShortcuts, { enabled: shortcutsActive && !!context });

	useEffect(() => {
		if (!previousId && !nextId) return;
		const warm = (id: string | null) => {
			if (!id) return;
			const cached = getCachedMessageDetail(id);
			if (cached?.body) {
				warmMessageInvite(id, cached);
				return;
			}
			void fetchCachedMessageDetail(id, true)
				.then((detail) => warmMessageInvite(id, detail))
				.catch(() => {});
		};
		const run = () => {
			warm(previousId);
			warm(nextId);
		};
		if ("requestIdleCallback" in window) {
			const id = window.requestIdleCallback(run, { timeout: 1000 });
			return () => window.cancelIdleCallback(id);
		}
		const timer = setTimeout(run, 250);
		return () => clearTimeout(timer);
	}, [nextId, previousId]);

	if (!context) return null;
	const hrefPrefix = context.hrefPrefix;

	function prefetchMessage(id: string | null, immediateInvite = false) {
		if (!id) return;
		router.prefetch(`${hrefPrefix}/${id}`, FULL_ROUTE_PREFETCH);
		const cached = getCachedMessageDetail(id);
		if (immediateInvite) warmMessageInvite(id, cached);
		if (cached?.body) {
			warmMessageInvite(id, cached);
			return;
		}
		void fetchCachedMessageDetail(id, true)
			.then((detail) => warmMessageInvite(id, detail))
			.catch(() => {});
	}

	return (
		<div className="ml-auto flex shrink-0 items-center gap-1 text-ink-muted">
			{totalUnread > 0 && (
			<span className="mr-2 whitespace-nowrap font-mono text-[11px] tabular-nums" aria-live="polite">
				{t("message.nav.unreadPosition", { position: unreadOrder, total: totalUnread })}
			</span>
			)}
			<Tooltip label={t("message.nav.newer")}>
				<Button
					type="button"
					variant="ghost"
					size="roundedSM"
					aria-label={t("message.nav.newer")}
					disabled={!previousId}
					onPointerEnter={() => prefetchMessage(previousId)}
					onFocus={() => prefetchMessage(previousId)}
					onTouchStart={() => prefetchMessage(previousId, true)}
					onClick={() => {
						prefetchMessage(previousId, true);
						if (previousId) router.push(`${hrefPrefix}/${previousId}`);
					}}
				>
					<ChevronLeft size={18} />
				</Button>
			</Tooltip>
			<Tooltip label={t("message.nav.older")}>
				<Button
					type="button"
					variant="ghost"
					size="roundedSM"
					aria-label={t("message.nav.older")}
					disabled={!nextId}
					onPointerEnter={() => prefetchMessage(nextId)}
					onFocus={() => prefetchMessage(nextId)}
					onTouchStart={() => prefetchMessage(nextId, true)}
					onClick={() => {
						prefetchMessage(nextId, true);
						if (nextId) router.push(`${hrefPrefix}/${nextId}`);
					}}
				>
					<ChevronRight size={18} />
				</Button>
			</Tooltip>
		</div>
	);
}
