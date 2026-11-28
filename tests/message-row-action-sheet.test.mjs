import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-row-sheet-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `export { getRowSheetActions, supportsRowSheet } from "./src/components/messages/message-row-action-sheet-utils.ts";`,
		resolveDir: root,
		sourcefile: "row-sheet-entry.ts",
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
const { getRowSheetActions, supportsRowSheet } = await import(pathToFileURL(join(directory, "entry.mjs")).href);

test("received mail offers archive, snooze, spam and trash", () => {
	const actions = getRowSheetActions({ status: "received", direction: "inbound", snoozed: false });
	assert.equal(actions.readToggle, true);
	assert.equal(actions.primaryMove, "archive");
	assert.equal(actions.snooze, "snooze");
	assert.equal(actions.reportSpam, true);
	assert.equal(actions.trash, true);
	assert.equal(actions.deleteForever, false);
	assert.deepEqual(actions.moveFolders, ["archive", "spam", "trash"]);
});

test("a snoozed message offers unsnooze", () => {
	assert.equal(getRowSheetActions({ status: "received", direction: "inbound", snoozed: true }).snooze, "unsnooze");
});

test("archived, spam and trash offer the way back instead of the same move", () => {
	assert.equal(getRowSheetActions({ status: "archived", direction: "inbound", snoozed: false }).primaryMove, "unarchive");
	const spam = getRowSheetActions({ status: "spam", direction: "inbound", snoozed: false });
	assert.equal(spam.primaryMove, "notSpam");
	assert.equal(spam.reportSpam, false);
	assert.equal(spam.readToggle, false);
	assert.equal(spam.deleteForever, true);
	assert.equal(spam.snooze, null);
	const trash = getRowSheetActions({ status: "trash", direction: "inbound", snoozed: false });
	assert.equal(trash.primaryMove, "restore");
	assert.equal(trash.trash, false);
	assert.equal(trash.deleteForever, true);
	assert.deepEqual(trash.moveFolders, ["inbox", "archive", "spam"]);
});

test("sent mail never gets an action that files it as received", () => {
	const sent = getRowSheetActions({ status: "sent", direction: "outbound", snoozed: false });
	assert.equal(sent.readToggle, false);
	assert.equal(sent.primaryMove, null);
	assert.equal(sent.snooze, null);
	assert.equal(sent.reportSpam, false);
	assert.equal(sent.trash, true);
	assert.deepEqual(sent.moveFolders, ["trash"]);
	const trashedSent = getRowSheetActions({ status: "trash", direction: "outbound", snoozed: false });
	assert.equal(trashedSent.primaryMove, null);
	assert.equal(trashedSent.deleteForever, true);
	assert.deepEqual(trashedSent.moveFolders, []);
});

test("drafts and scheduled sends keep their tap-only rows", () => {
	assert.equal(supportsRowSheet("inbox", "received"), true);
	assert.equal(supportsRowSheet("sent", "sent"), true);
	assert.equal(supportsRowSheet("drafts", "draft"), false);
	assert.equal(supportsRowSheet("scheduled", "sent"), false);
	assert.equal(supportsRowSheet("trash", "draft"), false);
});
