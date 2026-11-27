import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mymailbox-authentication-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: [
			`export { readSesAuthentication, readCloudflareAuthentication, readProviderAuthentication } from "./src/lib/email/provider-trace";`,
			`export { getSenderWarning } from "./src/components/messages/message-details-utils";`,
		].join("\n"),
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
});

const provider = await import(pathToFileURL(join(outDir, "entry.mjs")).href);
const encoder = new TextEncoder();
const raw = (text) => encoder.encode(text.replace(/\n/g, "\r\n")).buffer;

const sesHeaders = `Return-Path: <bounce@mail.example.com>
Received: from mail.example.com (mail.example.com [203.0.113.5]) by inbound-smtp.us-east-1.amazonaws.com with SMTP id abc (version=TLSv1.3, cipher=TLS_AES_256_GCM_SHA384) for <me@example.org>; Thu, 29 Oct 2026 06:54:00 +0000
Authentication-Results: amazonses.com; spf=pass (sender IP is 203.0.113.5) smtp.mailfrom=example.com; dkim=pass header.d=example.com header.i=@example.com; dmarc=pass header.from=example.com;
X-SES-Spam-Verdict: PASS
X-SES-Virus-Verdict: PASS
X-SES-Receipt: abc`;

test("trusted SES headers expose authentication results and connection metadata", () => {
	const authentication = provider.readSesAuthentication(raw(`${sesHeaders}
From: "Ashby Recruiting" <no-reply@example.com>
To: me@example.org
Subject: Hello

Body`), "no-reply@example.com");

	assert.ok(authentication);
	assert.deepEqual(authentication.spf, { status: "PASS", detail: "IP 203.0.113.5" });
	assert.deepEqual(authentication.dkim, { status: "PASS", detail: "d=example.com" });
	assert.deepEqual(authentication.dmarc, { status: "PASS", detail: "header.from=example.com" });
	assert.equal(authentication.signedBy, "example.com");
	assert.equal(authentication.mailedBy, "example.com");
	assert.equal(authentication.senderIp, "203.0.113.5");
	assert.equal(authentication.encryption, "TLS 1.3");
	assert.equal(authentication.aligned, true);
});

test("failed results are reported without pretending the sender is verified", () => {
	const authentication = provider.readSesAuthentication(raw(`Return-Path: <bounce@esp.example.net>
Authentication-Results: amazonses.com; spf=fail smtp.mailfrom=esp.example.net; dkim=fail header.d=esp.example.net; dmarc=fail header.from=example.com;
X-SES-Receipt: abc
From: Example <no-reply@example.com>

Body`), "no-reply@example.com");

	assert.ok(authentication);
	assert.equal(authentication.spf.status, "FAIL");
	assert.equal(authentication.dkim.status, "FAIL");
	assert.equal(authentication.dmarc.status, "FAIL");
	assert.equal(authentication.aligned, null);
});

test("a passing aligned signature wins over an earlier failing one", () => {
	const authentication = provider.readSesAuthentication(raw(`Authentication-Results: amazonses.com; spf=fail smtp.mailfrom=esp.example.net; dkim=fail header.d=esp.example.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com;
X-SES-Receipt: abc
From: Example <no-reply@example.com>

Body`), "no-reply@example.com");

	assert.ok(authentication);
	assert.equal(authentication.spf.status, "FAIL");
	assert.deepEqual(authentication.dkim, { status: "PASS", detail: "d=example.com" });
	assert.equal(authentication.signedBy, "example.com");
	assert.equal(authentication.aligned, true);
});

test("header.i identities are reduced to their signing domain", () => {
	const authentication = provider.readSesAuthentication(raw(`Authentication-Results: amazonses.com; dkim=pass header.i=sender@example.com; dmarc=pass header.from=example.com;
X-SES-Receipt: abc
From: Example <no-reply@example.com>

Body`), "no-reply@example.com");

	assert.ok(authentication);
	assert.equal(authentication.signedBy, "example.com");
	assert.deepEqual(authentication.dkim, { status: "PASS", detail: "d=example.com" });
	assert.equal(authentication.aligned, true);
});

test("unrelated registrations under a shared suffix are not treated as aligned", () => {
	const authentication = provider.readSesAuthentication(raw(`Authentication-Results: amazonses.com; dkim=pass header.d=attacker.co.ke; dmarc=fail header.from=victim.co.ke;
X-SES-Receipt: abc
From: Victim <no-reply@victim.co.ke>

Body`), "no-reply@victim.co.ke");

	assert.ok(authentication);
	assert.equal(authentication.signedBy, "attacker.co.ke");
	assert.equal(authentication.aligned, false);
});

