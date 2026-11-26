import type { ParsedSearchQuery, SearchNode } from "./types";
import { parseSearch } from "./parser-utils";

function serializeTerm(node: Extract<SearchNode, { kind: "term" }>): string {
	return node.phrase ? `"${node.value}"` : node.value;
}

/**
 * The older flat shape of a search: the operators of its top-level AND, with free text (and negated free
 * text) kept as a string. Anything inside OR, a group or a negated operator is not projected; the search
 * itself always runs on the full tree (`parseSearch`), so this only serves callers that read one flag.
 */
export function parseSearchQuery(raw: string, timeZone = "UTC"): ParsedSearchQuery {
	const parsed: ParsedSearchQuery = { text: "", needsFullText: false };
	const { root } = parseSearch(raw, { timeZone });
	const items = !root ? [] : root.kind === "and" ? root.children : [root];
	const text: string[] = [];

	for (const node of items) {
		switch (node.kind) {
			case "term":
				if (!node.field) text.push(serializeTerm(node));
				else if (node.field === "from") parsed.from = node.value;
				else if (node.field === "to") parsed.to = node.value;
				else if (node.field === "subject") parsed.subject = node.value;
				break;
			case "not":
				if (node.child.kind === "term" && !node.child.field) text.push(`-${serializeTerm(node.child)}`);
				break;
			case "has":
				parsed.hasAttachment = true;
				break;
			case "is":
				if (node.value === "read" || node.value === "unread") parsed.read = node.value;
				else if (node.value === "starred") parsed.starred = true;
				break;
			case "category":
				parsed.category = node.value;
				break;
			case "date":
				parsed[node.bound] = node.at;
				break;
		}
	}

	parsed.text = text.join(" ");
	parsed.needsFullText = !!(parsed.text || parsed.from || parsed.to || parsed.subject);
	return parsed;
}
