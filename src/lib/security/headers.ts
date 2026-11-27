import { createHash } from "node:crypto";
import { APP_INLINE_SCRIPTS } from "./inline-scripts";

const isProduction = process.env.NODE_ENV === "production";
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

let inlineScriptHashes: string[] | null = null;

/** CSP hash sources for the app's own constant inline scripts. */
function getInlineScriptHashes(): string[] {
	inlineScriptHashes ??= APP_INLINE_SCRIPTS.map(
		(script) => `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`,
	);
	return inlineScriptHashes;
}

function scriptSources(nonce: string | undefined): string[] {
	// The dev server injects Vite's client and the React refresh preamble inline and evaluates
	// strings for HMR and source maps; production never needs either.
	if (!isProduction) return ["'self'", "'unsafe-inline'", "'unsafe-eval'", TURNSTILE_ORIGIN];
	return ["'self'", ...(nonce ? [`'nonce-${nonce}'`] : []), ...getInlineScriptHashes(), TURNSTILE_ORIGIN];
}

/**
 * The app's Content-Security-Policy. In production no inline script runs unless it carries the
 * per-request nonce (framework scripts, see document-csp.ts) or is one of the hashed constant
 * scripts. Without a nonce (JSON, files, the static config default) only the hashed scripts may run.
 */
export function buildContentSecurityPolicy(options: { nonce?: string } = {}): string {
	return [
		"default-src 'self'",
		`script-src ${scriptSources(options.nonce).join(" ")}`,
		// Email bodies, React style props and Turnstile all set inline styles.
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		// 'self' covers same-host ws:/wss: (the realtime socket and Vite HMR); no other socket host.
		`connect-src 'self' ${TURNSTILE_ORIGIN}`,
		// 'self' lets the attachment viewer show PDFs in an iframe.
		`frame-src 'self' ${TURNSTILE_ORIGIN}`,
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		// Nothing frames the app; the attachment route sets its own `frame-ancestors 'self'` for previews.
		"frame-ancestors 'none'",
		"upgrade-insecure-requests",
	].join("; ");
}

export function getSecurityHeaders() {
	return [
		{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
		{ key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
		{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
		{ key: "X-Content-Type-Options", value: "nosniff" },
		{ key: "X-Frame-Options", value: "DENY" },
		// No window the app opens or that opens the app keeps a reference to it.
		{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
		{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
		{
			key: "Permissions-Policy",
			value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
		},
	];
}
