import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = mkdtempSync(join(root, "node_modules", "mymailbox-reset-bundle-"));
await build({
	stdin: {
		contents: `
			export { buildPasswordResetEmail } from "./src/lib/auth/password-reset-utils.ts";
			export { createTranslator } from "./src/lib/i18n/utils.ts";
		`,
		resolveDir: root,
		sourcefile: "reset-test-entry.ts",
	},
	outfile: join(bundleDirectory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	loader: { ".json": "json" },
	logLevel: "silent",
});
const { buildPasswordResetEmail, createTranslator } = await import(pathToFileURL(join(bundleDirectory, "entry.mjs")).href);
rmSync(bundleDirectory, { recursive: true, force: true });

const portuguese = JSON.parse(readFileSync(join(root, "public", "locales", "pt-BR.json"), "utf8"));
const input = { email: "ada@example.com", appName: "Posta", link: "https://mail.example.com/reset-password?token=abc&x=1", minutes: 30 };

test("the reset mail is in English by default", () => {
	const mail = buildPasswordResetEmail(createTranslator("en"), input);
	assert.equal(mail.subject, "Reset your Posta password");
	assert.match(mail.text, /Someone asked to reset the password for ada@example.com on Posta\./);
	assert.match(mail.text, /within 30 minutes/);
	assert.match(mail.text, /If that was not you/);
});

test("the reset mail follows the chosen language", () => {
	const mail = buildPasswordResetEmail(createTranslator("pt-BR", portuguese), input);
	assert.equal(mail.subject, "Redefinir a senha do Posta");
	assert.match(mail.text, /em até 30 minutos/);
	assert.match(mail.text, /a senha continuará a mesma/);
	assert.ok(!/Someone asked|If that was not you/.test(mail.text + mail.html));
});

test("the link is never translated or altered", () => {
	for (const t of [createTranslator("en"), createTranslator("pt-BR", portuguese)]) {
		const mail = buildPasswordResetEmail(t, input);
		assert.ok(mail.text.includes(input.link));
		assert.ok(mail.html.includes("https://mail.example.com/reset-password?token=abc&amp;x=1"));
	}
});

test("addresses and names are escaped in the HTML part only", () => {
	const mail = buildPasswordResetEmail(createTranslator("en"), { ...input, email: "a<b>@example.com", appName: "R&D <Mail>" });
	assert.ok(mail.html.includes("<b>a&lt;b&gt;@example.com</b>"));
	assert.ok(mail.html.includes("R&amp;D &lt;Mail&gt;"));
	assert.ok(!mail.html.includes("<Mail>"));
	assert.ok(mail.text.includes("a<b>@example.com"));
	assert.ok(mail.text.includes("R&D <Mail>"));
});

test("a language without the new strings falls back to English", () => {
	const mail = buildPasswordResetEmail(createTranslator("pt-BR", {}), input);
	assert.equal(mail.subject, "Reset your Posta password");
});