test("messages without a trusted SES trace report no authentication", () => {
	const withoutReceipt = raw(`Authentication-Results: amazonses.com; spf=pass dkim=pass dmarc=pass
From: no-reply@example.com

Body`);
	assert.equal(provider.readSesAuthentication(withoutReceipt, "no-reply@example.com"), null);

	const forgedAfterOtherHeader = raw(`From: no-reply@example.com
Authentication-Results: amazonses.com; spf=pass dkim=pass dmarc=pass
X-SES-Receipt: abc

Body`);
	assert.equal(provider.readSesAuthentication(forgedAfterOtherHeader, "no-reply@example.com"), null);

	const otherProvider = raw(`Authentication-Results: mx.cloudflare.net; spf=pass dkim=pass dmarc=pass
X-SES-Receipt: abc
From: no-reply@example.com

Body`);
	assert.equal(provider.readSesAuthentication(otherProvider, "no-reply@example.com"), null);
});

test("DMARC-passing mail across sibling subdomains does not raise a sender warning", () => {
	const authentication = provider.readSesAuthentication(raw(`Authentication-Results: amazonses.com; spf=pass smtp.mailfrom=bounce.mail.example.com; dkim=pass header.d=mail.example.com; dmarc=pass header.from=news.example.com;
X-SES-Receipt: abc
From: News <news@news.example.com>

Body`), "news@news.example.com");

	assert.ok(authentication);
	assert.equal(authentication.dmarc.status, "PASS");
	// The conservative signature matcher sees siblings as unrelated; DMARC proves alignment.
	assert.equal(authentication.aligned, false);
	assert.equal(
		provider.getSenderWarning(
			{ direction: "inbound", fromAddr: "News <news@news.example.com>", replyTo: null },
			{ available: true, ...authentication },
		),
		null,
	);
});

// What Cloudflare Email Routing prepends before handing the message to the Worker: its own trace and
// verdicts sit above everything the sender wrote.
const cloudflareHeaders = `Received: from mail-wm1-f54.google.com (2a00:1450:4864:20::336)
	by cloudflare-email.net (unknown) id 0Ru7cfPzgbBC
	for <me@example.org>; Thu, 26 Nov 2026 12:15:53 +0000
ARC-Seal: i=1; a=rsa-sha256; s=2024; d=cloudflare-email.net; cv=none; b=abc
ARC-Message-Signature: i=1; a=rsa-sha256; s=2024; d=cloudflare-email.net; c=relaxed/relaxed; h=From:To; bh=x; b=y
ARC-Authentication-Results: i=1; mx.cloudflare.net;
	dkim=pass header.d=gmail.com header.s=20230601 header.b=Qx1;
	dmarc=pass header.from=gmail.com policy.dmarc=none;
	spf=pass (mx.cloudflare.net: domain of sender@gmail.com designates 209.85.128.54 as permitted sender) smtp.mailfrom=sender@gmail.com;
	arc=none smtp.remote-ip=209.85.128.54
Received-SPF: pass (mx.cloudflare.net: domain of sender@gmail.com designates 209.85.128.54 as permitted sender)
	receiver=mx.cloudflare.net; client-ip=209.85.128.54; envelope-from="sender@gmail.com"; helo=mail-wm1-f54.google.com;
Authentication-Results: mx.cloudflare.net;
	dkim=pass header.d=gmail.com header.s=20230601 header.b=Qx1;
	dmarc=pass header.from=gmail.com policy.dmarc=none;
	spf=pass (mx.cloudflare.net: domain of sender@gmail.com designates 209.85.128.54 as permitted sender) smtp.mailfrom=sender@gmail.com;
	arc=none smtp.remote-ip=209.85.128.54`;

const gmailBody = `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=20230601; h=from:to; bh=x; b=y
From: Sender <sender@gmail.com>
To: me@example.org
Subject: Hello

Body`;

test("Cloudflare's own Authentication-Results gives SPF, DKIM and DMARC with the sender's details", () => {
	const authentication = provider.readCloudflareAuthentication(raw(`${cloudflareHeaders}\n${gmailBody}`), "sender@gmail.com");

	assert.ok(authentication);
	assert.deepEqual(authentication.spf, { status: "PASS", detail: "IP 209.85.128.54" });
	assert.deepEqual(authentication.dkim, { status: "PASS", detail: "d=gmail.com" });
	assert.deepEqual(authentication.dmarc, { status: "PASS", detail: "header.from=gmail.com" });
	assert.equal(authentication.signedBy, "gmail.com");
	assert.equal(authentication.mailedBy, "gmail.com");
	assert.equal(authentication.senderIp, "209.85.128.54");
	assert.equal(authentication.encryption, null);
	assert.equal(authentication.aligned, true);
});

test("Cloudflare failures keep their own status words and never look aligned", () => {
	const authentication = provider.readCloudflareAuthentication(raw(`Received: from mx.spam.example (203.0.113.9) by cloudflare-email.net (unknown) id 1 for <me@example.org>; Thu, 26 Nov 2026 12:15:53 +0000
Authentication-Results: mx.cloudflare.net; dkim=none; dmarc=fail header.from=bank.example policy.dmarc=reject; spf=softfail (mx.cloudflare.net: domain of x@spam.example does not designate 203.0.113.9 as permitted sender) smtp.mailfrom=x@spam.example; arc=none smtp.remote-ip=203.0.113.9
From: Bank <alerts@bank.example>

Body`), "alerts@bank.example");

	assert.ok(authentication);
	assert.deepEqual(authentication.spf, { status: "SOFTFAIL", detail: "IP 203.0.113.9" });
	assert.deepEqual(authentication.dkim, { status: "NONE", detail: null });
	assert.deepEqual(authentication.dmarc, { status: "FAIL", detail: "header.from=bank.example" });
	assert.equal(authentication.mailedBy, "spam.example");
	assert.equal(authentication.senderIp, "203.0.113.9");
	assert.equal(authentication.aligned, null);
});

