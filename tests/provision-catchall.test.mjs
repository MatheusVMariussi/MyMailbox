import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("enabling Email Routing always binds the Worker catch-all afterwards, exactly once (issue #42)", () => {
	for (const file of ["src/lib/domains/provision.ts", "src/lib/domains/dns-setup.ts"]) {
		const src = stripComments(read(file));
		const enable = src.indexOf("await enableEmailRouting(");
		const call = "ensureEmailRoutingCatchAllToWorker(env, ";
		const bind = src.indexOf(`await ${call}`);
		assert.notEqual(enable, -1, `${file} enables Email Routing`);
		assert.ok(bind > enable, `${file} binds the catch-all after enabling routing`);
		assert.equal(src.indexOf(call, bind + `await ${call}`.length), -1, `${file} binds it once`);
	}
});

test("the catch-all helper is the one place that PUTs the Worker rule", () => {
	const catchAll = read("src/lib/domains/catch-all-routing.ts");
	assert.match(catchAll, /export async function ensureEmailRoutingCatchAllToWorker/);
});
