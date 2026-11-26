import type { ListScope } from "./list-scope-types";

/** Where the list scope is kept; separate from the mailbox selection that settings and compose use. */
export const LIST_SCOPE_STORAGE_KEY = "mymailbox:list-scope";
/** Fired in this tab after the list scope changes (other tabs see the storage event). */
export const LIST_SCOPE_CHANGED_EVENT = "mymailbox:list-scope-changed";

/** The default: the unified inbox of every accessible mailbox, no project filter. */
export const UNIFIED_LIST_SCOPE: ListScope = { mailboxId: null, projectId: null };

/** A stored scope, or the default when it is missing or malformed. */
export function parseListScope(raw: string | null | undefined): ListScope {
	if (!raw) return UNIFIED_LIST_SCOPE;
	try {
		const value = JSON.parse(raw) as Partial<ListScope> | null;
		const mailboxId = typeof value?.mailboxId === "string" && value.mailboxId ? value.mailboxId : null;
		const projectId = typeof value?.projectId === "string" && value.projectId ? value.projectId : null;
		return mailboxId || projectId ? { mailboxId, projectId } : UNIFIED_LIST_SCOPE;
	} catch {
		return UNIFIED_LIST_SCOPE;
	}
}

/**
 * The scope the lists use: a mailbox the user no longer has falls back to every mailbox, and a project they no
 * longer have to no filter. Lists that are still loading (null) are trusted until they arrive.
 */
export function resolveListScope(scope: ListScope, mailboxIds: readonly string[] | null, projectIds: readonly string[] | null): ListScope {
	const mailboxId = scope.mailboxId && (!mailboxIds || mailboxIds.includes(scope.mailboxId)) ? scope.mailboxId : null;
	const projectId = scope.projectId && (!projectIds || projectIds.includes(scope.projectId)) ? scope.projectId : null;
	return mailboxId === scope.mailboxId && projectId === scope.projectId ? scope : { mailboxId, projectId };
}

/** A stable string for cache and reset keys. */
export function listScopeKey(scope: ListScope): string {
	return `${scope.mailboxId ?? "all"}\u0000${scope.projectId ?? ""}`;
}

export function readStoredListScope(): string | null {
	try {
		return localStorage.getItem(LIST_SCOPE_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function writeStoredListScope(scope: ListScope): void {
	try {
		if (!scope.mailboxId && !scope.projectId) localStorage.removeItem(LIST_SCOPE_STORAGE_KEY);
		else localStorage.setItem(LIST_SCOPE_STORAGE_KEY, JSON.stringify(scope));
	} catch {
		// Storage can be unavailable (private windows); the scope then lasts for this page only.
	}
	window.dispatchEvent(new window.Event(LIST_SCOPE_CHANGED_EVENT));
}

export function subscribeStoredListScope(onChange: () => void): () => void {
	const onStorage = (event: StorageEvent) => {
		if (event.key === null || event.key === LIST_SCOPE_STORAGE_KEY) onChange();
	};
	window.addEventListener("storage", onStorage);
	window.addEventListener(LIST_SCOPE_CHANGED_EVENT, onChange);
	return () => {
		window.removeEventListener("storage", onStorage);
		window.removeEventListener(LIST_SCOPE_CHANGED_EVENT, onChange);
	};
}
