import type { SearchHelpEntry } from "./types";

/** The operator cheat sheet behind the search box's "?": picking a row appends `insert` to the query. */
export const SEARCH_HELP_ENTRIES: readonly SearchHelpEntry[] = [
	{ example: "from:", insert: "from:", descriptionKey: "search.help.from" },
	{ example: "to:", insert: "to:", descriptionKey: "search.help.to" },
	{ example: "subject:", insert: "subject:", descriptionKey: "search.help.subject" },
	{ example: "label:", insert: "label:", descriptionKey: "search.help.label" },
	{ example: "project:", insert: "project:", descriptionKey: "search.help.project" },
	{ example: "in:inbox", insert: "in:", descriptionKey: "search.help.in" },
	{ example: "is:unread", insert: "is:", descriptionKey: "search.help.is" },
	{ example: "has:attachment", insert: "has:attachment", descriptionKey: "search.help.has" },
	{ example: "filename:pdf", insert: "filename:", descriptionKey: "search.help.filename" },
	{ example: "after:2026-01-31", insert: "after:", descriptionKey: "search.help.date" },
	{ example: "newer_than:7d", insert: "newer_than:", descriptionKey: "search.help.age" },
	{ example: "larger:5M", insert: "larger:", descriptionKey: "search.help.size" },
	{ example: "deliveredto:", insert: "deliveredto:", descriptionKey: "search.help.deliveredto" },
];

/** How terms combine; shown below the operators, not inserted. */
export const SEARCH_HELP_SYNTAX: readonly Omit<SearchHelpEntry, "insert">[] = [
	{ example: "a OR b", descriptionKey: "search.help.or" },
	{ example: "-word", descriptionKey: "search.help.not" },
	{ example: "(a b)", descriptionKey: "search.help.group" },
	{ example: "\"exact words\"", descriptionKey: "search.help.phrase" },
];
