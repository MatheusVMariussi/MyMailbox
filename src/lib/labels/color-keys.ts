import type { TranslationKey } from "@/lib/i18n/types";
import type { LabelColor } from "./types";

/** Translation keys for the names of the shared label/event colors. */
export const labelColorKeys = {
	"#2563eb": "color.blue",
	"#7c3aed": "color.purple",
	"#db2777": "color.pink",
	"#dc2626": "color.red",
	"#ea580c": "color.orange",
	"#d97706": "color.amber",
	"#16a34a": "color.green",
	"#0d9488": "color.teal",
} satisfies Record<LabelColor, TranslationKey>;
