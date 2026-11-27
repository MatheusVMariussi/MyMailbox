import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-three-pane-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `export { getListNeighbours, getMessageDetailNavigationState } from "./src/components/messages/message-detail-navigation-utils.ts";
export { getReadingPanePath, toPathSegment, READING_PANE_HINTS } from "./src/components/messages/reading-pane-utils.ts";
export { hasCustomBranding, toWordmarkSegment } from "./src/components/wordmark-utils.ts";
export { SHORTCUT_CATALOG } from "./src/components/shortcuts/shortcut-catalog.ts";`,
		resolveDir: root,
		sourcefile: "three-pane-helpers-entry.ts",
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
const m = await import(pathToFileURL(join(directory, "entry.mjs")).href);
const en = (await import(pathToFileURL(join(root, "src/lib/i18n/en.json")).href, { with: { type: "json" } })).default;

const entries = [
	{ id: "a", unread: false },
	{ id: "b", unread: true },
	{ id: "c", unread: false },
];

test("j and k walk the list in the order it is shown, unlike the unread-first arrows", () => {
	assert.deepEqual(m.getListNeighbours(entries, "a"), { newerId: null, olderId: "b" });
	assert.deepEqual(m.getListNeighbours(entries, "b"), { newerId: "a", olderId: "c" });
	assert.deepEqual(m.getListNeighbours(entries, "c"), { newerId: "b", olderId: null });
	assert.deepEqual(m.getListNeighbours(entries, "missing"), { newerId: null, olderId: null });
	// The arrows put unread mail first, so from "a" they would skip to "c".
	assert.equal(m.getMessageDetailNavigationState(entries, "a").nextId, "c");
});

test("the empty reading pane names the folder as a shell path", () => {
	assert.equal(m.getReadingPanePath(["inbox"]), "mymailbox/inbox");
	assert.equal(m.getReadingPanePath(["Acme Corp", "labels", "Clientes VIP"]), "mymailbox/acme-corp/labels/clientes-vip");
	assert.equal(m.toPathSegment("Ação & Reunião"), "acao-reuniao");
	assert.equal(m.toPathSegment("!!!"), "mail");
});

test("the wordmark gives way to a custom branding name or icon", () => {
	assert.equal(m.toWordmarkSegment("MyMailbox"), "mymailbox");
	assert.equal(m.toWordmarkSegment("Caixa Postal"), "caixa-postal");
	assert.equal(m.hasCustomBranding({ appName: "MyMailbox", hasCustomIcon: false }), false);
	assert.equal(m.hasCustomBranding({ appName: "Acme Mail", hasCustomIcon: false }), true);
	assert.equal(m.hasCustomBranding({ appName: "MyMailbox", hasCustomIcon: true }), true);
});

test("every shortcut in the help catalogue and the empty-pane hints has an English label", () => {
	for (const group of m.SHORTCUT_CATALOG) {
		assert.ok(typeof en[`shortcut.category.${group.category}`] === "string", group.category);
		for (const entry of group.entries) {
			assert.ok(typeof en[entry.labelKey] === "string", entry.labelKey);
			assert.ok(entry.keys.length > 0, entry.labelKey);
		}
	}
	for (const hint of m.READING_PANE_HINTS) assert.ok(typeof en[hint.labelKey] === "string", hint.labelKey);
});

test("the catalogue covers the Gmail set the client answers", () => {
	const keys = m.SHORTCUT_CATALOG.flatMap((group) => group.entries.flatMap((entry) => entry.keys.map((key) => (key.chord ?? key.sequence).join(key.sequence ? " " : "+"))));
	for (const key of ["j", "k", "o", "Enter", "u", "e", "#", "!", "s", "x", "r", "a", "f", "c", "/", "l", "v", "Shift+I", "Shift+U", "z", "g i", "g s", "g t", "g d", "g a", "?"]) {
		assert.ok(keys.includes(key), key);
	}
});
