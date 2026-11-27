import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Setting up Cloudflare Email Sending fails in two ways the admin fixes in the Cloudflare dashboard: a token
// without the account-level "Email Sending: Edit" permission, and a domain not onboarded for Email Sending.
// Both must say so instead of surfacing Cloudflare's raw answer.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-cloudflare-sending-errors-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export { CloudflareApiError } from "./src/lib/cloudflare-api-error";
			export { SendingSetupError, sendingSetupProblem, explainSendingError, EMAIL_SENDING_DASHBOARD_PATH } from "./src/lib/domains/sending-errors";
			export { ensureSendingSubdomain } from "./src/lib/domains/sending-subdomain";
			export { MxConflictError } from "./src/lib/domains/receiving-dns";
			export { getDomainProvisioningError } from "./src/lib/domains/errors";
			export { sendingProblemMessage } from "./src/app/(admin)/domains/sending-problem-utils";
		`,
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
});
const m = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

const SUBDOMAINS = "/zones/zone-1/email/sending/subdomains";
const apiError = (status, errors, path = SUBDOMAINS) => new m.CloudflareApiError(`Cloudflare API ${status} on ${path}`, status, path, errors);
const env = { CF_TOKEN: "token" };

// The Cloudflare API is answered at the fetch level, so the real client builds the errors.
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ok = (result) => answer(200, { success: true, errors: [], result });
const refuse = (status, errors) => answer(status, { success: false, errors, result: null });
let replies;
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => {
	replies = { list: () => ok([]), create: () => ok({ tag: "t1", name: "example.com", enabled: true }), mx: () => ok([]) };
	globalThis.fetch = async (url, init = {}) => {
		const path = new URL(String(url)).pathname;
		if (path.endsWith("/dns_records")) return replies.mx();
		if (path.endsWith("/email/sending/subdomains")) return init.method === "POST" ? replies.create() : replies.list();
		throw new Error(`unexpected request ${path}`);
	};
});

test("a token without Email Sending permission is a permission problem", () => {
	assert.equal(m.sendingSetupProblem(apiError(403, [{ code: 10000, message: "Authentication error" }])), "SENDING_PERMISSION");
	assert.equal(m.sendingSetupProblem(apiError(400, [{ code: 9109, message: "Unauthorized to access requested resource" }])), "SENDING_PERMISSION");
	assert.equal(m.sendingSetupProblem(apiError(401, [{ code: 2036, message: "Unauthorized" }])), "SENDING_PERMISSION");
});

test("a domain not onboarded for Email Sending is an onboarding problem", () => {
	assert.equal(m.sendingSetupProblem(apiError(404, [{ code: 7003, message: "Could not route to /zones/zone-1/email/sending/subdomains" }])), "SENDING_NOT_ONBOARDED");
	assert.equal(m.sendingSetupProblem(apiError(400, [{ code: 1001, message: "Email Sending is not enabled for this zone" }])), "SENDING_NOT_ONBOARDED");
	assert.equal(m.sendingSetupProblem(apiError(400, [{ message: "The zone has not been onboarded to Email Service" }])), "SENDING_NOT_ONBOARDED");
});

test("other failures, other endpoints and other errors are left alone", () => {
	assert.equal(m.sendingSetupProblem(apiError(500, [{ code: 10002, message: "Internal error" }])), null);
	assert.equal(m.sendingSetupProblem(apiError(403, [{ code: 10000, message: "Authentication error" }], "/zones/zone-1/email/routing/dns")), null);
	assert.equal(m.sendingSetupProblem(new Error("Authentication error")), null);
	const mx = new m.MxConflictError([{ content: "mx.other.test", priority: 10 }]);
	assert.equal(m.explainSendingError(mx, "example.com"), mx);
});

test("the explanation names the permission or the dashboard path, and keeps Cloudflare's answer", () => {
	const permission = m.explainSendingError(apiError(403, [{ code: 10000, message: "Authentication error" }]), "example.com");
	assert.ok(permission instanceof m.SendingSetupError);
	assert.equal(permission.code, "SENDING_PERMISSION");
	assert.match(permission.message, /"Email Sending: Edit"/);
	assert.equal(permission.detail, "code 10000: Authentication error");
	const onboarding = m.explainSendingError(apiError(404, []), "example.com");
	assert.equal(onboarding.code, "SENDING_NOT_ONBOARDED");
	assert.ok(onboarding.message.includes(m.EMAIL_SENDING_DASHBOARD_PATH));
	assert.match(onboarding.message, /example\.com/);
	assert.equal(onboarding.detail, "HTTP 404");
});

test("ensureSendingSubdomain explains a refused list or create", async () => {
	assert.equal((await m.ensureSendingSubdomain(env, "zone-1", "example.com")).subdomain.tag, "t1");
	replies.list = () => refuse(403, [{ code: 10000, message: "Authentication error" }]);
	await assert.rejects(m.ensureSendingSubdomain(env, "zone-1", "example.com"), (error) => error instanceof m.SendingSetupError && error.code === "SENDING_PERMISSION");
	replies.list = () => ok([]);
	replies.create = () => refuse(400, [{ code: 1001, message: "Email Sending is not enabled for this zone" }]);
	await assert.rejects(m.ensureSendingSubdomain(env, "zone-1", "example.com"), (error) => error instanceof m.SendingSetupError && error.code === "SENDING_NOT_ONBOARDED");
});

test("another service's MX records are still an MX conflict, not a permission problem", async () => {
	replies.create = () => refuse(401, [{ code: 2036, message: "Unauthorized" }]);
	replies.mx = () => ok([{ id: "mx1", type: "MX", name: "example.com", content: "mx.other.test", priority: 10 }]);
	await assert.rejects(m.ensureSendingSubdomain(env, "zone-1", "example.com"), (error) => error instanceof m.MxConflictError);
	replies.mx = () => ok([]);
	await assert.rejects(m.ensureSendingSubdomain(env, "zone-1", "example.com"), (error) => error instanceof m.SendingSetupError && error.code === "SENDING_PERMISSION");
});

test("adding a domain answers with the code and a 502", () => {
	const failure = m.getDomainProvisioningError(m.explainSendingError(apiError(404, []), "example.com"), "Failed to add domain");
	assert.deepEqual([failure.code, failure.status], ["SENDING_NOT_ONBOARDED", 502]);
});

test("the Domains page shows each code in the reader's words", () => {
	const t = (key, vars) => `${key}${vars ? JSON.stringify(vars) : ""}`;
	assert.equal(m.sendingProblemMessage("SENDING_PERMISSION", "example.com", t), "domains.sendingPermission");
	assert.equal(m.sendingProblemMessage("SENDING_NOT_ONBOARDED", "example.com", t), 'domains.sendingNotOnboarded{"host":"example.com"}');
	assert.equal(m.sendingProblemMessage("MX_CONFLICT", "example.com", t), null);
	assert.match(m.sendingProblemMessage("SENDING_NOT_ONBOARDED", "example.com"), /Compute → Email Service → Email Sending/);
});
