"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Search } from "@/components/icons";
import { Input } from "@/components/ui/input";
import type { HeaderSearchProps } from "./header-search-types";

/** Popovers opened from the search field (the operator cheat sheet) keep the phone search open while they are up. */
const SEARCH_POPOVER_SELECTOR = "[data-header-search-popover]";

// The header search shared by every layout, styled as a command line: mono text, hairline field, accent focus.
// On phones it is an icon beside the menu button until tapped, then covers the header at full width; the
// wrapper still fills the row so whatever follows it stays pushed to the right.
export function HeaderSearch({ value, onChange, label, placeholder, onSubmit, trailing, inputProps, mobileEnd }: HeaderSearchProps) {
	const [expanded, setExpanded] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const formRef = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (expanded) inputRef.current?.focus();
	}, [expanded]);

	// Collapse the phone search once focus has really left it: a tap on its own buttons (clear, cheat sheet)
	// or an open cheat sheet keeps it open.
	function collapseIfFocusLeft() {
		window.setTimeout(() => {
			if (formRef.current?.contains(document.activeElement)) return;
			if (document.querySelector(SEARCH_POPOVER_SELECTOR)) return;
			setExpanded(false);
		}, 0);
	}

	return (
		<div className={clsx("flex min-w-0 flex-1 items-center", mobileEnd && !expanded && "max-md:justify-end")}>
			<button
				type="button"
				onClick={() => setExpanded(true)}
				aria-label={label}
				className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden", value ? "bg-accent-soft text-accent" : "text-ink-muted", expanded && "hidden")}
			>
				<Search className="h-5 w-5" />
			</button>
			<form
				ref={formRef}
				role="search"
				onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}
				onBlur={collapseIfFocusLeft}
				className={clsx(
					"group/search h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 text-ink-muted transition-[border-color,box-shadow] duration-150 ease-out-soft hover:border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 motion-reduce:transition-none md:flex",
					expanded ? "flex max-md:fixed max-md:inset-x-2 max-md:top-[max(0.75rem,env(safe-area-inset-top))] max-md:z-[60] max-md:h-11 max-md:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]" : "max-md:hidden",
				)}
			>
				<Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted transition-colors group-focus-within/search:text-accent" />
				<Input
					ref={inputRef}
					{...inputProps}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					aria-label={label}
					placeholder={placeholder ?? label}
					spellCheck={false}
					autoCapitalize="off"
					autoCorrect="off"
					className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none! shadow-none! border-none! px-0 placeholder:text-ink-muted"
				/>
				{trailing}
			</form>
		</div>
	);
}
