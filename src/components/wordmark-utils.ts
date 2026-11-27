import { DEFAULT_BRANDING } from "./branding-provider-utils";
import type { Branding } from "@/lib/branding/types";

/** `MyMailbox` -> `mymailbox`, `Caixa Postal` -> `caixa-postal`. */
export function toWordmarkSegment(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Whether Admin -> Branding replaced the default name or icon; the chrome then shows that icon and name. */
export function hasCustomBranding(branding: Pick<Branding, "appName" | "hasCustomIcon">): boolean {
	return branding.hasCustomIcon || branding.appName.trim() !== DEFAULT_BRANDING.appName;
}
