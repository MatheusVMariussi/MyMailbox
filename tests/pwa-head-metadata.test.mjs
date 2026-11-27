import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mymailbox-pwa-head-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: [join(root, "next.config.ts")],
	outfile: join(outDir, "next-config.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
});
const { default: nextConfig } = await import(pathToFileURL(join(outDir, "next-config.mjs")).href);
const { shouldServeStreamingMetadata } = await import(pathToFileURL(join(root, "node_modules/vinext/dist/server/streaming-metadata.js")).href);

const userAgents = {
	"iOS Safari": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
	"iOS home-screen web app": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
	"Chrome on Android": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
	"desktop Firefox": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:140.0) Gecko/20100101 Firefox/140.0",
};

// iOS reads <link rel="manifest"> and the web-app metas only from <head>: streamed into <body>, a Home Screen
// install falls back to a web app with browser controls (address bar, back, share, open in Safari).
test("every browser gets the manifest and web-app metadata in the document head", () => {
	assert.ok(nextConfig.htmlLimitedBots, "next.config sets htmlLimitedBots");
	const source = nextConfig.htmlLimitedBots instanceof RegExp ? nextConfig.htmlLimitedBots.source : nextConfig.htmlLimitedBots;
	for (const [name, userAgent] of Object.entries(userAgents)) {
		assert.equal(shouldServeStreamingMetadata(userAgent, source), false, `${name} gets blocking metadata`);
	}
});

test("the root layout still declares the legacy iOS web-app meta", () => {
	const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
	assert.match(layout, /"apple-mobile-web-app-capable": "yes"/);
});
