import type { SearchAgeUnit, SearchField, SearchFolder, SearchNode, SearchParseOptions, SearchQuery } from "./types";
import { dateFromZonedFields, normalizeTimeZone } from "@/lib/time/utils";

/**
 * Gmail-style search grammar, shared by the session list, reader navigation and `/api/v1/messages`:
 *
 *   query  := and
 *   and    := or ( "AND"? or )*
 *   or     := unary ( "OR" unary )*
 *   unary  := "-" unary | atom
 *   atom   := "(" query ")" | "{" or-list "}" | KEY ":" value | phrase | word
 *   value  := phrase | word | "(" query ")"   (the key applies to every bare term inside)
 *
 * As in Gmail, OR binds tighter than the implicit AND (`a b OR c` is `a AND (b OR c)`), `OR` and `AND` are
 * keywords only in upper case, and `{a b}` is an OR group. An unknown key, or a known key with a value it does
 * not understand, stays free text: nothing is ever silently dropped, which would widen the results.
 *
 * Parsing is total: unbalanced quotes, parentheses or braces, a trailing or leading OR and a lone minus all
 * degrade to the nearest sensible query, and the length, leaf count and nesting depth are capped.
 */

/** Longest query parsed; a longer one is cut there and flagged `limited`. */
export const SEARCH_MAX_QUERY_LENGTH = 1000;
/** Most leaves (words, phrases, operators) one query may hold; the rest are dropped and the query flagged `limited`. */
export const SEARCH_MAX_LEAVES = 60;
/** Deepest bracket nesting honoured; brackets nested deeper are ignored, so their terms join the enclosing group. */
export const SEARCH_MAX_DEPTH = 6;

const FIELD_KEYS: Readonly<Record<string, SearchField>> = { from: "from", to: "to", cc: "cc", bcc: "bcc", subject: "subject", title: "subject" };
const IS_VALUES: Readonly<Record<string, "unread" | "read" | "starred" | "snoozed">> = { unread: "unread", read: "read", starred: "starred", snoozed: "snoozed" };
const IN_VALUES: Readonly<Record<string, SearchFolder>> = {
	inbox: "inbox",
	sent: "sent",
	draft: "drafts",
	drafts: "drafts",
	spam: "spam",
	trash: "trash",
	archive: "archive",
	archived: "archive",
	snoozed: "snoozed",
	anywhere: "anywhere",
};
const KNOWN_KEYS = new Set([
	...Object.keys(FIELD_KEYS),
	"has", "filename", "is", "in", "label", "project", "deliveredto", "category",
	"after", "before", "newer", "older", "newer_than", "older_than", "larger", "smaller", "size",
]);
const SIZE_UNITS: Readonly<Record<string, number>> = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
/** Characters that end a bare word: they open or close a group or a phrase. */
const DELIMITERS = new Set(["(", ")", "{", "}", '"']);

/** A label or project name as `label:`/`project:` compare it: lower-cased, with runs of spaces, hyphens and slashes as one space. */
export function normalizeSearchName(value: string): string {
	return value.normalize("NFC").toLowerCase().replace(/[\s/-]+/g, " ").trim();
}

function isSpace(char: string | undefined): boolean {
	return char !== undefined && /\s/.test(char);
}

function makeAnd(items: SearchNode[]): SearchNode | null {
	const children = items.flatMap((item) => (item.kind === "and" ? item.children : [item]));
	if (children.length === 0) return null;
	return children.length === 1 ? children[0] : { kind: "and", children };
}

function makeOr(items: SearchNode[]): SearchNode | null {
	const children = items.flatMap((item) => (item.kind === "or" ? item.children : [item]));
	if (children.length === 0) return null;
	return children.length === 1 ? children[0] : { kind: "or", children };
}

function makeNot(child: SearchNode): SearchNode {
	return child.kind === "not" ? child.child : { kind: "not", child };
}

/** `YYYY-MM-DD` / `YYYY/MM/DD` at midnight in `timeZone`, or epoch seconds; undefined when not a real date. */
function parseDate(value: string, timeZone: string): Date | undefined {
	if (/^\d{9,11}$/.test(value)) return new Date(Number(value) * 1000);
	const match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
	if (!match) return undefined;
	const date = new Date(0);
	date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return undefined;
	return dateFromZonedFields(date, normalizeTimeZone(timeZone));
}

/** `500`, `10K`, `1.5MB`, `2G`: bytes, 1024-based; undefined when not a size. */
function parseSize(value: string): number | undefined {
	const match = value.match(/^(\d{1,12}(?:\.\d{1,6})?)([kmg]?)b?$/i);
	if (!match) return undefined;
	const bytes = Math.round(Number(match[1]) * SIZE_UNITS[match[2].toLowerCase()]);
	return Number.isSafeInteger(bytes) ? bytes : undefined;
}

class SearchParser {
	private pos = 0;
	private leaves = 0;
	limited = false;

	constructor(
		private readonly input: string,
		private readonly timeZone: string,
	) {}

	parse(): SearchNode | null {
		return this.parseSequence(0, null, null, "and");
	}

