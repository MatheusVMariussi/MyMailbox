/**
 * Resolve the real client IP for rate limiting and audit metadata.
 *
 * On Workers, cf-connecting-ip is platform-set and cannot be forged. A bare
 * x-forwarded-for is the last resort when it is missing — its rightmost
 * hop is the least attacker-controlled entry.
 */
export function getClientIp(request: Request): string | null {
	return (
		headerValue(request, "cf-connecting-ip") ||
		headerValue(request, "x-forwarded-for")?.split(",").at(-1)?.trim() ||
		null
	);
}

function headerValue(request: Request, name: string): string | null {
	return request.headers.get(name)?.trim() || null;
}
