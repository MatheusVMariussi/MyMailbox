import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const outDir = mkdtempSync(join(tmpdir(), "mymailbox-domains-outside-admin-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: [
			`export { visibleSettingsNavSections } from "./src/components/settings/settings-nav-utils";`,
			`export { withWholeDomain } from "./src/lib/projects/project-utils";`,
		].join("\n"),
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
});
const lib = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

const user = (overrides = {}) => ({ role: "user", isPrimaryAdmin: false, canManageDomains: false, canManageMailboxes: false, ...overrides });
const hrefs = (account) => lib.visibleSettingsNavSections(account).flatMap((section) => section.items.map((item) => item.href));

test("Settings lists Domains for the admins the Admin area lets manage domains", () => {
	assert.ok(hrefs(user({ role: "admin", isPrimaryAdmin: true })).includes("/settings/domains"));
	assert.ok(hrefs(user({ role: "admin", canManageDomains: true })).includes("/settings/domains"));
	assert.ok(!hrefs(user({ role: "admin" })).includes("/settings/domains"));
	// The flag alone is not enough: Admin requires the admin role too.
	assert.ok(!hrefs(user({ canManageDomains: true })).includes("/settings/domains"));
	assert.ok(!hrefs(null).includes("/settings/domains"));
});

test("the mailbox entry keeps following its own permission", () => {
	assert.ok(hrefs(user({ canManageMailboxes: true })).includes("/settings/mailboxes"));
	assert.ok(!hrefs(user()).includes("/settings/mailboxes"));
	assert.ok(hrefs(user()).includes("/settings/projects"));
});

test("a new domain joins the project as a whole-domain mapping next to what it already owns", () => {
	const existing = [{ domainId: "d1", localPart: "" }, { domainId: "d2", localPart: "sales" }];
	assert.deepEqual(lib.withWholeDomain(existing, "d3"), [...existing, { domainId: "d3", localPart: "" }]);
	// Mapping it twice changes nothing, and a specific address on that domain stays.
	assert.deepEqual(lib.withWholeDomain(existing, "d1"), existing);
	assert.deepEqual(lib.withWholeDomain([{ domainId: "d3", localPart: "news" }], "d3"), [{ domainId: "d3", localPart: "news" }, { domainId: "d3", localPart: "" }]);
	assert.equal(existing.length, 2, "the input is not changed");
});

test("Settings → Domains is the Admin page behind the same permission", () => {
	const page = read("src/app/(settings)/settings/domains/page.tsx");
	assert.match(page, /from "@\/app\/\(admin\)\/domains\/page"/);
	assert.match(page, /canManageDomains\(/);
});

test("Admin and projects add domains through one dialog that refreshes mailboxes", () => {
	const dialog = read("src/app/(admin)/domains/AddDomainDialog.tsx");
	assert.ok(dialog.includes("createDomain("), "the dialog provisions through the domains API");
	assert.ok(dialog.includes("notifyMailboxesChanged()"), "a new domain changes sender addresses");
	assert.match(read("src/app/(admin)/domains/page.tsx"), /<AddDomainDialog\b/);

	const card = read("src/components/projects/project-card.tsx");
	assert.match(card, /<AddDomainDialog\b/);
	assert.ok(card.includes("withWholeDomain("), "the new domain is mapped whole");
	assert.ok(card.includes("restampProjectMessages("), "stored mail follows the new mapping");
	assert.match(card, /canManageDomains\(/, "the button follows the Admin permission");
	assert.ok(card.includes("CF_TOKEN"), "the dialog says the zone must be in the token");
});

test("the new copy exists in English and Brazilian Portuguese without dashes or exclamation marks", () => {
	const en = JSON.parse(read("src/lib/i18n/en.json"));
	const pt = JSON.parse(read("public/locales/pt-BR.json"));
	for (const key of ["settings.nav.domains", "projects.addDomain", "projects.addDomainDescription", "projects.addDomainToken", "projects.domainMapped", "projects.domainMapFailed"]) {
		for (const [name, catalog] of [["en", en], ["pt-BR", pt]]) {
			assert.equal(typeof catalog[key], "string", `${key} in ${name}`);
			assert.doesNotMatch(catalog[key], /[—–!]/, `${key} in ${name}`);
		}
	}
});
