import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mymailbox-svix-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
		alias: { "@": join(root, "src") },
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const svix = await bundle("src/lib/email/svix.ts", "svix.mjs");

test("Svix signatures verify, and reject tampering, stale timestamps and wrong secrets", async () => {
	const secretBytes = Buffer.from("super-secret-key-material");
	const secret = `whsec_${secretBytes.toString("base64")}`;
	const id = "msg_1";
	const timestamp = String(Math.floor(Date.now() / 1000));
	const body = '{"type":"email.received"}';
	const { createHmac } = await import("node:crypto");
	const signature = `v1,${createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
	const headers = { id, timestamp, signature };

	assert.equal(await svix.verifySvixSignature(secret, headers, body), true);
	assert.equal(await svix.verifySvixSignature(secret, { ...headers, signature: `v1,bogus ${signature}` }, body), true, "any listed signature may match");
	assert.equal(await svix.verifySvixSignature(secret, headers, body + " "), false);
	assert.equal(await svix.verifySvixSignature(`whsec_${Buffer.from("other").toString("base64")}`, headers, body), false);
	assert.equal(await svix.verifySvixSignature(secret, { ...headers, timestamp: String(Number(timestamp) - 3600) }, body), false);
	assert.equal(await svix.verifySvixSignature(secret, { id: null, timestamp, signature }, body), false);
});
