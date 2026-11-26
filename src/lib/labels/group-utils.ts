import type { NavLabel } from "@/components/dashboard-nav-types";

/** Same-named labels of different mailboxes, shown as one entry in the unified sidebar and menus. */
export type LabelGroup = NavLabel & {
	/** Every label id in the group, in list order; `id` is the first. */
	ids: string[];
	/** The list filter and route segment: the ids joined with commas. */
	filter: string;
};

/**
 * Groups labels by exact name, keeping the order of the (name-sorted) input. A group takes the color of its
 * first label. Single-mailbox lists produce one group per label.
 */
export function groupLabelsByName(labels: readonly NavLabel[]): LabelGroup[] {
	const groups = new Map<string, LabelGroup>();
	for (const label of labels) {
		const group = groups.get(label.name);
		if (group) {
			group.ids.push(label.id);
			group.filter = group.ids.join(",");
			continue;
		}
		groups.set(label.name, { ...label, ids: [label.id], filter: label.id });
	}
	return [...groups.values()];
}

/** The group each label id belongs to. */
export function indexLabelGroups(groups: readonly LabelGroup[]): Map<string, LabelGroup> {
	const index = new Map<string, LabelGroup>();
	for (const group of groups) for (const id of group.ids) index.set(id, group);
	return index;
}

/** The ids of a label filter (one id, or a comma-separated group). */
export function splitLabelFilter(filter: string | null | undefined): string[] {
	return (filter ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/** The count of a label filter: the sum over its labels. */
export function sumLabelCounts(
	filter: string | null | undefined,
	counts: Record<string, { total: number; unread: number }> | undefined,
): { total: number; unread: number } | undefined {
	const ids = splitLabelFilter(filter);
	if (!counts || ids.length === 0 || !ids.some((id) => counts[id])) return undefined;
	return ids.reduce((sum, id) => ({ total: sum.total + (counts[id]?.total ?? 0), unread: sum.unread + (counts[id]?.unread ?? 0) }), { total: 0, unread: 0 });
}

/** A label route segment as an id or comma-separated group, whether or not the router percent-encoded it. */
export function decodeLabelSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
