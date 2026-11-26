import { and, eq, exists, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { messageAttachments, messages } from "@/db/schema";
import { hasLabelCondition } from "@/lib/labels/service";
import { combineFtsParts, ftsPartFor, pruneSearchTree, type FtsPart } from "./fts-utils";
import { parseSearch, searchAgeCutoff } from "./parser-utils";
import type { SearchFolder, SearchNode } from "./types";

/**
 * Most bound parameters one search may add to a statement. The list routes add their own (the mailbox scope,
 * the draft filter, pagination) and D1 refuses more than 100 per statement, so a query past this is refused
 * with `SearchQueryError` rather than failing in D1.
 */
export const SEARCH_PARAM_BUDGET = 40;

export class SearchQueryError extends Error {
	constructor(
		message: string,
		readonly code: "limited" | "budget",
	) {
		super(message);
		this.name = "SearchQueryError";
	}
}

export type SearchCompileContext = {
	/** Relative dates (`newer_than:`) and the snooze state are measured from here. */
	now: Date;
	/** Label ids per normalized name the query names: same-named labels of every searched mailbox. */
	labelIds?: ReadonlyMap<string, readonly string[]>;
	/** The user's project ids per normalized project name. */
	projectIds?: ReadonlyMap<string, readonly string[]>;
};

/** A compiled condition and the parameters it binds, so the total can be checked before it reaches D1. */
export type CompiledSearch = { condition: SQL | null; params: number };

type Part = { sql: SQL; params: number };
const MATCH_ALL: Part = { sql: sql`1`, params: 0 };
const MATCH_NONE: Part = { sql: sql`0`, params: 0 };

function ftsCondition(part: FtsPart): Part {
	const match = sql`(SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${part.expression})`;
	return { sql: part.negated ? sql`${messages}.rowid NOT IN ${match}` : sql`${messages}.rowid IN ${match}`, params: 1 };
}

/** Received and snoozed past `now`: the Snoozed folder. */
function snoozedCondition(now: Date): Part {
	return { sql: and(sql`${messages.status} = 'received'`, gt(messages.snoozedUntil, now))!, params: 1 };
}

/** The predicates of the web folders (`messageMatchesFolder`); fixed values are literal SQL. */
function folderCondition(folder: SearchFolder, now: Date): Part {
	switch (folder) {
		case "inbox":
			// Promotions included: `in:inbox` means received mail that is not snoozed, whatever its category.
			return {
				sql: and(sql`${messages.direction} = 'inbound'`, sql`${messages.status} = 'received'`, or(isNull(messages.snoozedUntil), lte(messages.snoozedUntil, now)))!,
				params: 1,
			};
		case "snoozed":
			return snoozedCondition(now);
		case "sent":
			return { sql: sql`${messages.status} = 'sent'`, params: 0 };
		case "drafts":
			return { sql: sql`${messages.status} = 'draft'`, params: 0 };
		case "spam":
			return { sql: sql`${messages.status} = 'spam'`, params: 0 };
		case "trash":
			return { sql: sql`${messages.status} = 'trash'`, params: 0 };
		case "archive":
			return { sql: sql`${messages.status} = 'archived'`, params: 0 };
		case "anywhere":
			return MATCH_ALL;
	}
}

function idsCondition(column: typeof messages.projectId, ids: readonly string[]): Part {
	if (ids.length === 0) return MATCH_NONE;
	if (ids.length === 1) return { sql: eq(column, ids[0]), params: 1 };
	// One JSON parameter however many ids, as `hasLabelCondition` does.
	return { sql: sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`, params: 1 };
}

function compileLeaf(node: SearchNode, context: SearchCompileContext): Part {
	switch (node.kind) {
		case "has":
			return {
				sql: exists(sql`(SELECT 1 FROM ${messageAttachments} WHERE ${messageAttachments.messageId} = ${messages.id} AND ${messageAttachments.disposition} = 'attachment')`),
				params: 0,
			};
		case "filename":
			// Any attachment, inline ones too; `instr` rather than LIKE so `%` and `_` are plain characters.
			return {
				sql: exists(sql`(SELECT 1 FROM ${messageAttachments} WHERE ${messageAttachments.messageId} = ${messages.id} AND instr(lower(${messageAttachments.filename}), ${node.value}) > 0)`),
				params: 1,
			};
		case "is":
			if (node.value === "unread") return { sql: sql`${messages.read} = 0`, params: 0 };
			if (node.value === "read") return { sql: sql`${messages.read} = 1`, params: 0 };
			if (node.value === "starred") return { sql: sql`${messages.starred} = 1`, params: 0 };
			return snoozedCondition(context.now);
		case "in":
			return folderCondition(node.value, context.now);
		case "label": {
			const ids = context.labelIds?.get(node.value) ?? [];
			return ids.length ? { sql: hasLabelCondition(ids), params: 1 } : MATCH_NONE;
		}
		case "project":
			return idsCondition(messages.projectId, context.projectIds?.get(node.value) ?? []);
		case "deliveredto":
			// A whole address matches exactly; a domain or fragment (`@acme.test`, `sales`) anywhere in it.
			return node.value.includes("@") && !node.value.startsWith("@")
				? { sql: eq(messages.deliveredTo, node.value), params: 1 }
				: { sql: sql`instr(${messages.deliveredTo}, ${node.value}) > 0`, params: 1 };
		case "category":
			// `primary` is anything but promotions, null included.
			return node.value === "promotions"
				? { sql: sql`${messages.category} = 'promotions'`, params: 0 }
				: { sql: sql`(${messages.category} = 'promotions') IS NOT TRUE`, params: 0 };
		case "date":
			return { sql: node.bound === "after" ? gte(messages.createdAt, node.at) : lt(messages.createdAt, node.at), params: 1 };
		case "age": {
			const cutoff = searchAgeCutoff(context.now, node.amount, node.unit);
			return { sql: node.bound === "newer" ? gte(messages.createdAt, cutoff) : lt(messages.createdAt, cutoff), params: 1 };
		}
		case "size":
			// A size of 0 is unknown (mail stored before sizes were recorded), never "smaller".
			return node.bound === "larger"
				? { sql: gte(messages.sizeBytes, node.bytes), params: 1 }
				: { sql: and(sql`${messages.sizeBytes} > 0`, lt(messages.sizeBytes, node.bytes))!, params: 1 };
		default:
			throw new Error(`Unexpected search node ${node.kind}`);
	}
}

/**
 * A pruned tree as SQL. A subtree made only of text and field terms is one MATCH (one parameter); in a mixed
 * AND or OR the text children share one MATCH and the rest combine in SQL. Negated predicates are NULL-safe
 * (`… IS NOT TRUE`), so `-category:promotions` or `-label:x` keeps rows whose column is null.
 */
function compileNode(node: SearchNode, context: SearchCompileContext): Part {
	const text = ftsPartFor(node);
	if (text) return ftsCondition(text);
	if (node.kind === "and" || node.kind === "or") {
		const textParts: FtsPart[] = [];
		const parts: Part[] = [];
		for (const child of node.children) {
			const childText = ftsPartFor(child);
			if (childText) textParts.push(childText);
			else parts.push(compileNode(child, context));
		}
		const combined = combineFtsParts(node.kind, textParts);
		if (combined) parts.unshift(ftsCondition(combined));
		const sqls = parts.map((part) => part.sql);
		return { sql: (node.kind === "and" ? and(...sqls) : or(...sqls))!, params: parts.reduce((total, part) => total + part.params, 0) };
	}
	if (node.kind === "not") {
		const inner = compileNode(node.child, context);
		return { sql: sql`(${inner.sql}) IS NOT TRUE`, params: inner.params };
	}
	return compileLeaf(node, context);
}

/** Compile a parsed tree; throws `SearchQueryError` past `budget` parameters (`SEARCH_PARAM_BUDGET` by default). */
export function compileSearchTree(root: SearchNode | null, context: SearchCompileContext, budget = SEARCH_PARAM_BUDGET): CompiledSearch {
	const pruned = pruneSearchTree(root);
	if (!pruned) return { condition: null, params: 0 };
	const compiled = compileNode(pruned, context);
	if (compiled.params > budget) {
		throw new SearchQueryError(`This search is too complex (it needs ${compiled.params} values, at most ${budget}); remove some operators`, "budget");
	}
	return { condition: compiled.sql, params: compiled.params };
}

/**
 * What a search outside a folder leaves out: Spam and Trash, as in Gmail, unless the query names them
 * (`in:spam`, `in:trash`) or `in:anywhere`. Literal SQL: the statuses are fixed values.
 */
export function searchScopeExclusion(folders: ReadonlySet<SearchFolder>): SQL | null {
	if (folders.has("anywhere")) return null;
	const spam = !folders.has("spam");
	const trash = !folders.has("trash");
	if (spam && trash) return sql`${messages.status} NOT IN ('spam', 'trash')`;
	if (spam) return sql`${messages.status} <> 'spam'`;
	if (trash) return sql`${messages.status} <> 'trash'`;
	return null;
}

/**
 * Translate a search string into WHERE conditions on `messages`, for callers that need no label or project
 * names resolved (those match nothing without `labelIds`/`projectIds`); routes use `buildSearchFilter`.
 */
export function buildSearchConditions(raw: string, options: string | (Partial<SearchCompileContext> & { timeZone?: string }) = {}): SQL[] {
	const settings = typeof options === "string" ? { timeZone: options } : options;
	const { root } = parseSearch(raw, { timeZone: settings.timeZone });
	const { condition } = compileSearchTree(root, { ...settings, now: settings.now ?? new Date() });
	return condition ? [condition] : [];
}
