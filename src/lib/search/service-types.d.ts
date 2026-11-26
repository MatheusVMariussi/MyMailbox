import type { SQL } from "drizzle-orm";
import type { SearchFolder } from "./types";

export type SearchFilterRequest = {
	/** The `q` parameter, whole. */
	query?: string | null;
	/** The legacy `title` parameter: a subject phrase ANDed with the query. */
	subject?: string | null;
	/** Calendar dates in the query start at midnight in this zone. */
	timeZone: string;
	now?: Date;
};

export type SearchFilterScope = {
	/** The mailboxes searched; `label:` matches the labels of these. */
	mailboxIds: readonly string[];
	/** Whose projects `project:` names. */
	userId: string;
};

export type SearchFilter = {
	/** Null when nothing searchable is left (an empty query, or only punctuation). */
	condition: SQL | null;
	/** The folders the query names with `in:`, which lift the default Spam and Trash exclusion. */
	folders: Set<SearchFolder>;
};
