import type { TranslationKey } from "@/lib/i18n/types";
import type { ShortcutDefinition } from "./types";

/** One way to press a shortcut: keys held together (`Shift` + `I`) or pressed one after another (`g`, `i`). */
export type ShortcutKeys = { chord: readonly string[]; sequence?: never } | { sequence: readonly string[]; chord?: never };

export type ShortcutCatalogEntry = {
	labelKey: TranslationKey;
	/** Alternatives, shown with "or" between them. */
	keys: readonly ShortcutKeys[];
};

export type ShortcutCatalogGroup = {
	category: ShortcutDefinition["category"];
	entries: readonly ShortcutCatalogEntry[];
};