	private skipSpace(): void {
		while (isSpace(this.input[this.pos])) this.pos += 1;
	}

	/** Whether an upper-case keyword (`OR`, `AND`) starts here as a whole token. */
	private atKeyword(word: "OR" | "AND"): boolean {
		if (!this.input.startsWith(word, this.pos)) return false;
		const after = this.input[this.pos + word.length];
		return after === undefined || isSpace(after) || DELIMITERS.has(after);
	}

	private atCloser(): boolean {
		const char = this.input[this.pos];
		return char === undefined || char === ")" || char === "}";
	}

	/**
	 * Items up to `closer` (or the end), ANDed, or ORed inside braces. A closer that does not belong to this
	 * group is a stray and skipped, as are leading or doubled connectives.
	 */
	private parseSequence(depth: number, closer: ")" | "}" | null, key: string | null, mode: "and" | "or"): SearchNode | null {
		const items: SearchNode[] = [];
		for (;;) {
			this.skipSpace();
			const char = this.input[this.pos];
			if (char === undefined || char === closer) break;
			if (char === ")" || char === "}") {
				this.pos += 1;
				continue;
			}
			if (this.atKeyword("AND") || this.atKeyword("OR")) {
				this.pos += this.atKeyword("AND") ? 3 : 2;
				continue;
			}
			const node = this.parseOr(depth, key);
			if (node) items.push(node);
		}
		return mode === "or" ? makeOr(items) : makeAnd(items);
	}

	private parseOr(depth: number, key: string | null): SearchNode | null {
		const children: SearchNode[] = [];
		const first = this.parseUnary(depth, key);
		if (first) children.push(first);
		for (;;) {
			const save = this.pos;
			this.skipSpace();
			if (!this.atKeyword("OR")) {
				this.pos = save;
				break;
			}
			this.pos += 2;
			this.skipSpace();
			// A trailing OR ends the group; `a OR OR b` reads as `a OR b`.
			if (this.atCloser()) break;
			if (this.atKeyword("OR")) continue;
			if (this.atKeyword("AND")) break;
			const next = this.parseUnary(depth, key);
			if (next) children.push(next);
		}
		return makeOr(children);
	}

	private parseUnary(depth: number, key: string | null): SearchNode | null {
		this.skipSpace();
		if (this.input[this.pos] === "-") {
			this.pos += 1;
			const next = this.input[this.pos];
			// A lone minus negates nothing.
			if (next === undefined || isSpace(next) || next === ")" || next === "}") return null;
			const child = this.parseUnary(depth, key);
			return child ? makeNot(child) : null;
		}
		return this.parseAtom(depth, key);
	}

	private parseAtom(depth: number, key: string | null): SearchNode | null {
		const char = this.input[this.pos];
		if (char === "(" || char === "{") {
			this.pos += 1;
			// Too deep: the bracket is ignored and its terms join the enclosing group.
			if (depth >= SEARCH_MAX_DEPTH) return null;
			const closer = char === "(" ? ")" : "}";
			const node = this.parseSequence(depth + 1, closer, key, char === "(" ? "and" : "or");
			if (this.input[this.pos] === closer) this.pos += 1;
			return node;
		}
		if (char === '"') {
			const phrase = this.readPhrase();
			return key ? this.operator(key, phrase, true, `${key}:"${phrase}"`) : this.term(null, phrase, true);
		}
		const word = this.readWord();
		if (!word) {
			this.pos += 1;
			return null;
		}
		return this.wordNode(word, depth, key);
	}

	private readWord(): string {
		const start = this.pos;
		while (this.pos < this.input.length && !isSpace(this.input[this.pos]) && !DELIMITERS.has(this.input[this.pos])) this.pos += 1;
		return this.input.slice(start, this.pos);
	}

	/** A quoted phrase; an unterminated one runs to the end of the query. */
	private readPhrase(): string {
		this.pos += 1;
		const end = this.input.indexOf('"', this.pos);
		const phrase = this.input.slice(this.pos, end === -1 ? this.input.length : end);
		this.pos = end === -1 ? this.input.length : end + 1;
		return phrase;
	}

	private wordNode(word: string, depth: number, key: string | null): SearchNode | null {
		const legacy = /^:(un)?read$/i.exec(word);
		if (legacy) return this.leaf({ kind: "is", value: legacy[1] ? "unread" : "read" });
		const match = /^([A-Za-z_]+):([\s\S]*)$/.exec(word);
		const operatorKey = match?.[1].toLowerCase();
		if (match && operatorKey && KNOWN_KEYS.has(operatorKey)) {
			if (match[2]) return this.operator(operatorKey, match[2], false, word);
			const next = this.input[this.pos];
			if (next === '"') {
				const phrase = this.readPhrase();
				return this.operator(operatorKey, phrase, true, `${word}"${phrase}"`);
			}
			if (next === "(" && depth < SEARCH_MAX_DEPTH) {
				this.pos += 1;
				const node = this.parseSequence(depth + 1, ")", operatorKey, "and");
				if (this.input[this.pos] === ")") this.pos += 1;
				return node;
			}
			// `from:` with nothing after it is text, never a dropped filter.
			return this.term(null, word, false);
		}
		return key ? this.operator(key, word, false, `${key}:${word}`) : this.term(null, word, false);
	}

