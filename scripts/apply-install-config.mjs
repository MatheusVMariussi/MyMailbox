// Lays this installation's own values over the deploy config the build generated, so the public
// wrangler.jsonc never names a production host. `npm run deploy` and `npm run upload` run it after the build:
//
//   node scripts/apply-install-config.mjs [generatedConfig] [installFile]
//
// generatedConfig defaults to dist/server/wrangler.json (where the Cloudflare Vite plugin points Wrangler) and
// installFile to wrangler.install.json (gitignored; start from wrangler.install.example.json). It holds the
// custom domain (`routes`), `vars` such as APP_URL and VAPID_SUBJECT, and optionally `workers_dev` and
// `preview_urls`. Without the file the deploy stops, because a deploy without routes turns workers.dev on
// and one without APP_URL would rely on whatever the dashboard holds. Set MYMAILBOX_SKIP_INSTALL_CONFIG=1
// to deploy with the values kept in the Cloudflare dashboard instead (`keep_vars` keeps them).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_KEYS = new Set(["routes", "vars", "workers_dev", "preview_urls"]);

/** The host a route pattern serves (`mail.example.com/*` → `mail.example.com`, `*.example.com/*` → `*.example.com`). */
function routeHost(route) {
	const pattern = typeof route === "string" ? route : route?.pattern;
	if (typeof pattern !== "string") return null;
	return pattern.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
}

/** Whether a route host serves `hostname`; a leading `*` matches any prefix, as in Cloudflare route patterns. */
function hostServes(routeHostname, hostname) {
	return routeHostname.startsWith("*") ? hostname.endsWith(routeHostname.slice(1)) : routeHostname === hostname;
}

/** Problems with an install file, as sentences; an empty list means it can be applied. */
export function validateInstallConfig(install) {
	if (!install || typeof install !== "object" || Array.isArray(install)) return ["The install file must hold a JSON object."];
	const problems = [];
	for (const key of Object.keys(install)) {
		if (!ALLOWED_KEYS.has(key)) problems.push(`"${key}" is not an install value; only ${[...ALLOWED_KEYS].join(", ")} are.`);
	}
	if (install.routes !== undefined && !Array.isArray(install.routes)) problems.push(`"routes" must be a list.`);
	// Without routes Wrangler turns workers.dev on; make that a decision written down, not an accident.
	const hasRoutes = Array.isArray(install.routes) && install.routes.length > 0;
	if (!hasRoutes && typeof install.workers_dev !== "boolean") {
		problems.push(`No routes: list the custom domain in "routes", or set "workers_dev": true to deploy on workers.dev.`);
	}
	for (const key of ["workers_dev", "preview_urls"]) {
		if (install[key] !== undefined && typeof install[key] !== "boolean") problems.push(`"${key}" must be true or false.`);
	}
	const vars = install.vars ?? {};
	if (typeof vars !== "object" || Array.isArray(vars)) return [...problems, `"vars" must be an object.`];
	for (const [name, value] of Object.entries(vars)) {
		if (typeof value !== "string") problems.push(`vars.${name} must be a string.`);
	}

	const appUrl = vars.APP_URL;
	if (typeof appUrl !== "string" || !appUrl) {
		problems.push("vars.APP_URL is required: passkeys, password reset links and download links use it.");
	} else {
		let url = null;
		try {
			url = new URL(appUrl);
		} catch {
			problems.push("vars.APP_URL is not a URL.");
		}
		if (url && url.protocol !== "https:") problems.push("vars.APP_URL must use https.");
		if (url && (url.origin !== appUrl.replace(/\/$/, "") || url.pathname !== "/")) problems.push("vars.APP_URL must be an origin, without a path, query or fragment.");
		const hosts = (Array.isArray(install.routes) ? install.routes : []).map(routeHost).filter(Boolean);
		if (url && hosts.length > 0 && !hosts.some((host) => hostServes(host, url.hostname.toLowerCase()))) {
			problems.push(`vars.APP_URL points at ${url.hostname}, which none of the routes serves.`);
		}
	}
	const subject = vars.VAPID_SUBJECT;
	if (subject !== undefined && (typeof subject !== "string" || !/^(mailto:|https:\/\/)/.test(subject))) {
		problems.push("vars.VAPID_SUBJECT must be a mailto: address or an https:// URL.");
	}
	return problems;
}

/** The generated config with the install values laid over it; neither input is changed. */
export function mergeInstallConfig(generated, install) {
	const merged = { ...generated, vars: { ...(generated.vars ?? {}), ...(install.vars ?? {}) } };
	if (install.routes !== undefined) merged.routes = install.routes.map((route) => (typeof route === "string" ? route : { ...route }));
	if (install.workers_dev !== undefined) merged.workers_dev = install.workers_dev;
	if (install.preview_urls !== undefined) merged.preview_urls = install.preview_urls;
	return merged;
}

function main() {
	const configPath = resolve(process.argv[2] ?? "dist/server/wrangler.json");
	const installPath = resolve(process.argv[3] ?? process.env.MYMAILBOX_INSTALL_CONFIG ?? "wrangler.install.json");

	if (process.env.MYMAILBOX_SKIP_INSTALL_CONFIG === "1") {
		console.log("Install config skipped (MYMAILBOX_SKIP_INSTALL_CONFIG=1): deploying with the values kept in the Cloudflare dashboard.");
		return 0;
	}
	if (!existsSync(installPath)) {
		console.error(`Missing ${installPath}.`);
		console.error("Copy wrangler.install.example.json to wrangler.install.json and fill in this installation's domain and APP_URL,");
		console.error("or set MYMAILBOX_SKIP_INSTALL_CONFIG=1 to deploy with the values kept in the Cloudflare dashboard.");
		return 1;
	}
	if (!existsSync(configPath)) {
		console.error(`Missing ${configPath}: run the build first.`);
		return 1;
	}

	let install;
	try {
		install = JSON.parse(readFileSync(installPath, "utf8"));
	} catch (error) {
		console.error(`${installPath} is not valid JSON: ${error instanceof Error ? error.message : error}`);
		return 1;
	}
	const problems = validateInstallConfig(install);
	if (problems.length > 0) {
		console.error(`${installPath} cannot be applied:`);
		for (const problem of problems) console.error(`  - ${problem}`);
		return 1;
	}

	const generated = JSON.parse(readFileSync(configPath, "utf8"));
	writeFileSync(configPath, `${JSON.stringify(mergeInstallConfig(generated, install), null, 2)}\n`);
	// Names only: the values are this installation's and need not land in a CI log.
	const applied = [
		install.routes ? `routes (${install.routes.length})` : null,
		...Object.keys(install.vars ?? {}).map((name) => `vars.${name}`),
		install.workers_dev !== undefined ? "workers_dev" : null,
		install.preview_urls !== undefined ? "preview_urls" : null,
	].filter(Boolean);
	console.log(`Applied ${applied.join(", ")} from ${installPath}.`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
