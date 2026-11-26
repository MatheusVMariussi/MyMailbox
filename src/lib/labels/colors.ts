import type { LabelColorOption } from "./types";

/** The label palette, shared with calendar event colors. */
export const LABEL_COLOR_VALUES = [
	"#2563eb",
	"#7c3aed",
	"#db2777",
	"#dc2626",
	"#ea580c",
	"#d97706",
	"#16a34a",
	"#0d9488",
] as const;

export const DEFAULT_LABEL_COLOR = LABEL_COLOR_VALUES[0];

export const LABEL_COLOR_OPTIONS: LabelColorOption[] = [
	{ value: "#2563eb", label: "Blue" },
	{ value: "#7c3aed", label: "Purple" },
	{ value: "#db2777", label: "Pink" },
	{ value: "#dc2626", label: "Red" },
	{ value: "#ea580c", label: "Orange" },
	{ value: "#d97706", label: "Amber" },
	{ value: "#16a34a", label: "Green" },
	{ value: "#0d9488", label: "Teal" },
];