	private leaf(node: SearchNode): SearchNode | null {
		if (this.leaves >= SEARCH_MAX_LEAVES) {
			this.limited = true;
			return null;
		}
		this.leaves += 1;
		return node;
	}

	private term(field: SearchField | null, value: string, phrase: boolean): SearchNode | null {
		if (!value.trim()) return null;
		return this.leaf({ kind: "term", field, value, phrase });
	}

	/** `key:value`, or the raw text when the value means nothing to the key. */
	private operator(key: string, value: string, quoted: boolean, raw: string): SearchNode | null {
		const node = this.operatorNode(key, value, quoted);
		if (node === "empty") return null;
		return node ? this.leaf(node) : this.term(null, raw, false);
	}

	private operatorNode(key: string, value: string, quoted: boolean): SearchNode | "empty" | null {
		const field = FIELD_KEYS[key];
		if (field) return value.trim() ? { kind: "term", field, value, phrase: quoted } : "empty";
		const lower = value.trim().toLowerCase();
		switch (key) {
			case "has":
				return /^attachments?$/.test(lower) ? { kind: "has", value: "attachment" } : null;
			case "filename":
				return lower ? { kind: "filename", value: lower } : "empty";
			case "is":
				return IS_VALUES[lower] ? { kind: "is", value: IS_VALUES[lower] } : null;
			case "in":
				return IN_VALUES[lower] ? { kind: "in", value: IN_VALUES[lower] } : null;
			case "label":
			case "project": {
				const name = normalizeSearchName(value);
				return name ? { kind: key === "label" ? "label" : "project", value: name } : "empty";
			}
			case "deliveredto":
				return lower ? { kind: "deliveredto", value: lower } : "empty";
			case "category":
				if (/^promotions?$/.test(lower)) return { kind: "category", value: "promotions" };
				if (/^(primary|inbox)$/.test(lower)) return { kind: "category", value: "primary" };
				return null;
			case "after":
			case "newer":
			case "before":
			case "older": {
				const at = parseDate(lower, this.timeZone);
				return at ? { kind: "date", bound: key === "after" || key === "newer" ? "after" : "before", at } : null;
			}
			case "newer_than":
			case "older_than": {
				const age = /^(\d{1,4})([dwmy])$/.exec(lower);
				return age ? { kind: "age", bound: key === "newer_than" ? "newer" : "older", amount: Number(age[1]), unit: age[2] as SearchAgeUnit } : null;
			}
			case "larger":
			case "smaller":
			case "size": {
				const bytes = parseSize(lower);
				return bytes === undefined ? null : { kind: "size", bound: key === "smaller" ? "smaller" : "larger", bytes };
			}
			default:
				return null;
		}
	}
}

/** Parse a search string into a tree (see the grammar above). Never throws. */
export function parseSearch(raw: string | null | undefined, options: SearchParseOptions = {}): SearchQuery {
	const text = typeof raw === "string" ? raw : "";
	const input = text.length > SEARCH_MAX_QUERY_LENGTH ? text.slice(0, SEARCH_MAX_QUERY_LENGTH) : text;
	const parser = new SearchParser(input, options.timeZone ?? "UTC");
	const root = parser.parse();
	return { root, limited: parser.limited || input.length < text.length };
}

/** `now` minus `amount` days, weeks, calendar months or years (UTC), for `newer_than:`/`older_than:`. */
export function searchAgeCutoff(now: Date, amount: number, unit: SearchAgeUnit): Date {
	const cutoff = new Date(now.getTime());
	if (unit === "d") cutoff.setUTCDate(cutoff.getUTCDate() - amount);
	else if (unit === "w") cutoff.setUTCDate(cutoff.getUTCDate() - amount * 7);
	else if (unit === "m") cutoff.setUTCMonth(cutoff.getUTCMonth() - amount);
	else cutoff.setUTCFullYear(cutoff.getUTCFullYear() - amount);
	return cutoff;
}

/** Every node of one kind, wherever it appears. */
export function collectSearchNodes<Kind extends SearchNode["kind"]>(root: SearchNode | null, kind: Kind): Extract<SearchNode, { kind: Kind }>[] {
	const found: Extract<SearchNode, { kind: Kind }>[] = [];
	const visit = (node: SearchNode) => {
		if (node.kind === kind) found.push(node as Extract<SearchNode, { kind: Kind }>);
		if (node.kind === "and" || node.kind === "or") node.children.forEach(visit);
		else if (node.kind === "not") visit(node.child);
	};
	if (root) visit(root);
	return found;
}

/** Every `in:` value the query names, wherever it appears (negated or not). */
export function searchFolderNames(root: SearchNode | null): Set<SearchFolder> {
	return new Set(collectSearchNodes(root, "in").map((node) => node.value));
}

/** `a AND b`, flattening nested ANDs; null when both are absent. */
export function andSearchNodes(...nodes: Array<SearchNode | null>): SearchNode | null {
	return makeAnd(nodes.filter((node): node is SearchNode => node !== null));
}
