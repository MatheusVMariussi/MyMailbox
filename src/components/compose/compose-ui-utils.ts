/** Shared class names for the composer chrome, so its rows, labels and icon buttons stay one system. */

/** One field row (From, To, Cc, Bcc, Subject): hairline below, label column, value. */
export const COMPOSE_FIELD_ROW = "flex min-h-10 items-center gap-3 border-b border-line px-4 py-1";

/** The muted label column of a field row; wide enough for "From", "Para" and "Cco". */
export const COMPOSE_FIELD_LABEL = "w-11 shrink-0 text-[13px] font-normal text-ink-muted";

/** Ghost icon buttons in the composer toolbar. */
export const COMPOSE_ICON_BUTTON =
	"rounded-md p-1.5 text-ink-muted transition-colors duration-150 ease-out-soft hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 max-md:px-2";

/** Ghost icon buttons on the composer's header bar (one surface up, so hover goes one step further). */
export const COMPOSE_HEADER_BUTTON =
	"rounded-md p-1 text-ink-muted transition-colors duration-150 ease-out-soft hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The portfolio's accent glow, only while the primary action is hovered or focused. */
export const COMPOSE_PRIMARY_GLOW =
	"transition-shadow duration-150 ease-out-soft hover:shadow-[0_0_24px_-4px_rgba(79,140,255,0.6)] has-[:focus-visible]:shadow-[0_0_24px_-4px_rgba(79,140,255,0.6)] motion-reduce:transition-none";

/**
 * The header title as a terminal path, e.g. "New Message" becomes "new-message" (shown after an accent `~/`).
 * Purely visual: the readable title is rendered alongside it for assistive technology.
 */
export function composeTitleSlug(title: string): string {
	return title.trim().toLowerCase().replace(/\s+/g, "-");
}
