import { authFetch, clearClientSession, markClientSessionChanged } from "@/lib/auth/client";
import { setAppBadgeCount } from "@/lib/push/app-badge";

/** Returns true when another signed-in account on this browser took over. */
export async function logoutClientSession(): Promise<boolean> {
	let switched = false;
	try {
		const response = await authFetch("/api/auth/logout", {
			method: "POST",
			redirectOnUnauthorized: false,
		});
		switched = ((await response.json().catch(() => null)) as { switched?: boolean } | null)?.switched === true;
	} catch {
		// Local logout must complete even when the server request is unavailable.
	} finally {
		clearClientSession();
		setAppBadgeCount(0);
	}
	if (!switched) return false;
	markClientSessionChanged();
	return true;
}
