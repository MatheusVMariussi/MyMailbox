import type { TranslationKey } from "@/lib/i18n/types";
import type { LucideIcon } from "@/components/icons";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Message, MessageFolder } from "@/hooks/types";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { NavLabel } from "@/components/dashboard-nav-types";

export type MessageFolderConfig = {
	folder: MessageFolder;
	title: string;
	/** Translation keys for built-in folders; custom folders show `title` as typed by the user. */
	titleKey?: TranslationKey;
	emptyText: string;
	emptyTextKey?: TranslationKey;
	hrefPrefix: string;
	labelId?: string;
	icon: LucideIcon;
	headerIcons?: LucideIcon[];
	badgeVariant?: "default" | "secondary" | "outline";
	showRowBadge?: boolean;
};

export type MessageListRowProps = {
	message: Message;
	config: MessageFolderConfig;
	selected: boolean;
	active?: boolean;
	opening?: boolean;
	compact?: boolean;
	currentAccountName?: string;
	onSelectedChange: (messageId: string, selected: boolean) => void;
	/** `labelId` goes with `label`, `unlabel` and `move`. */
	onMessageAction: (messageId: string, action: RowMessageAction, labelId?: string) => Promise<void>;
	onOpening?: (messageId: string) => void;
	onSnoozeChange?: (messageId: string, snoozed: boolean) => void;
	showCompactRowActions?: boolean;
	dragMessageIds?: string[];
	todayKey: string;
	/** The row mailbox's Promotions mode when it is on; undefined means off. */
	promotionMode?: "show" | "separate";
	/** Offer "Move to Promotions / Inbox" on this row. */
	canMovePromotions?: boolean;
	/** The labels of the listed mailboxes, for the chips on each row. */
	labelsById?: ReadonlyMap<string, NavLabel>;
	/** The row's project, for its colored dot; undefined when it has none (or it is not the user's). */
	project?: { name: string; color: string };
	/** The keyboard cursor (`j`/`k`) is on this row. */
	cursor?: boolean;
	/** Some row is checked, so every row shows its checkbox instead of its project dot. */
	selectionMode?: boolean;
};

export type RowMessageAction = "archive" | "trash" | "read" | "unread" | "inbox" | "delete" | "spam" | "label" | "unlabel" | "move";

export type MessageRowActionSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The row's message with its optimistic read and star flags. */
	message: Message;
	/** The sender (or recipients) as the row shows them. */
	party: string;
	onAction: (action: RowMessageAction, labelId?: string) => Promise<void>;
	onToggleStar: () => void;
	/** Check the row, entering selection mode. */
	onSelect: () => void;
	onSnoozeChange?: (messageId: string, snoozed: boolean) => void;
	promotionTarget?: "promotions" | "inbox";
	onPromotionMove?: () => void;
};

export type MessageListRowActionsProps = {
	message: Message;
	/** Folder being listed; archived, spam and trash use a different primary action. */
	folder: MessageFolder;
	labelId?: string;
	onAction: (action: RowMessageAction) => Promise<void>;
	/** Tighter rail for the split-view message list. */
	compact?: boolean;
	/** The row holds the open message, so its rail uses the active-row surface. */
	active?: boolean;
	onSnoozeChange?: (messageId: string, snoozed: boolean) => void;
	/** Where "Move to ..." would send this message; undefined hides the action (Promotions off, no full access, wrong folder). */
	promotionTarget?: "promotions" | "inbox";
	onPromotionMove?: () => void;
};

export type MessageFolderPageProps = {
	config: MessageFolderConfig;
	compact?: boolean;
	selectedMessageId?: string;
};

export type MessageSplitLayoutProps = {
	children: ReactNode;
	config: MessageFolderConfig;
};

export type MessageListVisibility = {
	visible: boolean;
	toggle: () => void;
	singleColumn: boolean;
	backHref: string;
	backLabel: string;
};

export type BulkMessageToolbarProps = {
	selectedCount: number;
	hasUnreadSelection: boolean;
	hideSelectedCount?: boolean;
	onAction: (action: BulkMessageAction, labelId?: string) => void;
	onClearSelection: () => void;
	pending: boolean;
	/** How many selected rows carry each label, for the "Label as" check marks. */
	selectedLabelCounts?: ReadonlyMap<string, number>;
	/** Which menu a keyboard shortcut asked to open (`l` or `v`); bumping `key` reopens it. */
	openMenu?: { kind: "label" | "move"; key: number } | null;
	/** Folder being listed; archived, spam and trash offer a way back instead of the same move. */
	folder?: MessageFolder;
};

export type SelectedMessage = Pick<Message, "id" | "read">;

export type MessageListStateControl = {
	selectedMessages: SelectedMessage[];
	setSelectedMessages: Dispatch<SetStateAction<SelectedMessage[]>>;
	offset: number;
	setOffset: Dispatch<SetStateAction<number>>;
	unreadOnly: boolean;
	setUnreadOnly: Dispatch<SetStateAction<boolean>>;
};

export type BulkMessageActionBarProps = {
	folder?: MessageFolder;
	selectedMessages: SelectedMessage[];
	onClearSelection: () => void;
	/** Bind `l` and `v` to the bar's label menus (only while no message is open; the reader owns them then). */
	shortcutsEnabled?: boolean;
};

export type PageRange = {
	start: number;
	end: number;
	total: number;
};

export type EmailPageTitleInput = {
	location: string;
	total: number;
	unread: number;
	emailAddress: string | null;
	/** Set for the Inbox, which shows only the unread count. */
	inbox?: boolean;
};
