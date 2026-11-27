"use client";

import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { readStorage, writeStorage } from "./reorderable-list-utils";

const subscribeNothing = () => () => {};
const hydratedOnClient = () => true;
const hydratedOnServer = () => false;

/** Open/closed state of a menu section, remembered in localStorage. Starts open. */
export function useSectionOpen(storageKey: string): [boolean, () => void] {
	// Storage is read after hydration so the server and first client render agree.
	const hydrated = useSyncExternalStore(subscribeNothing, hydratedOnClient, hydratedOnServer);
	const [toggled, setToggled] = useState<{ key: string; open: boolean } | null>(null);
	const open = toggled?.key === storageKey ? toggled.open : hydrated ? readStorage(storageKey, true) : true;
	function toggle() {
		writeStorage(storageKey, !open);
		setToggled({ key: storageKey, open: !open });
	}
	return [open, toggle];
}

/**
 * Collapsible section label as a mono kicker in the portfolio style (`// projects`): lower-case, muted,
 * with a small chevron that turns when the section opens.
 */
export function NavSectionHeader({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
	return (
		<div className="group/section mt-5 mb-1 ml-3 mr-1 flex h-7 shrink-0 items-center justify-between gap-1">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md pl-3 pr-2 text-left font-mono text-[11px] text-ink-muted transition-colors duration-150 ease-out-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none max-md:text-xs"
			>
				<span aria-hidden="true" className="shrink-0 text-ink-muted/70">{"//"}</span>
				<span className="truncate">{label.toLocaleLowerCase()}</span>
				<ChevronRight aria-hidden="true" className={cn("h-3 w-3 shrink-0 opacity-60 transition-transform duration-150 ease-out-soft group-hover/section:opacity-100 motion-reduce:transition-none", open && "rotate-90")} />
			</button>
			{children}
		</div>
	);
}
