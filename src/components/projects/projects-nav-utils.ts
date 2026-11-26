/** Folder routes whose lists a project filter narrows. */
const LIST_ROOTS = ["/inbox", "/promotions", "/starred", "/snoozed", "/sent", "/scheduled", "/drafts", "/archived", "/spam", "/trash"];

/**
 * Where to show a list after the project filter changes: the list itself when one is open (a reader route
 * goes back to its list, since the open message may not be in the new filter), otherwise the Inbox.
 */
export function listRootFor(pathname: string): string {
	const path = pathname.replace(/\/+$/, "") || "/";
	const label = /^\/labels\/[^/]+/.exec(path);
	if (label) return label[0];
	const root = LIST_ROOTS.find((candidate) => path === candidate || path.startsWith(`${candidate}/`));
	return root ?? "/inbox";
}
