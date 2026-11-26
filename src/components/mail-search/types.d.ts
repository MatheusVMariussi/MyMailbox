import type { TranslationKey } from "@/lib/i18n/types";

export type MailSearchContextValue = {
	/** Debounced value lists fetch with. */
	query: string;
	setQuery: (query: string) => void;
};

export type SearchHelpEntry = {
	/** What the cheat sheet shows, in monospace. */
	example: string;
	/** What picking the row appends to the query. */
	insert: string;
	descriptionKey: TranslationKey;
};

export type SearchHelpMenuProps = {
	/** Appends an operator to the query and puts the caret back in the box. */
	onInsert: (operator: string) => void;
};
