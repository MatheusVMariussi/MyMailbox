import { cn } from "@/lib/utils";
import { toWordmarkSegment } from "./wordmark-utils";

type WordmarkProps = {
	/** The product name; shown lower-case and dash-joined (`MyMailbox` -> `mymailbox`). */
	name: string;
	/** An optional sub-path after the name (`admin` -> `~/mymailbox/admin`). */
	path?: string;
	/** `static` draws the block cursor without blinking (app chrome); `none` leaves it out. */
	caret?: "static" | "none";
	className?: string;
};

/** The `~/mymailbox` terminal wordmark: mono, accent `~/`. */
export function Wordmark({ name, path, caret = "static", className }: WordmarkProps) {
	return (
		<span className={cn("wordmark inline-flex min-w-0 items-center text-[15px] text-ink", className)}>
			<span className="truncate">
				<span className="text-accent">~/</span>
				{toWordmarkSegment(name)}
				{path && <span className="text-ink-muted">/{toWordmarkSegment(path)}</span>}
			</span>
			{caret === "static" && <span aria-hidden="true" className="ml-1 inline-block h-[1em] w-[0.5em] shrink-0 translate-y-px bg-ink-muted" />}
		</span>
	);
}
