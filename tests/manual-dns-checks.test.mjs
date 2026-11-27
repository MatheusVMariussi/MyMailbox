import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = mkdtempSync(join(root, "node_modules", "mymailbox-dns-bundle-"));

await build({
	stdin: {
		contents: `export { auditDomainDns } from "./src/lib/domains/dns-audit.ts";`,
		resolveDir: root,
		sourcefile: "dns-test-entry.ts",
	},
	outfile: join(bundleDirectory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});
const { auditDomainDns } = await import(pathToFileURL(join(bundleDirectory, "entry.mjs")).href);
rmSync(bundleDirectory, { recursive: true, force: true });

const RR_TYPES = { A: 1, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };

function answerDns(answers) {
	const asked = [];
	globalThis.fetch = async (url) => {
		const parsed = new URL(url);
		const name = parsed.searchParams.get("name");
		asked.push(name);
		const type = parsed.searchParams.get("type");
		const data = answers[`${name}|${type}`];
		// Real DoH answers carry the numeric RR type; queryDns keeps only the type it asked for.
		return Response.json(data === undefined ? { Status: 3 } : { Status: 0, Answer: data.map((value) => ({ name, type: RR_TYPES[type], TTL: 60, data: value })) });
	};
	return asked;
}

const emptyView = { routing: { records: [], missing: [] }, sending: [] };

test("SPF for a Resend sender is found on Resend's return-path subdomains", async () => {
	// send.<domain> carries the SPF TXT itself, or a CNAME whose target does;
	// either way the TXT lookup answers. Newer domains use rsend.<domain> too.
	answerDns({ "send.example.com|TXT": ["v=spf1 include:amazonses.com ~all"] });
	assert.equal((await auditDomainDns("example.com", emptyView, "resend")).spf.status, "ok");
	answerDns({ "rsend.example.com|TXT": ["v=spf1 ip4:1.2.3.4 ~all"] });
	assert.equal((await auditDomainDns("example.com", emptyView, "resend")).spf.status, "ok");
	answerDns({ "example.com|TXT": ["v=spf1 include:_spf.resend.com ~all"] });
	assert.equal((await auditDomainDns("example.com", emptyView, "resend")).spf.status, "ok");
	answerDns({});
	assert.equal((await auditDomainDns("example.com", emptyView, "resend")).spf.status, "missing");
	// Other senders still only look at the apex.
	answerDns({ "send.example.com|TXT": ["v=spf1 include:amazonses.com ~all"] });
	assert.equal((await auditDomainDns("example.com", emptyView, "cloudflare")).spf.status, "missing");
	assert.equal((await auditDomainDns("example.com", emptyView)).spf.status, "missing");
});

test("DKIM for a Resend domain is checked at Resend's selector when nothing else names one", async () => {
	const asked = answerDns({ "resend._domainkey.example.com|TXT": ["p=abc"] });
	const resend = await auditDomainDns("example.com", emptyView, "resend");
	assert.equal(resend.dkim.status, "ok");
	assert.ok(asked.includes("resend._domainkey.example.com"));
	const other = await auditDomainDns("example.com", emptyView, "none");
	assert.equal(other.dkim.status, "unknown");
});
