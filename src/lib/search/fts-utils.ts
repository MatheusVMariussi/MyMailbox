import type { SearchField, SearchNode } from "./types";

/**
 * One MATCH against `messages_fts`: rows matching `expression`, or, when `negated`, rows not matching it. FTS5
 * has no unary NOT (`NOT "x"` and `"a" OR (NOT "b")` are syntax errors), so a negation is carried outward
 * until a positive sibling can take it as binary NOT, or the caller selects `rowid NOT IN (… MATCH …)`.
 */
export type FtsPart = { expression: string; negated: boolean };

type TermNode = Extract<SearchNode, { kind: "term" }>;

const FTS_COLUMNS: Readonly<Record<SearchField, string>> = {
	from: "from_addr",
	to: "{to_addr cc_addr}",
	cc: "cc_addr",
	bcc: "bcc_addr",
	subject: "subject",
};

/** FTS5 string literal: double quotes doubled, so user input can never alter the query grammar. */
export function ftsString(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

/**
 * One term. Phrases match whole words; plain terms match by prefix so "inv" finds "invoice". Punctuation FTS5
 * treats as separators is normalised to spaces first, so "maya@acme.test" becomes the phrase "maya acme test".
 * Empty when nothing indexable is left.
 */
export function ftsTerm(term: string, phrase: boolean): string {
	const cleaned = term.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
	if (!cleaned) return "";
	if (phrase || cleaned.includes(" ")) {
		// A multi-word prefix query needs the last word starred, which FTS5 only
		// allows inside a phrase as `"a b" *`; keep it simple and require whole words.
		return ftsString(cleaned);
	}
	return `${ftsString(cleaned)}*`;
}

function ftsLeaf(node: TermNode): string {
	const term = ftsTerm(node.value, node.phrase);
	if (!term || !node.field) return term;
	return `${FTS_COLUMNS[node.field]} : (${term})`;
}

/**
 * The tree without terms that hold nothing indexable (`!!!`, `from:@`): FTS5 cannot search for them, so they
 * are left out instead of failing the MATCH. Groups and negations left empty disappear with them.
 */
export function pruneSearchTree(node: SearchNode | null): SearchNode | null {
	if (!node) return null;
	switch (node.kind) {
		case "term":
			return ftsLeaf(node) ? node : null;
		case "not": {
			const child = pruneSearchTree(node.child);
			return child ? { kind: "not", child } : null;
		}
		case "and":
		case "or": {
			const children = node.children.map(pruneSearchTree).filter((child): child is SearchNode => child !== null);
			if (children.length === 0) return null;
			return children.length === 1 ? children[0] : { kind: node.kind, children };
		}
		default:
			return node;
	}
}

/**
 * Text parts of one AND (or OR) as a single MATCH:
 *   AND: P1 ∧ P2 ∧ ¬N1 ∧ ¬N2 = (P1 AND P2) NOT (N1 OR N2), or ¬(N1 OR N2) without a positive;
 *   OR:  P1 ∨ P2 ∨ ¬N1 ∨ ¬N2 = ¬((N1 AND N2) NOT (P1 OR P2)), or P1 OR P2 without a negative.
 */
export function combineFtsParts(mode: "and" | "or", parts: readonly FtsPart[]): FtsPart | null {
	if (parts.length === 0) return null;
	if (parts.length === 1) return parts[0];
	const positives = parts.filter((part) => !part.negated).map((part) => `(${part.expression})`);
	const negatives = parts.filter((part) => part.negated).map((part) => `(${part.expression})`);
	if (mode === "and") {
		if (positives.length === 0) return { expression: negatives.join(" OR "), negated: true };
		const base = positives.join(" AND ");
		return { expression: negatives.length ? `(${base}) NOT (${negatives.join(" OR ")})` : base, negated: false };
	}
	if (negatives.length === 0) return { expression: positives.join(" OR "), negated: false };
	const base = negatives.join(" AND ");
	return { expression: positives.length ? `(${base}) NOT (${positives.join(" OR ")})` : base, negated: true };
}

/** A pruned subtree made only of text and field terms as one MATCH; null when any leaf is a column predicate. */
export function ftsPartFor(node: SearchNode): FtsPart | null {
	switch (node.kind) {
		case "term": {
			const expression = ftsLeaf(node);
			return expression ? { expression, negated: false } : null;
		}
		case "not": {
			const inner = ftsPartFor(node.child);
			return inner ? { expression: inner.expression, negated: !inner.negated } : null;
		}
		case "and":
		case "or": {
			const parts: FtsPart[] = [];
			for (const child of node.children) {
				const part = ftsPartFor(child);
				if (!part) return null;
				parts.push(part);
			}
			return combineFtsParts(node.kind, parts);
		}
		default:
			return null;
	}
}
