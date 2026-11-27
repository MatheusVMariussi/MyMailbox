import type { ReadingPaneHint } from "./reading-pane-types";

/** The keys the empty reading pane suggests, in the order you would use them. */
export const READING_PANE_HINTS: readonly ReadingPaneHint[] = [
	{ keys: ["j", "k"], labelKey: "readingPane.hint.move" },
	{ keys: ["Enter"], labelKey: "readingPane.hint.open" },
	{ keys: ["c"], labelKey: "readingPane.hint.compose" },
	{ keys: ["/"], labelKey: "readingPane.hint.search" },
	{ keys: ["?"], labelKey: "readingPane.hint.all" },
];

/** Lower-case, dash-separated form of a folder or label name for the prompt path (`Clientes VIP` -> `clientes-vip`). */
export function toPathSegment(name: string): string {
	return name
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim()
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "") || "mail";
}

/** `mymailbox/<segments>` for the prompt; each segment is slugged. */
export function getReadingPanePath(segments: readonly string[]): string {
	return ["mymailbox", ...segments.map(toPathSegment)].join("/");
}
