import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const outDir = mkdtempSync(join(tmpdir(), "mymailbox-inbound-key-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `export { inboundMessageId } from "./src/lib/email/inbound-id.ts";`,
		resolveDir: root,
		sourcefile: "inbound-key-test-entry.js",
	},
	outfile: join(outDir, "inbound-key.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});

const { inboundMessageId } = await import(pathToFileURL(join(outDir, "inbound-key.mjs")).href);

test("inboundMessageId derives a stable id from the key", async () => {
	const key = "inbound/1700000000000-abc.eml";
	assert.equal(await inboundMessageId(key), await inboundMessageId(key));
	assert.match(await inboundMessageId(key), /^msg_[0-9a-f]{64}$/);
	assert.notEqual(await inboundMessageId(key), await inboundMessageId("inbound/1700000000000-abd.eml"));
});
