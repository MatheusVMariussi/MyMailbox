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

test("SPF is read at the apex only", async () => {
	answerDns({ "example.com|TXT": ["v=spf1 include:_spf.mx.cloudflare.net ~all"] });
	assert.equal((await auditDomainDns("example.com", emptyView)).spf.status, "ok");
	answerDns({ "send.example.com|TXT": ["v=spf1 include:amazonses.com ~all"] });
	assert.equal((await auditDomainDns("example.com", emptyView)).spf.status, "missing");
	globalThis.fetch = async () => { throw new Error("offline"); };
	assert.equal((await auditDomainDns("example.com", emptyView)).spf.status, "unknown");
});

test("DKIM is checked at the selector Cloudflare signs with, and unknown without one", async () => {
	const asked = answerDns({ "cf2024-1._domainkey.example.com|TXT": ["v=DKIM1; p=abc"] });
	const signed = await auditDomainDns("example.com", { ...emptyView, dkimSelector: "cf2024-1" });
	assert.equal(signed.dkim.status, "ok");
	assert.ok(asked.includes("cf2024-1._domainkey.example.com"));
	answerDns({});
	assert.equal((await auditDomainDns("example.com", emptyView)).dkim.status, "unknown");
});
