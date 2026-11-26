import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { installDom, loadComponent } from "./helpers/dom-component.mjs";

// The list scope (unified inbox by default, one mailbox, optional project) is separate from the mailbox
// selection that settings and the composer use: composing or replying never changes what the lists show.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-project-list-scope-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export * from "./src/components/list-scope-utils.ts";
			export * from "./src/components/compose/composer-sender-utils.ts";
			export * from "./src/components/projects/projects-nav-utils.ts";
			export * from "./src/lib/labels/group-utils.ts";
			export { getListMembershipContext, messageMatchesFolder } from "./src/lib/messages/list-membership.ts";
		`,
		resolveDir: root,
		sourcefile: "project-list-scope-entry.ts",
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

test("the list scope defaults to every mailbox and drops a mailbox or project the user no longer has", () => {
	assert.deepEqual(m.parseListScope(null), { mailboxId: null, projectId: null });
	assert.deepEqual(m.parseListScope("not json"), { mailboxId: null, projectId: null });
	assert.deepEqual(m.parseListScope(JSON.stringify({ mailboxId: "mb-a", projectId: 7 })), { mailboxId: "mb-a", projectId: null });
	const stored = { mailboxId: "mb-gone", projectId: "p-1" };
	assert.deepEqual(m.resolveListScope(stored, null, null), stored, "trusted while the lists load");
	assert.deepEqual(m.resolveListScope(stored, ["mb-a"], ["p-1"]), { mailboxId: null, projectId: "p-1" });
	assert.deepEqual(m.resolveListScope(stored, ["mb-gone"], []), { mailboxId: "mb-gone", projectId: null });
	assert.notEqual(m.listScopeKey({ mailboxId: null, projectId: "p" }), m.listScopeKey({ mailboxId: null, projectId: null }));
});

const options = [
	{ mailboxId: "mb-a", address: "me@alpha.test" },
	{ mailboxId: "mb-a", address: "me@beta.test" },
	{ mailboxId: "mb-b", address: "sales@beta.test" },
];
const mappings = [
	{ projectId: "p-alpha", hostname: "alpha.test", localPart: "" },
	{ projectId: "p-beta", hostname: "beta.test", localPart: "" },
	{ projectId: "p-sales", hostname: "beta.test", localPart: "sales" },
];

test("new mail starts from the active project's first sender option", () => {
	assert.deepEqual(m.pickComposerSender(options, { projectId: "p-beta", mappings, preferredMailboxId: "mb-b" }), options[1]);
	assert.deepEqual(m.pickComposerSender(options, { projectId: "p-sales", mappings }), options[2]);
	assert.deepEqual(m.pickComposerSender(options, { projectId: "p-none", mappings, preferredMailboxId: "mb-b" }), options[2]);
	assert.deepEqual(m.pickComposerSender(options, { preferredMailboxId: null }), options[0]);
	assert.equal(m.pickComposerSender([], {}), null);
});

test("a reply draft keeps its own mailbox and From whatever the project filter", () => {
	assert.deepEqual(m.pickComposerSender(options, { draftMailboxId: "mb-a", draftFrom: "ME@beta.test", projectId: "p-sales", mappings }), options[1]);
	assert.deepEqual(m.pickComposerSender(options, { draftMailboxId: "mb-b", draftFrom: "gone@beta.test" }), options[2]);
});

test("the composer keeps its own sender and never writes the global mailbox selection", () => {
	const source = readFileSync(join(root, "src/components/compose/compose-form.tsx"), "utf8");
	assert.ok(!source.includes("setSelectedMailbox"), "compose-form.tsx must not call setSelectedMailbox");
});

test("same-named labels group into one filter, and a grouped view matches mail carrying any of them", () => {
	const groups = m.groupLabelsByName([
		{ id: "l-a", mailboxId: "mb-a", name: "Clients", color: "#2563eb" },
		{ id: "l-b", mailboxId: "mb-b", name: "Clients", color: "#16a34a" },
		{ id: "l-c", mailboxId: "mb-a", name: "Travel", color: "#dc2626" },
	]);
	assert.deepEqual(groups.map((group) => [group.name, group.filter, group.color]), [["Clients", "l-a,l-b", "#2563eb"], ["Travel", "l-c", "#dc2626"]]);
	assert.equal(m.indexLabelGroups(groups).get("l-b").id, "l-a");
	assert.deepEqual(m.sumLabelCounts("l-a,l-b", { "l-a": { total: 2, unread: 1 }, "l-b": { total: 3, unread: 0 } }), { total: 5, unread: 1 });
	assert.equal(m.sumLabelCounts("l-z", { "l-a": { total: 2, unread: 1 } }), undefined);
	assert.equal(m.decodeLabelSegment("l-a%2Cl-b"), "l-a,l-b");
	const context = m.getListMembershipContext("labelId=l-a%2Cl-b");
	assert.equal(context.labelId, "l-a,l-b");
	assert.equal(m.messageMatchesFolder({ status: "archived", starred: false, snoozedUntil: null, labelIds: ["l-b"] }, context.folder, context.labelId), true);
	assert.equal(m.messageMatchesFolder({ status: "archived", starred: false, snoozedUntil: null, labelIds: ["l-c"] }, context.folder, context.labelId), false);
});

test("changing the project filter keeps the open list and leaves a reader for its list", () => {
	assert.equal(m.listRootFor("/sent"), "/sent");
	assert.equal(m.listRootFor("/inbox/msg_123"), "/inbox");
	assert.equal(m.listRootFor("/labels/l-a,l-b/msg_1"), "/labels/l-a,l-b");
	assert.equal(m.listRootFor("/settings/projects"), "/inbox");
	assert.equal(m.listRootFor("/contacts"), "/inbox");
});

test("selecting a mailbox for settings or compose leaves the list scope alone", async (t) => {
	installDom();
	// The scope lives in localStorage, as in the browser.
	Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true, writable: true });
	const { createElement, act, useEffect } = await import("react");
	const { createRoot } = await import("react-dom/client");
	const mailboxes = [{ id: "mb-a", domainId: "d", localPart: "me", hostname: "alpha.test", displayName: null }, { id: "mb-b", domainId: "d", localPart: "team", hostname: "alpha.test", displayName: null }];
	const { ListScopeProvider, useListScope } = await loadComponent("src/components/list-scope-provider.tsx", {
		"./mailbox-provider": `
			import React from "react";
			const Context = React.createContext(null);
			export function MailboxStub({ children }) {
				const [selectedMailbox, setSelectedMailbox] = React.useState(null);
				return React.createElement(Context.Provider, { value: { selectedMailbox, setSelectedMailbox, mailboxes: ${JSON.stringify(mailboxes)}, isLoading: false } }, children);
			}
			export function useSelectedMailbox() { return React.useContext(Context); }
			globalThis.__listScopeMailboxStub = { MailboxStub, useSelectedMailbox };
		`,
		"./projects/use-projects": `export function useProjects() { return { projects: [{ id: "p-1", name: "One", color: "#4f8cff", sortOrder: 0, addresses: [] }], domains: [], isLoading: false }; }`,
	});
	const { MailboxStub, useSelectedMailbox } = globalThis.__listScopeMailboxStub;
	const probe = { current: null };
	function Probe() {
		const scope = useListScope();
		const mailbox = useSelectedMailbox();
		useEffect(() => { probe.current = { scope, mailbox }; });
		return createElement("output", null, `${scope.mailboxId ?? "all"}|${scope.projectId ?? "-"}`);
	}
	const container = document.createElement("div");
	document.body.appendChild(container);
	const reactRoot = createRoot(container);
	t.after(async () => { await act(async () => reactRoot.unmount()); container.remove(); window.localStorage.clear(); });
	await act(async () => { reactRoot.render(createElement(MailboxStub, null, createElement(ListScopeProvider, null, createElement(Probe)))); });
	assert.equal(container.textContent, "all|-", "the unified inbox is the default");
	await act(async () => { probe.current.mailbox.setSelectedMailbox(mailboxes[1]); });
	assert.equal(container.textContent, "all|-", "a composer or settings selection does not narrow the lists");
	await act(async () => { probe.current.scope.setProjectFilter("p-1"); });
	assert.equal(container.textContent, "all|p-1");
	await act(async () => { probe.current.scope.setMailboxScope("mb-a"); });
	assert.equal(container.textContent, "mb-a|p-1");
	await act(async () => { probe.current.scope.setMailboxScope(null); probe.current.scope.setProjectFilter(null); });
	assert.equal(container.textContent, "all|-");
});
