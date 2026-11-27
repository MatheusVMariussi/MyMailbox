import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(project, file), "utf8");
const directory = mkdtempSync(join(project, "node_modules", "mailbox-provider-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));

const authMock = [
	"export const AUTH_SESSION_CHANGED_EVENT='mailbox-test-session-changed';",
	"export function getClientSessionKey(){return 'session'}",
	"export function authFetch(url){return globalThis.mailboxResponse(url)}",
].join("");

await build({
	stdin: {
		contents: [
			`export { MailboxProvider, useSelectedMailbox } from "./src/components/mailbox-provider";`,
			`export { notifyMailboxesChanged, MAILBOXES_CHANGED_EVENT } from "./src/components/mailbox-provider-utils";`,
		].join("\n"),
		resolveDir: project,
		loader: "ts",
	},
	outfile: join(directory, "provider.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	jsx: "automatic",
	alias: { "@": join(project, "src") },
	plugins: [{
		name: "mailbox-test-auth",
		setup(builder) {
			builder.onResolve({ filter: /^@\/lib\/auth\/client$/ }, () => ({ path: "auth", namespace: "mock" }));
			builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: authMock, loader: "js" }));
		},
	}],
	logLevel: "silent",
});

const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MailboxProvider, useSelectedMailbox, notifyMailboxesChanged, MAILBOXES_CHANGED_EVENT } = await import(pathToFileURL(join(directory, "provider.mjs")).href);

const mailbox = (id, extra = {}) => ({ id, domainId: "d1", localPart: id, hostname: "example.com", displayName: id, type: "personal", ...extra });
let listed = [];
let requests = 0;
let failing = false;
globalThis.mailboxResponse = async () => {
	requests += 1;
	if (failing) return { ok: false, status: 503, json: async () => ({ error: "Unavailable" }) };
	return { ok: true, json: async () => ({ mailboxes: listed }) };
};

function Probe() {
	const { selectedMailbox, mailboxes, isLoading } = useSelectedMailbox();
	if (isLoading) return createElement("p", null, "loading");
	return createElement("p", null, `${mailboxes.length}:${selectedMailbox?.id ?? "none"}`);
}

async function mount() {
	const root = createRoot(document.getElementById("root"));
	await act(async () => root.render(createElement(MailboxProvider, null, createElement(Probe))));
	return root;
}

test("creating the first mailbox reaches a provider that already loaded an empty list", async () => {
	localStorage.clear();
	listed = [];
	notifyMailboxesChanged();
	const root = await mount();
	assert.equal(document.body.textContent, "0:none");

	listed = [mailbox("me", { isPrimary: true })];
	await act(async () => notifyMailboxesChanged());
	assert.equal(document.body.textContent, "1:me");
	assert.equal(localStorage.getItem("selected-mailbox-id"), "me");
	await act(async () => root.unmount());
});

test("a provider mounted after the change does not reuse the empty cached list", async () => {
	localStorage.clear();
	listed = [];
	notifyMailboxesChanged();
	const first = await mount();
	assert.equal(document.body.textContent, "0:none");
	await act(async () => first.unmount());

	// Onboarding lives outside the dashboard layouts, so no provider is mounted when it creates the mailbox.
	listed = [mailbox("me", { isPrimary: true })];
	notifyMailboxesChanged();
	const second = await mount();
	assert.equal(document.body.textContent, "1:me");
	await act(async () => second.unmount());
});

test("a reload keeps the mailbox the user picked while it still exists", async () => {
	localStorage.clear();
	listed = [mailbox("me", { isPrimary: true }), mailbox("team", { type: "shared" })];
	notifyMailboxesChanged();
	localStorage.setItem("selected-mailbox-id", "team");
	const root = await mount();
	assert.equal(document.body.textContent, "2:team");

	listed = [...listed, mailbox("new")];
	await act(async () => notifyMailboxesChanged());
	assert.equal(document.body.textContent, "3:team");

	// Removing the selected mailbox falls back to the primary one.
	listed = listed.filter((item) => item.id !== "team");
	await act(async () => notifyMailboxesChanged());
	assert.equal(document.body.textContent, "2:me");
	assert.equal(localStorage.getItem("selected-mailbox-id"), "me");
	await act(async () => root.unmount());
});

test("a failed reload keeps the list and the selection instead of emptying them", async () => {
	localStorage.clear();
	listed = [mailbox("me", { isPrimary: true })];
	notifyMailboxesChanged();
	const root = await mount();
	assert.equal(document.body.textContent, "1:me");
	failing = true;
	await act(async () => notifyMailboxesChanged());
	failing = false;
	assert.equal(document.body.textContent, "1:me");
	await act(async () => root.unmount());
});

test("the change event always refetches instead of reading the cache", async () => {
	localStorage.clear();
	listed = [mailbox("me", { isPrimary: true })];
	notifyMailboxesChanged();
	const root = await mount();
	const before = requests;
	await act(async () => window.dispatchEvent(new dom.window.Event(MAILBOXES_CHANGED_EVENT)));
	assert.equal(requests, before + 1);
	await act(async () => root.unmount());
});

test("every screen that adds or removes mailboxes or domains tells the provider", () => {
	const callers = [
		"src/app/(auth)/onboarding/onboarding-client.tsx",
		"src/app/(admin)/mailboxes/page.tsx",
		"src/app/(admin)/accounts/[id]/utils.ts",
	];
	for (const file of callers) assert.ok(read(file).includes("notifyMailboxesChanged()"), `${file} calls notifyMailboxesChanged()`);
});
