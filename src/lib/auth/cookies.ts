import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionTokenFromRequestHeaders, getUserFromSession } from "@/lib/auth/session";
import { hasValidSessionMutationOrigin } from "./origin";
import { UnauthorizedError } from "./unauthorized";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The signed-in user of a browser request. The web client authenticates with the HttpOnly session
 * cookie only: a session token in an `Authorization` header is not a credential (API keys and app
 * passwords have their own Bearer/Basic paths), so page scripts never need to hold the token.
 */
export async function getCurrentUser(env: CloudflareEnv, request?: Request) {
	// Every handler that authenticates by cookie resolves the user here, so this is the one place that
	// stops a cross-site or same-site-sibling page from riding the cookie on a state-changing request.
	if (request && MUTATING_METHODS.has(request.method.toUpperCase()) && !hasValidSessionMutationOrigin(request)) return null;

	const token = request ? getSessionTokenFromRequestHeaders(request) : (await cookies()).get(SESSION_COOKIE)?.value;
	const user = await getUserFromSession(env, token);
	return user?.disabled || user?.deletedAt ? null : user;
}

export async function requireUser(env: CloudflareEnv, request?: Request) {
	const user = await getCurrentUser(env, request);
	if (!user) throw new UnauthorizedError();
	return user;
}
