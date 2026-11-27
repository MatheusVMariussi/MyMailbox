import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Sending from a domain whose Cloudflare Email Sending is not turned on is a setup problem the user can fix,
 * not a server error: the send routes answer 422 with a code the composer translates.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "sending-not-configured-test-"));
const mocks = {
	"@/db": "export function getDb() { return globalThis.sendingTest.db; }",
};
await build({
	stdin: {
		contents: `export { assertSendingConfigured, SendingNotConfiguredError, SENDING_NOT_CONFIGURED } from './src/lib/email/outbound-provider.ts';
			export { sendErrorBody } from './src/app/api/send/error-utils.ts';`,
		resolveDir: root,
		sourcefile: "sending-not-configured-test.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
	tsconfig: join(root, "tsconfig.json"),
	plugins: [{ name: "mocks", setup(builder) {
		builder.onResolve({ filter: /^@\/db$/ }, ({ path }) => ({ path, namespace: "mock" }));
		builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
	} }],
});
const mod = await import(pathToFileURL(join(directory, "entry.mjs")).href);
after(() => {
	rmSync(directory, { recursive: true, force: true });
	delete globalThis.sendingTest;
});

function dbReturning(rows) {
	const chain = { select: () => chain, from: () => chain, where: () => chain, limit: async () => rows };
	return chain;
}

test("a domain without Cloudflare sending throws the typed error", async () => {
	globalThis.sendingTest = { db: dbReturning([{ provider: "none" }]) };
	await assert.rejects(() => mod.assertSendingConfigured({}, "eu@example.com"), (error) => {
		assert.ok(error instanceof mod.SendingNotConfiguredError);
		assert.equal(error.code, mod.SENDING_NOT_CONFIGURED);
		return true;
	});
});

test("a domain sending through Cloudflare passes", async () => {
	globalThis.sendingTest = { db: dbReturning([{ provider: "cloudflare" }]) };
	await mod.assertSendingConfigured({}, "eu@example.com");
});

test("the send routes answer 422 with the code", () => {
	const { status, body } = mod.sendErrorBody(new mod.SendingNotConfiguredError("example.com"));
	assert.equal(status, 422);
	assert.equal(body.code, mod.SENDING_NOT_CONFIGURED);
	assert.match(body.error, /example\.com/);
});
