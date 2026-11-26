"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useSelectedMailbox } from "./mailbox-provider";
import { useProjects } from "./projects/use-projects";
import {
	parseListScope,
	readStoredListScope,
	resolveListScope,
	subscribeStoredListScope,
	UNIFIED_LIST_SCOPE,
	writeStoredListScope,
} from "./list-scope-utils";
import type { ListScopeContextValue } from "./list-scope-types";

const ListScopeContext = createContext<ListScopeContextValue | null>(null);

const noServerScope = () => null;

/** The setters only write the stored scope; every list reads it back, in this tab and the others. */
function setMailboxScope(mailboxId: string | null): void {
	writeStoredListScope({ ...parseListScope(readStoredListScope()), mailboxId });
}

function setProjectFilter(projectId: string | null): void {
	writeStoredListScope({ ...parseListScope(readStoredListScope()), projectId });
}

const FALLBACK: ListScopeContextValue = { ...UNIFIED_LIST_SCOPE, setMailboxScope, setProjectFilter, isLoading: false };

/**
 * The scope of the mail lists, counts and reader navigation: every accessible mailbox by default (the unified
 * inbox) or one of them, optionally narrowed to a project. It is independent of `useSelectedMailbox`, which
 * settings and the composer use, so composing or replying never changes what the lists show.
 */
export function ListScopeProvider({ children }: { children: ReactNode }) {
	const { mailboxes, isLoading: mailboxesLoading } = useSelectedMailbox();
	const { projects, isLoading: projectsLoading } = useProjects();
	const raw = useSyncExternalStore(subscribeStoredListScope, readStoredListScope, noServerScope);
	const stored = useMemo(() => parseListScope(raw), [raw]);
	const mailboxIds = useMemo(() => (mailboxesLoading ? null : mailboxes.map((mailbox) => mailbox.id)), [mailboxes, mailboxesLoading]);
	const projectIds = useMemo(() => (projectsLoading ? null : projects.map((project) => project.id)), [projects, projectsLoading]);
	const scope = resolveListScope(stored, mailboxIds, projectIds);

	const value = useMemo<ListScopeContextValue>(() => ({
		mailboxId: scope.mailboxId,
		projectId: scope.projectId,
		setMailboxScope,
		setProjectFilter,
		isLoading: mailboxesLoading,
	}), [mailboxesLoading, scope.mailboxId, scope.projectId]);

	return <ListScopeContext.Provider value={value}>{children}</ListScopeContext.Provider>;
}

/** The list scope; outside a provider (settings, admin) the unified default, whose setters still store a choice for the lists. */
export function useListScope(): ListScopeContextValue {
	return useContext(ListScopeContext) ?? FALLBACK;
}
