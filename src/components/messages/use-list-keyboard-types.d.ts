import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { Message } from "@/hooks/types";
import type { Translator } from "@/lib/i18n/utils";
import type { MessageFolderConfig } from "./types";

export type ListKeyboardOptions = {
	/** The rows on screen, in order. */
	messages: Message[];
	config: Pick<MessageFolderConfig, "folder" | "hrefPrefix">;
	/** The conversation open in the reader, if any; the cursor follows it. */
	selectedMessageId?: string;
	selectedIds: string[];
	selectedIdSet: ReadonlySet<string>;
	/** The list sits beside the reading pane, so moving the cursor opens the conversation. */
	paneBeside: boolean;
	/** Keyboard shortcuts are on. */
	enabled: boolean;
	navigate: (href: string) => void;
	runAction: (ids: string[], action: BulkMessageAction) => void;
	toggleSelected: (id: string, selected: boolean) => void;
	updateMessages: (update: (current: Message[]) => Message[]) => void;
	onError: (message: string) => void;
	t: Translator;
};
