import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mymailbox-attachment-limits-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
		alias: { "@": join(root, "src") },
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const { DEFAULT_OUTBOUND_ATTACHMENT_MAX_MB, OUTBOUND_ATTACHMENT_CEILING_MB, clampOutboundAttachmentMb, outgoingSizeError, requestBodyLimit, planAttachmentDelivery } = await bundle("src/lib/email/attachment-limits.ts", "limits.mjs");
const { sharedFileNotice } = await bundle("src/lib/email/shared-file-notice.ts", "notice.mjs");

const MB = 1_000_000;

test("the default limit and the Workers ceiling are both 25 MB", () => {
	assert.equal(DEFAULT_OUTBOUND_ATTACHMENT_MAX_MB, 25);
	assert.equal(OUTBOUND_ATTACHMENT_CEILING_MB, 25);
});

test("outgoing size limit: each file and the total stay within the administrator's setting", () => {
	assert.equal(outgoingSizeError([25 * MB], 25), null);
	assert.match(outgoingSizeError([25 * MB + 1], 25), /25 MB/);
	assert.match(outgoingSizeError([15 * MB, 15 * MB], 25), /25 MB/);
	assert.equal(outgoingSizeError([40 * MB], 50), null);
	assert.match(outgoingSizeError([51 * MB], 50), /50 MB/);
	assert.equal(outgoingSizeError([], 25), null);
});

test("request bodies keep the 30 MiB cap at the default and grow with a raised limit", () => {
	assert.equal(requestBodyLimit(25), 30 * 1024 * 1024);
	assert.ok(requestBodyLimit(50) >= (50 * MB * 4) / 3, "room for a base64 JSON body of the largest allowed file");
});

test("Cloudflare sends files over 3 MB, or past the 5 MiB message cap, as links", () => {
	assert.deepEqual(planAttachmentDelivery("cloudflare", [2 * MB, 4 * MB], 10_000), [false, true]);
	assert.deepEqual(planAttachmentDelivery("cloudflare", [2_900_000, 2_900_000], 10_000), [false, true], "the second file would push the message past 5 MiB");
});

test("Resend keeps files up to 20 MB attached and links anything past it", () => {
	assert.deepEqual(planAttachmentDelivery("resend", [19 * MB], 10_000), [false]);
	assert.deepEqual(planAttachmentDelivery("resend", [20 * MB, 20 * MB], 10_000), [false, true]);
	assert.deepEqual(planAttachmentDelivery("resend", [22 * MB], 10_000), [true]);
	assert.deepEqual(planAttachmentDelivery("resend", [30 * MB, 5 * MB], 10_000), [true, false]);
});

test("small attachments stay attached on Resend", () => {
	assert.deepEqual(planAttachmentDelivery("resend", [8 * MB, 10 * MB], 10_000), [false, false]);
});

test("stored values are clamped to the 25 MB ceiling", () => {
	assert.equal(clampOutboundAttachmentMb(50), 25);
	assert.equal(clampOutboundAttachmentMb(40), 25);
	assert.equal(clampOutboundAttachmentMb(500), 25);
	assert.equal(clampOutboundAttachmentMb(10), 10);
	assert.equal(clampOutboundAttachmentMb(0), 1);
	assert.equal(clampOutboundAttachmentMb(Number.NaN), 25);
	assert.equal(clampOutboundAttachmentMb(undefined), 25);
});
