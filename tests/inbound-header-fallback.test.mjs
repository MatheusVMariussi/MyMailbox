import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mailflare-header-fallback-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));

// Intake is replaced by a recorder, so the tests see exactly which header map reaches it.
const mocks = {
	"@/lib/email/intake": "export async function intakeIncomingMail(env,input){globalThis.__intakeInput=input;return {action:'store'}}",
	"@/db": "export function getDb(){return {select:()=>({from:()=>({where:()=>({limit:async()=>[{id:'d1'}]})})})}}",
};
await build({
	stdin: {
		contents: `
			export { intakeProviderMail } from "./src/lib/email/provider-intake.ts";
		`,
		resolveDir: root,
		sourcefile: "header-fallback-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	packages: "external",
	alias: { "@": join(root, "src") },
	plugins: [{
		name: "mocks",
		setup(builder) {
			builder.onResolve({ filter: /^(@\/lib\/email\/intake|@\/db)$/ }, (args) => ({ path: args.path, namespace: "mock" }));
			builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
		},
	}],
	logLevel: "silent",
});
const m = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const message = "From: news@x.test\r\nTo: me@one.test\r\nSubject: Sale\r\nList-Unsubscribe: <https://x.test/u>\r\n\r\nBody\r\n";
const raw = () => new TextEncoder().encode(message).buffer;

test("provider mail takes its header map from the raw message", async () => {
	globalThis.__intakeInput = null;
	await m.intakeProviderMail({}, { from: "news@x.test", recipients: ["me@one.test"], raw: raw() });
	assert.equal(globalThis.__intakeInput.headers["list-unsubscribe"], "<https://x.test/u>");
	assert.equal(globalThis.__intakeInput.headers.subject, "Sale");
});
