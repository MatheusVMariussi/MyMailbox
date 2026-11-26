import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { projects } from "@/db/schema";
import { D1_MAX_BOUND_PARAMETERS } from "@/lib/db-params";
import { listLabels } from "@/lib/labels/service";
import { compileSearchTree, SEARCH_PARAM_BUDGET, SearchQueryError, type SearchCompileContext } from "./conditions";
import { andSearchNodes, collectSearchNodes, normalizeSearchName, parseSearch, searchFolderNames } from "./parser-utils";
import type { SearchFilter, SearchFilterRequest, SearchFilterScope } from "./service-types";

/**
 * Parameters a list statement binds besides the mailbox scope and the search: the draft filter, project, folder
 * and read filters, pagination, and room for one id when a page is re-read in batches.
 */
const ROUTE_RESERVED_PARAMS = 12;

/**
 * What a search may bind for this scope: `SEARCH_PARAM_BUDGET`, less when the mailbox list (one parameter per
 * mailbox) leaves less room under D1's 100, and never below one so a plain text search always runs.
 */
export function searchBudgetFor(mailboxCount: number): number {
	return Math.max(1, Math.min(SEARCH_PARAM_BUDGET, D1_MAX_BOUND_PARAMETERS - ROUTE_RESERVED_PARAMS - mailboxCount));
}

/** Ids per normalized name, for the names the query asks about only. */
function indexByName(rows: ReadonlyArray<{ id: string; name: string }>, wanted: ReadonlySet<string>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const row of rows) {
		const name = normalizeSearchName(row.name);
		if (!wanted.has(name)) continue;
		index.set(name, [...(index.get(name) ?? []), row.id]);
	}
	return index;
}

/**
 * Parse and compile a search for one request. `label:` resolves against the labels of every searched mailbox
 * (same-named labels of different mailboxes all match) and `project:` against the user's own projects; the
 * legacy `title` parameter joins as a subject phrase. Throws `SearchQueryError` (a 400 for the routes) when the
 * query was cut at a cap or needs more parameters than `SEARCH_PARAM_BUDGET`.
 */
export async function buildSearchFilter(db: AppDatabase, request: SearchFilterRequest, scope: SearchFilterScope): Promise<SearchFilter> {
	const parsed = parseSearch(request.query, { timeZone: request.timeZone });
	if (parsed.limited) throw new SearchQueryError("This search is too long; shorten it and try again", "limited");
	const subject = request.subject?.trim();
	const root = andSearchNodes(parsed.root, subject ? { kind: "term", field: "subject", value: subject, phrase: true } : null);

	const context: SearchCompileContext = { now: request.now ?? new Date() };
	const labelNames = new Set(collectSearchNodes(root, "label").map((node) => node.value));
	const projectNames = new Set(collectSearchNodes(root, "project").map((node) => node.value));
	const [labelRows, projectRows] = await Promise.all([
		labelNames.size > 0 && scope.mailboxIds.length > 0 ? listLabels(db, scope.mailboxIds) : [],
		projectNames.size > 0 ? db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.userId, scope.userId)) : [],
	]);
	if (labelNames.size > 0) context.labelIds = indexByName(labelRows, labelNames);
	if (projectNames.size > 0) context.projectIds = indexByName(projectRows, projectNames);

	const { condition } = compileSearchTree(root, context, searchBudgetFor(scope.mailboxIds.length));
	return { condition, folders: searchFolderNames(root) };
}
