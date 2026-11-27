import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const script = join(root, "scripts/apply-install-config.mjs");
const { mergeInstallConfig, validateInstallConfig } = await import(pathToFileURL(script).href);
const work = mkdtempSync(join(tmpdir(), "mymailbox-install-config-"));
after(() => rmSync(work, { recursive: true, force: true }));

const generated = () => ({
	name: "mymailbox",
	keep_vars: true,
	vars: { VAPID_PUBLIC_KEY: "public-key" },
	d1_databases: [{ binding: "DB", database_name: "mymailbox" }],
});
const install = () => ({
	routes: [{ pattern: "mail.example.com", custom_domain: true }],
	vars: { APP_URL: "https://mail.example.com", VAPID_SUBJECT: "mailto:me@example.com" },
});

test("the install values are laid over the generated deploy config", () => {
	const base = generated();
	const merged = mergeInstallConfig(base, install());
	assert.deepEqual(merged.routes, [{ pattern: "mail.example.com", custom_domain: true }]);
	assert.deepEqual(merged.vars, { VAPID_PUBLIC_KEY: "public-key", APP_URL: "https://mail.example.com", VAPID_SUBJECT: "mailto:me@example.com" });
	assert.equal(merged.keep_vars, true);
	assert.deepEqual(merged.d1_databases, base.d1_databases);
	assert.deepEqual(base, generated(), "the generated config object is not changed");
});

test("an install without a custom domain keeps workers.dev and can say so explicitly", () => {
	const merged = mergeInstallConfig(generated(), { vars: { APP_URL: "https://mymailbox.someone.workers.dev" }, workers_dev: true });
	assert.equal(merged.workers_dev, true);
	assert.equal(merged.routes, undefined);
});

test("install values that would break sign-in, links or deploys are refused", () => {
	const problems = (value) => validateInstallConfig(value);
	assert.deepEqual(problems(install()), []);
	assert.match(problems({ routes: [] }).join(" "), /APP_URL/);
	assert.match(problems({ vars: { APP_URL: "http://mail.example.com" } }).join(" "), /https/);
	assert.match(problems({ vars: { APP_URL: "https://mail.example.com/app" } }).join(" "), /origin/);
	assert.match(problems({ ...install(), vars: { ...install().vars, VAPID_SUBJECT: "me@example.com" } }).join(" "), /VAPID_SUBJECT/);
	assert.match(problems({ ...install(), name: "other" }).join(" "), /name/);
	// Passkeys and reset links follow APP_URL, so it must be a host this Worker answers on.
	assert.match(problems({ routes: [{ pattern: "other.example.com", custom_domain: true }], vars: { APP_URL: "https://mail.example.com" } }).join(" "), /mail\.example\.com/);
	assert.deepEqual(problems({ routes: [{ pattern: "mail.example.com/*", zone_name: "example.com" }], vars: { APP_URL: "https://mail.example.com" } }), []);
	assert.match(problems({ ...install(), vars: { ...install().vars, PORT: 3 } }).join(" "), /string/);
	// No routes would quietly turn workers.dev on: say so with workers_dev, or list the domain.
	assert.match(problems({ vars: { APP_URL: "https://mail.example.com" } }).join(" "), /workers_dev/);
	assert.match(problems({ routes: [], vars: { APP_URL: "https://mail.example.com" } }).join(" "), /workers_dev/);
	assert.deepEqual(problems({ workers_dev: true, vars: { APP_URL: "https://mymailbox.someone.workers.dev" } }), []);
	assert.deepEqual(problems({ routes: [{ pattern: "*.example.com/*", zone_name: "example.com" }], vars: { APP_URL: "https://mail.example.com" } }), []);
	assert.match(problems({ routes: [{ pattern: "*.example.com/*", zone_name: "example.com" }], vars: { APP_URL: "https://example.org" } }).join(" "), /example\.org/);
});

function run(args, env = {}) {
	return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, MYMAILBOX_SKIP_INSTALL_CONFIG: "", ...env } });
}

test("the deploy step writes the merged config, and stops without an install file", () => {
	const configPath = join(work, "wrangler.json");
	const installPath = join(work, "wrangler.install.json");
	writeFileSync(configPath, JSON.stringify(generated()));

	const missing = run([configPath, installPath]);
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /wrangler\.install\.json/);
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), generated(), "nothing is written when it stops");

	const skipped = run([configPath, installPath], { MYMAILBOX_SKIP_INSTALL_CONFIG: "1" });
	assert.equal(skipped.status, 0);
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), generated());

	writeFileSync(installPath, JSON.stringify({ vars: { APP_URL: "ftp://mail.example.com" } }));
	const invalid = run([configPath, installPath]);
	assert.equal(invalid.status, 1);
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), generated());

	writeFileSync(installPath, JSON.stringify(install()));
	const applied = run([configPath, installPath]);
	assert.equal(applied.status, 0, applied.stderr);
	const written = JSON.parse(readFileSync(configPath, "utf8"));
	assert.equal(written.vars.APP_URL, "https://mail.example.com");
	assert.deepEqual(written.routes, install().routes);
	// The log names what changed without printing the values.
	assert.doesNotMatch(applied.stdout, /mail\.example\.com/);
});

test("the versioned files carry no installation values", () => {
	const wrangler = read("wrangler.jsonc");
	assert.doesNotMatch(wrangler, /"routes"\s*:/);
	assert.doesNotMatch(wrangler, /"APP_URL"\s*:/);
	assert.doesNotMatch(wrangler, /"VAPID_SUBJECT"\s*:/);
	assert.doesNotMatch(read("cloudflare-env.d.ts"), /APP_URL: "|VAPID_SUBJECT: "/);
	assert.match(read(".gitignore"), /^\/?wrangler\.install\.json$/m);
	assert.deepEqual(validateInstallConfig(JSON.parse(read("wrangler.install.example.json"))), []);

	const scripts = JSON.parse(read("package.json")).scripts;
	assert.match(scripts["deploy:worker"], /apply-install-config\.mjs && wrangler deploy/);
	assert.match(scripts.upload, /apply-install-config\.mjs && wrangler versions upload/);
});
