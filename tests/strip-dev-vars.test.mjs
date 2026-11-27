import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The Cloudflare Vite plugin copies .dev.vars (local secrets) into the build output for `vite preview`.
 * Wrangler does not upload it, but the build that gets deployed must not carry it either.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "strip-dev-vars-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("the strip script removes local secret files from every build output directory", () => {
	const dist = join(directory, "dist");
	for (const sub of ["server", "client", "other"]) mkdirSync(join(dist, sub), { recursive: true });
	writeFileSync(join(dist, "server", ".dev.vars"), "CF_TOKEN=secret\n");
	writeFileSync(join(dist, "server", ".dev.vars.production"), "CF_TOKEN=secret\n");
	writeFileSync(join(dist, "other", ".env"), "CF_TOKEN=secret\n");
	writeFileSync(join(dist, "server", "index.js"), "export default {};\n");
	writeFileSync(join(dist, "client", ".assetsignore"), "wrangler.json\n.dev.vars\n");
	const result = spawnSync(process.execPath, [join(root, "scripts", "strip-dev-vars.mjs"), dist], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(existsSync(join(dist, "server", ".dev.vars")), false);
	assert.equal(existsSync(join(dist, "server", ".dev.vars.production")), false);
	assert.equal(existsSync(join(dist, "other", ".env")), false);
	assert.equal(existsSync(join(dist, "server", "index.js")), true);
	assert.equal(existsSync(join(dist, "client", ".assetsignore")), true);
});

test("deploying and uploading strip local secrets before Wrangler runs", () => {
	const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	for (const name of ["deploy:worker", "upload"]) {
		const script = scripts[name];
		assert.ok(script.includes("scripts/strip-dev-vars.mjs"), `${name}: ${script}`);
		assert.ok(script.indexOf("scripts/strip-dev-vars.mjs") < script.indexOf("wrangler "), `${name} strips before Wrangler`);
	}
});
