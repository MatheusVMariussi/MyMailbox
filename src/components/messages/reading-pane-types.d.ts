import type { TranslationKey } from "@/lib/i18n/types";

export type ReadingPaneHint = {
	keys: readonly string[];
	labelKey: TranslationKey;
};

export type ReadingPaneEmptyProps = {
	/** Where the list is, as path segments after `~/mymailbox/` (`["inbox"]`, `["labels", "Clientes"]`). */
	folderPath: readonly string[];
};
