"use client";

import { useMemo } from "react";
import { useListScope } from "@/components/list-scope-provider";
import { ALL_MAILBOXES } from "@/lib/labels/client";
import { groupLabelsByName, indexLabelGroups, type LabelGroup } from "@/lib/labels/group-utils";
import type { NavLabel } from "@/components/dashboard-nav-types";
import { useMailboxLabels } from "./use-mailbox-labels";

type ScopeLabels = {
	/** Every label of the listed mailboxes. */
	labels: NavLabel[];
	labelsById: ReadonlyMap<string, NavLabel>;
	/** Same-named labels grouped (one group per label in a single-mailbox scope). */
	groups: LabelGroup[];
	groupOf: ReadonlyMap<string, LabelGroup>;
};

/** The labels of the list scope: one mailbox's, or every accessible mailbox's grouped by name. */
export function useScopeLabels(): ScopeLabels {
	const { mailboxId } = useListScope();
	const labels = useMailboxLabels(mailboxId ?? ALL_MAILBOXES);
	return useMemo(() => {
		const groups = groupLabelsByName(labels);
		return { labels, labelsById: new Map(labels.map((label) => [label.id, label])), groups, groupOf: indexLabelGroups(groups) };
	}, [labels]);
}
