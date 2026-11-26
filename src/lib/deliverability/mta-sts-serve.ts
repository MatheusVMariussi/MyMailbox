import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { domainDeliverability, domains } from "@/db/schema";
import { buildMtaStsPolicy, mtaStsHostDomain, normalizeMx, parseMaxAge } from "./mta-sts";

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

function storedMx(value: string | null): string[] | null {
	try {
		return normalizeMx(JSON.parse(value ?? ""));
	} catch {
		return null;
	}
}

/**
 * The policy for `mta-sts.<domain>`, answered for a configured domain only (it has a policy id: testing, enforce, or
 * `none` while the removal period runs). Anything else, including the app's own host name, is a 404. The body is built
 * from stored, re-validated values; nothing from the request is echoed. Never redirects (RFC 8461 forbids it).
 */
export async function serveMtaStsPolicy(env: Pick<CloudflareEnv, "DB">, request: Request): Promise<Response> {
	// The request's host name, as the Worker's host guard reads it.
	const domain = mtaStsHostDomain(new URL(request.url).hostname);
	if (!domain) return notFound();
	const [row] = await getDb(env).select({ mode: domainDeliverability.mtaStsMode, mx: domainDeliverability.mtaStsMx, maxAge: domainDeliverability.mtaStsMaxAge })
		.from(domainDeliverability).innerJoin(domains, eq(domains.id, domainDeliverability.domainId))
		.where(and(eq(domains.hostname, domain), isNotNull(domainDeliverability.mtaStsPolicyId))).limit(1);
	const mx = storedMx(row?.mx ?? null);
	if (!row || !mx || mx.length === 0 || parseMaxAge(row.maxAge) === null) return notFound();
	let body: string;
	try {
		body = buildMtaStsPolicy({ mode: row.mode, mx, maxAge: row.maxAge });
	} catch {
		return notFound();
	}
	return new Response(request.method === "HEAD" ? null : body, {
		status: 200,
		headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" },
	});
}
