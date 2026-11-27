import { defaultTranslator, type Translator } from "@/lib/i18n/utils";

/**
 * The reader-language text for a Cloudflare Email Sending refusal the admin fixes in the Cloudflare
 * dashboard (the `code` a domain route answers with), or null for any other failure.
 */
export function sendingProblemMessage(code: unknown, host: string, t: Translator = defaultTranslator): string | null {
	if (code === "SENDING_PERMISSION") return t("domains.sendingPermission");
	if (code === "SENDING_NOT_ONBOARDED") return t("domains.sendingNotOnboarded", { host });
	return null;
}
