// The Cloudflare Vite plugin copies .dev.vars (local secrets such as CF_TOKEN) into the build output
// (dist/<worker>/.dev.vars) so that `vite preview` can read them. Wrangler does not upload that file,
// but a build that is deployed or handed around must not carry it: `npm run deploy` and `npm run upload`
// run this first. Usage: node scripts/strip-dev-vars.mjs [distDirectory]
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve(process.argv[2] ?? "dist");
const isLocalSecretFile = (name) => name === ".dev.vars" || name.startsWith(".dev.vars.") || name === ".env" || name.startsWith(".env.");

function strip(directory) {
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) {
			// Only the top level of each output directory holds these files; skip the bundles' asset trees.
			if (directory === dist) strip(path);
			continue;
		}
		if (isLocalSecretFile(name)) {
			rmSync(path, { force: true });
			console.log(`Removed ${path}`);
		}
	}
}

if (existsSync(dist)) strip(dist);
