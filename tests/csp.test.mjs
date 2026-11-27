import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-csp-"));
after(() => rmSync(directory, { recursive: true, force: true }));

/** Bundles the CSP modules as the production build or the dev server sees them. */
async function load(mode) {
	const outfile = join(directory, `${mode}.mjs`);
	await build({
		stdin: {
			contents: `
				export * from "./src/lib/security/headers.ts";
				export * from "./src/lib/security/document-csp.ts";
				export { APP_INLINE_SCRIPTS } from "./src/lib/security/inline-scripts.ts";
				export { sidebarBootstrapScript } from "./src/components/sidebar-state-utils.ts";
				export { themeBootstrapScript } from "./src/components/theme-utils.ts";
				export { SPLASH_GUARD_SCRIPT } from "./src/components/loading-transition-utils.ts";
				export { ATTACHMENT_RESPONSE_HEADERS } from "./src/app/api/messages/[messageId]/attachments/[attachmentId]/utils.ts";
			`,
			resolveDir: root,
			sourcefile: `csp-${mode}-entry.ts`,
		},
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		tsconfig: join(root, "tsconfig.json"),
		packages: "external",
		define: { "process.env.NODE_ENV": JSON.stringify(mode) },
		logLevel: "silent",
	});
	return import(pathToFileURL(outfile).href);
}

const production = await load("production");
const development = await load("development");

const directives = (policy) => new Map(policy.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
	const [name, ...values] = part.split(/\s+/);
	return [name, values];
}));
const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

test("production pages allow no inline script except by nonce or hash", () => {
	const policy = directives(production.buildContentSecurityPolicy({ nonce: "abc123" }));
	const scripts = policy.get("script-src");
	assert.ok(!scripts.includes("'unsafe-inline'"), scripts.join(" "));
	assert.ok(!scripts.includes("'unsafe-eval'"));
	assert.ok(scripts.includes("'nonce-abc123'"));
	assert.ok(scripts.includes("'self'"));
	for (const script of [production.sidebarBootstrapScript, production.themeBootstrapScript, production.SPLASH_GUARD_SCRIPT]) {
		assert.ok(scripts.includes(sha256(script)), "every constant inline script the app renders has its hash");
	}
	assert.equal(production.APP_INLINE_SCRIPTS.length, 3);
	// Without a nonce (JSON and other non-document responses) nothing inline runs but the hashed scripts.
	const staticScripts = directives(production.buildContentSecurityPolicy()).get("script-src");
	assert.ok(!staticScripts.some((source) => source.startsWith("'nonce-") || source === "'unsafe-inline'"));
});

test("both builds restrict websockets to this origin and lock down the other directives", () => {
	for (const policy of [production.buildContentSecurityPolicy({ nonce: "n" }), development.buildContentSecurityPolicy()]) {
		const parsed = directives(policy);
		assert.deepEqual(parsed.get("connect-src").filter((source) => /^wss?:$/.test(source)), [], policy);
		assert.ok(parsed.get("connect-src").includes("'self'"));
		assert.deepEqual(parsed.get("object-src"), ["'none'"]);
		assert.deepEqual(parsed.get("base-uri"), ["'self'"]);
		assert.deepEqual(parsed.get("form-action"), ["'self'"]);
		assert.deepEqual(parsed.get("frame-ancestors"), ["'none'"]);
	}
	// The dev server's Vite client and refresh preamble are inline, so development keeps them working.
	assert.ok(directives(development.buildContentSecurityPolicy()).get("script-src").includes("'unsafe-inline'"));
	const headers = new Map(production.getSecurityHeaders().map(({ key, value }) => [key, value]));
	assert.equal(headers.get("X-Frame-Options"), "DENY");
	assert.equal(headers.get("Content-Security-Policy"), production.buildContentSecurityPolicy());
});

test("a document request carries a fresh nonce the client cannot choose", () => {
	const nonces = new Set(Array.from({ length: 20 }, () => production.createCspNonce()));
	assert.equal(nonces.size, 20);
	for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);

	const page = new Request("https://mail.test/inbox", {
		headers: { Accept: "text/html,application/xhtml+xml", "Content-Security-Policy": "script-src 'nonce-attacker'" },
	});
	const forwarded = production.withCspNonce(page, "server-nonce");
	assert.match(forwarded.headers.get("Content-Security-Policy"), /'nonce-server-nonce'/);
	assert.doesNotMatch(forwarded.headers.get("Content-Security-Policy"), /attacker/);

	// API calls and RSC navigations render no HTML document, so they keep the shared response path.
	const api = new Request("https://mail.test/api/messages", { headers: { Accept: "*/*" } });
	assert.equal(production.withCspNonce(api, "n"), api);
	const rsc = new Request("https://mail.test/inbox", { headers: { Accept: "text/x-component", RSC: "1" } });
	assert.equal(production.withCspNonce(rsc, "n"), rsc);
	// The dev server keeps the permissive policy, so it adds no nonce.
	assert.equal(development.withCspNonce(page, "n"), page);
});

test("the response CSP matches the nonce, and route-specific policies are kept", () => {
	const html = new Response("<html></html>", {
		headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": production.buildContentSecurityPolicy() },
	});
	const documentPolicy = production.applyDocumentCsp(html, "n0nce").headers.get("Content-Security-Policy");
	assert.equal(documentPolicy, production.buildContentSecurityPolicy({ nonce: "n0nce" }));

	const json = new Response("{}", { headers: { "Content-Type": "application/json", "Content-Security-Policy": production.buildContentSecurityPolicy() } });
	assert.equal(production.applyDocumentCsp(json, "n0nce").headers.get("Content-Security-Policy"), production.buildContentSecurityPolicy());

	const sandboxed = new Response("<p>", { headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'; sandbox" } });
	assert.equal(production.applyDocumentCsp(sandboxed, "n0nce").headers.get("Content-Security-Policy"), "default-src 'none'; sandbox");
});

test("attachment previews can be framed by the app itself and nothing else", () => {
	const headers = new Map(Object.entries(production.ATTACHMENT_RESPONSE_HEADERS));
	const policy = directives(headers.get("Content-Security-Policy"));
	assert.deepEqual(policy.get("frame-ancestors"), ["'self'"]);
	assert.deepEqual(policy.get("default-src"), ["'none'"]);
	assert.ok(policy.has("sandbox"));
	assert.equal(headers.get("X-Frame-Options"), "SAMEORIGIN");
});
