import type { ShortcutCatalogGroup } from "./shortcut-catalog-types";

/**
 * Every key the mail client answers, grouped for the help dialog. Each entry lists its alternatives
 * (`o` or `Enter`); an alternative is one chord (`Shift` + `I`) or a sequence (`g` then `i`).
 */
export const SHORTCUT_CATALOG: readonly ShortcutCatalogGroup[] = [
	{
		category: "Navigation",
		entries: [
			{ labelKey: "shortcut.next", keys: [{ chord: ["j"] }] },
			{ labelKey: "shortcut.previous", keys: [{ chord: ["k"] }] },
			{ labelKey: "shortcut.open", keys: [{ chord: ["o"] }, { chord: ["Enter"] }] },
			{ labelKey: "shortcut.backToList", keys: [{ chord: ["u"] }] },
			{ labelKey: "shortcut.focusSearch", keys: [{ chord: ["/"] }] },
			{ labelKey: "shortcut.goInbox", keys: [{ sequence: ["g", "i"] }] },
			{ labelKey: "shortcut.goStarred", keys: [{ sequence: ["g", "s"] }] },
			{ labelKey: "shortcut.goSent", keys: [{ sequence: ["g", "t"] }] },
			{ labelKey: "shortcut.goDrafts", keys: [{ sequence: ["g", "d"] }] },
			{ labelKey: "shortcut.goArchived", keys: [{ sequence: ["g", "a"] }] },
		],
	},
	{
		category: "Actions",
		entries: [
			{ labelKey: "shortcut.archiveMessage", keys: [{ chord: ["e"] }] },
			{ labelKey: "shortcut.moveToTrash", keys: [{ chord: ["#"] }] },
			{ labelKey: "shortcut.reportSpam", keys: [{ chord: ["!"] }] },
			{ labelKey: "shortcut.star", keys: [{ chord: ["s"] }] },
			{ labelKey: "shortcut.labelAs", keys: [{ chord: ["l"] }] },
			{ labelKey: "shortcut.moveTo", keys: [{ chord: ["v"] }] },
			{ labelKey: "shortcut.markRead", keys: [{ chord: ["Shift", "I"] }] },
			{ labelKey: "shortcut.markUnread", keys: [{ chord: ["Shift", "U"] }] },
			{ labelKey: "shortcut.undo", keys: [{ chord: ["z"] }] },
		],
	},
	{
		category: "Composing",
		entries: [
			{ labelKey: "shortcut.compose", keys: [{ chord: ["c"] }] },
			{ labelKey: "shortcut.replyToMessage", keys: [{ chord: ["r"] }] },
			{ labelKey: "shortcut.replyAll", keys: [{ chord: ["a"] }] },
			{ labelKey: "shortcut.forward", keys: [{ chord: ["f"] }] },
		],
	},
	{
		category: "Selection",
		entries: [
			{ labelKey: "shortcut.select", keys: [{ chord: ["x"] }] },
		],
	},
	{
		category: "General",
		entries: [
			{ labelKey: "shortcut.cheatSheet", keys: [{ chord: ["?"] }] },
			{ labelKey: "shortcut.commandPalette", keys: [{ chord: ["⌘", "K"] }, { chord: ["Ctrl", "K"] }] },
			{ labelKey: "shortcut.dismiss", keys: [{ chord: ["Esc"] }] },
		],
	},
];
