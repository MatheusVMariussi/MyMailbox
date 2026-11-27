import type { TranslationKey } from "@/lib/i18n/types";

export type SettingsNavItem = {
	href: string;
	labelKey: TranslationKey;
	requiresMailboxAccess?: boolean;
	/** Shown only to the admins the Admin area lets manage domains (`canManageDomains`). */
	requiresDomainAccess?: boolean;
};

export type SettingsNavSection = {
	labelKey: TranslationKey;
	items: SettingsNavItem[];
};
