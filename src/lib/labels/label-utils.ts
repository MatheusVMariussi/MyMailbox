import type { LabelPair, MessageLabelDelta } from "./types";

/** Longest label name, in characters. */
export const LABEL_NAME_MAX = 80;

/**
 * Pairs per `message_labels` write. An insert binds two parameters per pair and a delete one per
 * message plus the label, so 45 keeps every statement under D1's 100 bound parameters.
 */
export const LABEL_PAIR_CHUNK = 45;

/** Trimmed name with inner whitespace collapsed, or null when empty, too long or holding control characters. */
export function normalizeLabelName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.replace(/\s+/g, " ").trim();
	if (/\p{Cc}/u.test(name)) return null;
	if (!name || name.length > LABEL_NAME_MAX) return null;
	return name;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
	return chunks;
}

/** Distinct pairs, first occurrence kept. */
export function uniquePairs(pairs: readonly LabelPair[]): LabelPair[] {
	const seen = new Set<string>();
	const result: LabelPair[] = [];
	for (const pair of pairs) {
		if (!pair.messageId || !pair.labelId) continue;
		const key = `${pair.messageId}\u0000${pair.labelId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(pair);
	}
	return result;
}

/** Pairs grouped by label, so a delete can bind the label once. */
export function groupPairsByLabel(pairs: readonly LabelPair[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const pair of uniquePairs(pairs)) {
		const ids = groups.get(pair.labelId) ?? [];
		ids.push(pair.messageId);
		groups.set(pair.labelId, ids);
	}
	return groups;
}

export function isEmptyLabelDelta(delta: MessageLabelDelta | null | undefined): boolean {
	return !delta || (delta.added.length === 0 && delta.removed.length === 0);
}

/** The label set after a delta; an unknown set stays unknown. */
export function applyLabelDelta(labelIds: readonly string[] | undefined | null, delta: MessageLabelDelta | null | undefined): string[] | undefined {
	if (!labelIds) return undefined;
	if (isEmptyLabelDelta(delta)) return [...labelIds];
	const removed = new Set(delta!.removed);
	const next = labelIds.filter((id) => !removed.has(id));
	for (const id of delta!.added) if (!next.includes(id)) next.push(id);
	return next;
}

/** The delta that undoes `delta`. */
export function invertLabelDelta(delta: MessageLabelDelta): MessageLabelDelta {
	return { added: [...delta.removed], removed: [...delta.added] };
}

/** What adding (or removing) one label changes on a message with `labelIds`; unknown sets assume a change. */
export function labelDeltaFor(labelIds: readonly string[] | undefined | null, labelId: string, add: boolean): MessageLabelDelta {
	if (add) return { added: labelIds?.includes(labelId) ? [] : [labelId], removed: [] };
	return { added: [], removed: labelIds && !labelIds.includes(labelId) ? [] : [labelId] };
}

/** Whether a JSON value is a well-formed delta (undo tokens are signed, but stay defensive). */
export function isLabelDelta(value: unknown): value is MessageLabelDelta {
	if (!value || typeof value !== "object") return false;
	const delta = value as Partial<MessageLabelDelta>;
	const isIdList = (list: unknown) => Array.isArray(list) && list.length <= 100 && list.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200);
	return isIdList(delta.added) && isIdList(delta.removed);
}
