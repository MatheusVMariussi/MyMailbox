"use client";

import { createContext, useContext } from "react";

/**
 * Whether keyboard shortcuts are on, without the rest of the shortcuts context. Lists read it so they
 * can bind their own keys without pulling in the command palette; outside a provider it is off.
 */
export const ShortcutsEnabledContext = createContext(false);

export function useShortcutsActive(): boolean {
	return useContext(ShortcutsEnabledContext);
}
