import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-project-resolve-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `export * from "./src/lib/projects/resolve-utils.ts";`,
		resolveDir: root,
		sourcefile: "project-resolve-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});
const {
	pickProjectForLocalPart,
	resolveProjectForAddress,
	splitProjectAddress,
	normalizeProjectLocalPart,
	messageOwnAddresses,
	findLocalPartConflicts,
} = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const mappings = [
	{ projectId: "catch-all", localPart: "" },
	{ projectId: "sales", localPart: "sales" },
	{ projectId: "first-last", localPart: "first.last" },
];

test("an exact local part beats the domain default", () => {
	assert.equal(pickProjectForLocalPart(mappings, "sales"), "sales");
	assert.equal(pickProjectForLocalPart(mappings, "SALES"), "sales");
});

test("dots and plus tags are normalized on both sides", () => {
	assert.equal(pickProjectForLocalPart(mappings, "sa.les+newsletter"), "sales");
	assert.equal(pickProjectForLocalPart(mappings, "firstlast"), "first-last");
	assert.equal(pickProjectForLocalPart(mappings, "First.Last+x"), "first-last");
});

test("an unmapped local part falls back to the domain default, else none", () => {
	assert.equal(pickProjectForLocalPart(mappings, "someone"), "catch-all");
	assert.equal(pickProjectForLocalPart(mappings.filter((mapping) => mapping.localPart), "someone"), null);
	assert.equal(pickProjectForLocalPart([], "sales"), null);
});

test("an address resolves on its own domain only", () => {
	const across = [
		{ projectId: "alpha", hostname: "alpha.test", localPart: "" },
		{ projectId: "beta", hostname: "beta.test", localPart: "" },
		{ projectId: "beta-sales", hostname: "beta.test", localPart: "sales" },
	];
	assert.equal(resolveProjectForAddress(across, "hello@alpha.test"), "alpha");
	assert.equal(resolveProjectForAddress(across, "Sales <SALES@Beta.Test>"), "beta-sales");
	assert.equal(resolveProjectForAddress(across, "x@beta.test"), "beta");
	assert.equal(resolveProjectForAddress(across, "x@gamma.test"), null);
	assert.equal(resolveProjectForAddress(across, "not an address"), null);
});

test("splitProjectAddress returns the bare lower-cased parts", () => {
	assert.deepEqual(splitProjectAddress("Me <Me.Here+tag@Example.COM>"), { localPart: "me.here+tag", hostname: "example.com" });
	assert.equal(splitProjectAddress(""), null);
	assert.equal(splitProjectAddress("nobody"), null);
});

test("a stored local part is trimmed and lower-cased; empty means the whole domain", () => {
	assert.equal(normalizeProjectLocalPart("  Sales "), "sales");
	assert.equal(normalizeProjectLocalPart(""), "");
	assert.equal(normalizeProjectLocalPart("first.last"), "first.last");
	assert.equal(normalizeProjectLocalPart("a+b"), null, "a plus tag would hide the base address");
	assert.equal(normalizeProjectLocalPart("a b"), null);
	assert.equal(normalizeProjectLocalPart("a@b"), null);
	assert.equal(normalizeProjectLocalPart("x".repeat(65)), null);
	assert.equal(normalizeProjectLocalPart(42), null);
});

test("local parts that normalize alike on one domain conflict", () => {
	const existing = [{ domainId: "d1", localPart: "first.last", projectId: "other" }];
	assert.deepEqual(findLocalPartConflicts(existing, [{ domainId: "d1", localPart: "firstlast" }], "mine"), [{ domainId: "d1", localPart: "firstlast" }]);
	assert.deepEqual(findLocalPartConflicts(existing, [{ domainId: "d2", localPart: "firstlast" }], "mine"), []);
	assert.deepEqual(findLocalPartConflicts(existing, [{ domainId: "d1", localPart: "first.last" }], "other"), [], "the project's own rows are replaced, not conflicts");
	assert.deepEqual(findLocalPartConflicts([], [{ domainId: "d1", localPart: "a.b" }, { domainId: "d1", localPart: "ab" }], "mine"), [{ domainId: "d1", localPart: "ab" }], "duplicates inside one request");
});

test("a message's own address is the envelope recipient inbound, else the To/Cc list, and From outbound", () => {
	assert.deepEqual(messageOwnAddresses({ direction: "inbound", deliveredTo: "me@alpha.test", toAddr: "list@x.test", ccAddr: null, fromAddr: "a@b.test" }), ["me@alpha.test"]);
	assert.deepEqual(messageOwnAddresses({ direction: "inbound", deliveredTo: null, toAddr: "A <a@alpha.test>, b@beta.test", ccAddr: "c@gamma.test", fromAddr: "x@y.test" }), ["a@alpha.test", "b@beta.test", "c@gamma.test"]);
	assert.deepEqual(messageOwnAddresses({ direction: "outbound", deliveredTo: null, toAddr: "r@x.test", ccAddr: null, fromAddr: "Me <Me@Alpha.test>" }), ["me@alpha.test"]);
});
