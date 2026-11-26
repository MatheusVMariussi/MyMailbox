export type ParsedSearchQuery = {
	/** Free text after operators are removed; matched against every indexed column. */
	text: string;
	from?: string;
	to?: string;
	subject?: string;
	hasAttachment?: boolean;
	read?: "read" | "unread";
	starred?: boolean;
	/** From `category:promotions` (or `promotion`) and `category:primary` (or `inbox`, everything else). */
	category?: "promotions" | "primary";
	/** Inclusive lower bound on the message date, from `after:YYYY-MM-DD`. */
	after?: Date;
	/** Exclusive upper bound on the message date, from `before:YYYY-MM-DD`. */
	before?: Date;
	/** True when anything in the query needs the full-text index. */
	needsFullText: boolean;
};

/** A column filter on the full-text index; `to` covers Cc as well, as it always has. */
export type SearchField = "from" | "to" | "cc" | "bcc" | "subject";

/** What `in:` names: the folders of the web client, plus `anywhere` (every folder, Spam and Trash included). */
export type SearchFolder = "inbox" | "sent" | "drafts" | "spam" | "trash" | "archive" | "snoozed" | "anywhere";

export type SearchAgeUnit = "d" | "w" | "m" | "y";

/**
 * A parsed search. `term` leaves go to the full-text index (free text when `field` is null); every other
 * leaf is a column predicate. Label and project names are kept normalized (`normalizeSearchName`).
 */
export type SearchNode =
	| { kind: "and"; children: SearchNode[] }
	| { kind: "or"; children: SearchNode[] }
	| { kind: "not"; child: SearchNode }
	| { kind: "term"; field: SearchField | null; value: string; phrase: boolean }
	| { kind: "has"; value: "attachment" }
	| { kind: "filename"; value: string }
	| { kind: "is"; value: "unread" | "read" | "starred" | "snoozed" }
	| { kind: "in"; value: SearchFolder }
	| { kind: "label"; value: string }
	| { kind: "project"; value: string }
	| { kind: "deliveredto"; value: string }
	| { kind: "category"; value: "promotions" | "primary" }
	| { kind: "date"; bound: "after" | "before"; at: Date }
	| { kind: "age"; bound: "newer" | "older"; amount: number; unit: SearchAgeUnit }
	| { kind: "size"; bound: "larger" | "smaller"; bytes: number };

export type SearchQuery = {
	/** Null when nothing searchable is left (an empty or all-whitespace query, a lone minus, `""`). */
	root: SearchNode | null;
	/** The input was cut at the length cap or leaves past the node cap were dropped; callers refuse such a query. */
	limited: boolean;
};

export type SearchParseOptions = {
	/** Calendar dates (`after:2026-09-01`) start at midnight in this zone. */
	timeZone?: string;
};
