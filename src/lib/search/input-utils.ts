/**
 * Whether a query is ready to run while the user is still typing: quotes, parentheses and braces balanced, and
 * nothing left dangling (`from:`, a trailing `OR`/`AND`, a lone minus). An unsettled query runs on Enter, where
 * the parser degrades gracefully, so half-typed groups do not flash unrelated results.
 */
export function isSearchQuerySettled(raw: string): boolean {
	const text = raw.trim();
	if (!text) return true;
	let depth = 0;
	let quoted = false;
	for (const char of text) {
		if (char === '"') quoted = !quoted;
		else if (quoted) continue;
		else if (char === "(" || char === "{") depth += 1;
		else if (char === ")" || char === "}") depth -= 1;
		if (depth < 0) return false;
	}
	if (quoted || depth !== 0) return false;
	return !/(^|\s)(OR|AND|-)$/.test(text) && !/(^|[\s({-])[A-Za-z_]+:$/.test(text);
}

/** The query with an operator from the cheat sheet appended after one space. */
export function appendSearchOperator(query: string, operator: string): string {
	const base = query.trimEnd();
	return base ? `${base} ${operator}` : operator;
}
