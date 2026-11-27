import { buildContentSecurityPolicy } from "./headers";

/**
 * Per-request script nonces for HTML documents, applied in `worker.ts` around the vinext handler.
 *
 * vinext (like Next.js) reads the nonce from a `Content-Security-Policy` header on the incoming
 * request and stamps it on every inline script it emits: the RSC payload, the navigation bootstrap,
 * React's streaming scripts and the module preload links. The response then carries the same policy,
 * so those scripts run and an injected one does not. The development server keeps the permissive
 * policy (see headers.ts) and gets no nonce.
 */
const isProduction = process.env.NODE_ENV === "production";
const CSP_HEADER = "Content-Security-Policy";
const STATIC_POLICY = buildContentSecurityPolicy();

export function createCspNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** A browser loading a page, as opposed to fetch(), RSC navigation or a file. */
function isDocumentRequest(request: Request): boolean {
	if (request.method !== "GET" && request.method !== "HEAD") return false;
	return (request.headers.get("Accept") ?? "").includes("text/html");
}

/**
 * The request to hand vinext: a document request gets the server's own nonce policy (replacing any
 * CSP header the client sent, so a client cannot choose the nonce); anything else is unchanged.
 */
export function withCspNonce(request: Request, nonce: string): Request {
	if (!isProduction || !isDocumentRequest(request)) return request;
	const headers = new Headers(request.headers);
	headers.set(CSP_HEADER, buildContentSecurityPolicy({ nonce }));
	headers.delete("Content-Security-Policy-Report-Only");
	return new Request(request, { headers });
}

/**
 * Gives an HTML response the policy with this request's nonce. A response that set its own policy
 * (sandboxed files and previews) and non-HTML responses keep theirs.
 */
export function applyDocumentCsp(response: Response, nonce: string): Response {
	if (!isProduction) return response;
	if (!(response.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html")) return response;
	const current = response.headers.get(CSP_HEADER);
	if (current !== null && current !== STATIC_POLICY) return response;
	const headers = new Headers(response.headers);
	headers.set(CSP_HEADER, buildContentSecurityPolicy({ nonce }));
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
