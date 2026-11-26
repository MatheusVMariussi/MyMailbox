import type { TranslationKey } from "@/lib/i18n/types";
import { labelColorKeys } from "@/lib/labels/color-keys";
import { PROJECT_ACCENT_COLORS } from "./colors";

/** Translation keys for the names of the project colors: the identity accents, then the label palette. */
export const projectColorKeys: Record<string, TranslationKey> = {
	[PROJECT_ACCENT_COLORS[0]]: "projects.color.accentBlue",
	[PROJECT_ACCENT_COLORS[1]]: "projects.color.accentGreen",
	[PROJECT_ACCENT_COLORS[2]]: "projects.color.accentPurple",
	[PROJECT_ACCENT_COLORS[3]]: "projects.color.accentAmber",
	...labelColorKeys,
};
