import { LABEL_COLOR_VALUES } from "@/lib/labels/colors";

/** The identity accents, offered first for projects. */
export const PROJECT_ACCENT_COLORS = ["#4f8cff", "#34d399", "#c084fc", "#fbbf24"] as const;

/** Every color a project may take: the identity accents, then the label palette. */
export const PROJECT_COLOR_VALUES = [...PROJECT_ACCENT_COLORS, ...LABEL_COLOR_VALUES] as const;

export const DEFAULT_PROJECT_COLOR = PROJECT_ACCENT_COLORS[0];
