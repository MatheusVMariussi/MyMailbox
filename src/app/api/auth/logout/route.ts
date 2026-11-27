import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/cloudflare";
import { deleteSession, getUserFromSession, SESSION_COOKIE } from "@/lib/auth/session";
import { ACCOUNTS_COOKIE, cookieOptions, parseAccountTokens, resolveAccounts, serializeAccountTokens } from "@/lib/auth/accounts";
import { recordAuthActivity } from "@/lib/auth/activity";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";

export async function POST(request: Request) {
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const env = getEnv();
	const jar = await cookies();
	const token = jar.get(SESSION_COOKIE)?.value;
	if (token) {
		const user = await getUserFromSession(env, token);
		if (user) await recordAuthActivity(env, { action: "auth.logout", userId: user.id, request });
		await deleteSession(env, token);
	}

	// Drop this account from the browser's set; promote another one if present.
	const remaining = await resolveAccounts(
		env,
		parseAccountTokens(jar.get(ACCOUNTS_COOKIE)?.value).filter((entry) => entry !== token),
	);
	const next = remaining[remaining.length - 1];
	// The next account's token travels only in the cookie; `switched` tells the client one took over.
	const response = NextResponse.json({ ok: true, ...(next ? { switched: true, redirect: "/inbox" } : {}) });
	response.headers.set("Cache-Control", "no-store");
	response.cookies.set(SESSION_COOKIE, next?.token ?? "", cookieOptions(next ? undefined : 0));
	response.cookies.set(
		ACCOUNTS_COOKIE,
		serializeAccountTokens(remaining.map((account) => account.token)),
		cookieOptions(remaining.length ? undefined : 0),
	);
	return response;
}
