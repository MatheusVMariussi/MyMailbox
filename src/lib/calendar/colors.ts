import { DEFAULT_LABEL_COLOR, LABEL_COLOR_VALUES } from "@/lib/labels/colors";
import type { LabelColor } from "@/lib/labels/types";

const LEGACY_CALENDAR_COLORS: Record<string, LabelColor> = {
  blue: "#2563eb",
  violet: "#7c3aed",
  rose: "#db2777",
  orange: "#ea580c",
  emerald: "#16a34a",
};

export function normalizeCalendarColor(value: string | undefined): LabelColor {
  return LABEL_COLOR_VALUES.find((color) => color === value)
    ?? LEGACY_CALENDAR_COLORS[value ?? ""]
    ?? DEFAULT_LABEL_COLOR;
}
