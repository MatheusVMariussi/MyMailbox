import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Avatars are resized in the browser. Chromium and Firefox encode WebP from a canvas; Safari cannot and
 * hands back PNG, so the client falls back to JPEG there. The server must accept both encodings, and only
 * when the bytes really are that format.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "avatar-formats-test-"));
await build({
	stdin: { contents: "export * from './src/lib/avatar-images.ts';", resolveDir: root, sourcefile: "avatar-formats-test.ts" },
	outfile: join(directory, "entry.mjs"),
	bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
});
const { getOptimizedAvatarFiles, storeAvatarImages } = await import(pathToFileURL(join(directory, "entry.mjs")).href);
after(() => rmSync(directory, { recursive: true, force: true }));

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

function form(full, preview) {
	const data = new FormData();
	data.set("file", full);
	data.set("preview", preview);
	return data;
}

test("WebP avatars are accepted as before", async () => {
	const files = await getOptimizedAvatarFiles(form(new File([WEBP], "avatar.webp", { type: "image/webp" }), new File([WEBP], "p.webp", { type: "image/webp" })));
	assert.ok(files);
	assert.equal(files.contentType, "image/webp");
});

test("JPEG avatars from browsers that cannot encode WebP are accepted", async () => {
	const files = await getOptimizedAvatarFiles(form(new File([JPEG], "avatar.jpg", { type: "image/jpeg" }), new File([JPEG], "p.jpg", { type: "image/jpeg" })));
	assert.ok(files);
	assert.equal(files.contentType, "image/jpeg");
});

test("other formats, mixed formats and bytes that do not match the declared type are refused", async () => {
	const png = await getOptimizedAvatarFiles(form(new File([PNG], "a.png", { type: "image/png" }), new File([PNG], "p.png", { type: "image/png" })));
	assert.equal(png, null);
	const mixed = await getOptimizedAvatarFiles(form(new File([WEBP], "a.webp", { type: "image/webp" }), new File([JPEG], "p.jpg", { type: "image/jpeg" })));
	assert.equal(mixed, null);
	const disguised = await getOptimizedAvatarFiles(form(new File([PNG], "a.jpg", { type: "image/jpeg" }), new File([PNG], "p.jpg", { type: "image/jpeg" })));
	assert.equal(disguised, null);
});

test("stored avatars keep the content type they were uploaded with", async () => {
	const puts = [];
	const bucket = { put: async (key, _body, options) => puts.push([key, options.httpMetadata.contentType]) };
	const files = await getOptimizedAvatarFiles(form(new File([JPEG], "avatar.jpg", { type: "image/jpeg" }), new File([JPEG], "p.jpg", { type: "image/jpeg" })));
	await storeAvatarImages(bucket, "avatars/u1", files.full, files.preview, files.contentType);
	assert.deepEqual(puts, [["avatars/u1:preview", "image/jpeg"], ["avatars/u1", "image/jpeg"]]);
});