test("the sender IP falls back to Received-SPF when the results carry no remote IP", () => {
	const authentication = provider.readCloudflareAuthentication(raw(`Received: from mx.example.com (198.51.100.7) by cloudflare-email.net (unknown) id 9 for <a@example.org>; Thu, 26 Nov 2026 12:15:53 +0000
Received-SPF: pass (mx.cloudflare.net: domain of a@example.com designates 198.51.100.7 as permitted sender) receiver=mx.cloudflare.net; client-ip=198.51.100.7; envelope-from="a@example.com";
Authentication-Results: mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=a@example.com
From: a@example.com

Body`), "a@example.com");

	assert.ok(authentication);
	assert.equal(authentication.senderIp, "198.51.100.7");
	assert.deepEqual(authentication.spf, { status: "PASS", detail: "IP 198.51.100.7" });
});

test("only the topmost Authentication-Results counts, so a sender's copy further down changes nothing", () => {
	// Cloudflare's own Received line may come after its results; both sit above the sender's headers.
	const authentication = provider.readCloudflareAuthentication(raw(`Authentication-Results: mx.cloudflare.net; dkim=fail header.d=bank.example; dmarc=fail header.from=bank.example; spf=fail smtp.mailfrom=x@spam.example
Received: from mx.spam.example (203.0.113.9) by cloudflare-email.net (unknown) id 2 for <me@example.org>; Thu, 26 Nov 2026 12:15:53 +0000
Authentication-Results: mx.cloudflare.net; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example; spf=pass smtp.mailfrom=alerts@bank.example
From: Bank <alerts@bank.example>

Body`), "alerts@bank.example");

	assert.ok(authentication);
	assert.equal(authentication.spf.status, "FAIL");
	assert.equal(authentication.dkim.status, "FAIL");
	assert.equal(authentication.dmarc.status, "FAIL");
	assert.equal(authentication.aligned, null);
});

test("results Cloudflare did not write are not trusted", () => {
	const lookalike = raw(`Authentication-Results: mx.cloudflare.net.evil.example; spf=pass dkim=pass header.d=bank.example dmarc=pass
From: alerts@bank.example

Body`);
	assert.equal(provider.readCloudflareAuthentication(lookalike, "alerts@bank.example"), null);

	const otherServer = raw(`Authentication-Results: mx.google.com; spf=pass smtp.mailfrom=bank.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example
From: alerts@bank.example

Body`);
	assert.equal(provider.readCloudflareAuthentication(otherServer, "alerts@bank.example"), null);

	// Below the sender's own headers: Cloudflare prepends, so this can only be the sender's.
	const belowMessageHeaders = raw(`From: alerts@bank.example
Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=bank.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example

Body`);
	assert.equal(provider.readCloudflareAuthentication(belowMessageHeaders, "alerts@bank.example"), null);

	// ARC copies are a record for the next hop, not this server's verdict.
	const arcOnly = raw(`ARC-Authentication-Results: i=1; mx.cloudflare.net; spf=pass smtp.mailfrom=bank.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example
From: alerts@bank.example

Body`);
	assert.equal(provider.readCloudflareAuthentication(arcOnly, "alerts@bank.example"), null);

	// No trace of Cloudflare above the sender's headers: a result alone at the top is the sender's own.
	const forgedFirst = raw(`Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=bank.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example
DKIM-Signature: v=1; d=bank.example; b=x
Received: from laptop (192.0.2.1) by mail.spam.example; Thu, 26 Nov 2026 12:15:53 +0000
From: alerts@bank.example

Body`);
	assert.equal(provider.readCloudflareAuthentication(forgedFirst, "alerts@bank.example"), null);

	const noVerdict = raw(`Received: from x (192.0.2.1) by cloudflare-email.net (unknown) id 3; Thu, 26 Nov 2026 12:15:53 +0000
Authentication-Results: mx.cloudflare.net; arc=none
From: alerts@bank.example

Body`);
	assert.equal(provider.readCloudflareAuthentication(noVerdict, "alerts@bank.example"), null);
});

test("provider authentication reads Cloudflare and SES traces and nothing else", () => {
	const cloudflare = provider.readProviderAuthentication(raw(`${cloudflareHeaders}\n${gmailBody}`), "sender@gmail.com");
	assert.equal(cloudflare?.dmarc?.status, "PASS");

	const ses = provider.readProviderAuthentication(raw(`${sesHeaders}
From: no-reply@example.com

Body`), "no-reply@example.com");
	assert.equal(ses?.senderIp, "203.0.113.5");

	assert.equal(provider.readProviderAuthentication(raw(`From: a@example.com

Body`), "a@example.com"), null);
});
