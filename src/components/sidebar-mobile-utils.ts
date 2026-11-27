"use client";

import { useCallback, useSyncExternalStore } from "react";

const mobileQuery = "(max-width: 767px)";
// The message list sits beside the reader from tablet width up (two panes, three with the sidebar on desktop).
const splitQuery = "(min-width: 768px)";
// Between phone and desktop the sidebar shrinks to its icon rail so the list and reader keep their room.
const tabletQuery = "(min-width: 768px) and (max-width: 1023px)";
const hoverQuery = "(hover: hover) and (pointer: fine)";

function useMediaQuery(query: string): boolean {
	const subscribe = useCallback((onChange: () => void) => {
		const media = window.matchMedia(query);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [query]);
	const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
	return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function isMobileViewport(): boolean {
	return window.matchMedia(mobileQuery).matches;
}

export function useIsMobile(): boolean {
	return useMediaQuery(mobileQuery);
}

/** Whether the split message list is actually rendered beside the reader (tablet and desktop). */
export function useIsDesktop(): boolean {
	return useMediaQuery(splitQuery);
}

/** Tablet width: two panes, with the sidebar as an icon rail. */
export function useIsTablet(): boolean {
	return useMediaQuery(tabletQuery);
}

/** Whether the primary pointer can hover; coarse touch screens get no hover rail. */
export function useHasHover(): boolean {
	return useMediaQuery(hoverQuery);
}
