import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("", { url: "https://mail.example/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
const bundle = await build({
	entryPoints: ["src/components/compose/rich-text-utils.ts"],
	bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent",
	alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const { joinQuotedHtml, splitQuotedHtml, wrapQuotedHtml } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("quoted content is wrapped with the MyMailbox marker and splits back", () => {
	const html = joinQuotedHtml("<p>Reply</p>", "<p>Original</p>");
	assert.equal(html, '<p>Reply</p><div class="mymailbox-quote" data-mymailbox-quote="1"><p>Original</p></div>');
	assert.deepEqual(splitQuotedHtml(html), { body: "<p>Reply</p>", quoted: "<p>Original</p>" });
	assert.deepEqual(splitQuotedHtml("<p>No quote</p>"), { body: "<p>No quote</p>", quoted: null });
});

test("mail composed by upstream Mailflare still folds its quote", () => {
	const legacy = '<p>Reply</p><div class="mailflare-quote" data-mailflare-quote="1"><p>Original</p></div>';
	assert.deepEqual(splitQuotedHtml(legacy), { body: "<p>Reply</p>", quoted: "<p>Original</p>" });
});

test("the outermost quote wins when both markers are nested", () => {
	const mailflareInside = `<p>New</p>${wrapQuotedHtml('<p>Old</p><div class="mailflare-quote" data-mailflare-quote="1"><p>Oldest</p></div>')}`;
	assert.deepEqual(splitQuotedHtml(mailflareInside), { body: "<p>New</p>", quoted: '<p>Old</p><div class="mailflare-quote" data-mailflare-quote="1"><p>Oldest</p></div>' });
	const mailflareOutside = `<p>New</p><div class="mailflare-quote" data-mailflare-quote="1"><p>Old</p>${wrapQuotedHtml("<p>Oldest</p>")}</div>`;
	assert.deepEqual(splitQuotedHtml(mailflareOutside), { body: "<p>New</p>", quoted: `<p>Old</p>${wrapQuotedHtml("<p>Oldest</p>")}` });
});
