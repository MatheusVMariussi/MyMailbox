export type ThemePreference = "light" | "dark" | "system";

// MyMailbox opens dark until the user picks something else in Settings → Appearance.
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

export const THEME_STORAGE_KEY = "mailflare-theme";
export const THEME_CHANGED_EVENT = "mailflare:theme-changed";

// Runs in <head> before paint, so the first frame already has the right theme (same approach as the
// sidebar width). Keep it in sync with resolveTheme/applyTheme below.
export const themeBootstrapScript = `(() => {
	try {
		const saved = localStorage.getItem("mailflare-theme");
		const preference = saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
		const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
		document.documentElement.classList.toggle("dark", dark);
		document.documentElement.classList.toggle("light", !dark);
	} catch {}
})();`;

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(): ThemePreference {
	if (typeof window === "undefined") return DEFAULT_THEME_PREFERENCE;
	try {
		const saved = localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(saved) ? saved : DEFAULT_THEME_PREFERENCE;
	} catch {
		return DEFAULT_THEME_PREFERENCE;
	}
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference !== "system") return preference;
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
	if (typeof document === "undefined") return;
	const dark = resolveTheme(preference) === "dark";
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.classList.toggle("light", !dark);
}

export function saveThemePreference(preference: ThemePreference): void {
	try {
		if (preference === DEFAULT_THEME_PREFERENCE) localStorage.removeItem(THEME_STORAGE_KEY);
		else localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		// Storage can be unavailable in private windows; the theme still applies for this page.
	}
	applyTheme(preference);
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: preference }));
}
