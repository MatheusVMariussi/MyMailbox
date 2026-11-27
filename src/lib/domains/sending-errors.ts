import { CloudflareApiError } from "@/lib/cloudflare-api-error";

/** Where the Cloudflare dashboard onboards a domain for Email Sending. */
export const EMAIL_SENDING_DASHBOARD_PATH = "Compute → Email Service → Email Sending";

/**
 * Why Cloudflare refused to set up Email Sending, when it is something the admin fixes in the dashboard:
 * the API token lacks the account-level "Email Sending: Edit" permission, or the domain has not been
 * onboarded for Email Sending (which also needs the Workers Paid plan).
 */
export type SendingSetupProblem = "SENDING_PERMISSION" | "SENDING_NOT_ONBOARDED";

/** Error codes Cloudflare answers for a token that cannot use an endpoint. */
const AUTH_ERROR_CODES = new Set([9109, 10000, 10001]);
const AUTH_WORDING = /\b(?:permission|forbidden|not authori[sz]ed|unauthori[sz]ed|authentication)\b/i;
const NOT_ONBOARDED_WORDING = /\b(?:onboard\w*|not (?:been )?(?:enabled|activated|available|active|configured|set ?up)|not found|no such|subscription|plan)\b/i;

export class SendingSetupError extends Error {
	constructor(
		readonly code: SendingSetupProblem,
		readonly hostname: string,
		/** What Cloudflare answered, for logs and API clients. */
		readonly detail: string,
	) {
		super(
			code === "SENDING_PERMISSION"
				? `Cloudflare refused to set up Email Sending for ${hostname}: the API token needs the account-level "Email Sending: Edit" permission. Add it to the token (My Profile → API Tokens) and try again.`
				: `Cloudflare Email Sending is not active for ${hostname}. Onboard the domain in the Cloudflare dashboard under ${EMAIL_SENDING_DASHBOARD_PATH} (it needs the Workers Paid plan), then try again.`,
		);
		this.name = "SendingSetupError";
	}
}

/** The dashboard-fixable reason behind a failed Email Sending call, or null for anything else. */
export function sendingSetupProblem(error: unknown): SendingSetupProblem | null {
	if (!(error instanceof CloudflareApiError) || !error.path.includes("/email/sending/")) return null;
	const wording = error.errors.map((item) => item.message).join(" ");
	if (error.status === 401 || error.status === 403 || error.errors.some((item) => item.code !== undefined && AUTH_ERROR_CODES.has(item.code)) || AUTH_WORDING.test(wording)) {
		return "SENDING_PERMISSION";
	}
	if (error.status === 404 || NOT_ONBOARDED_WORDING.test(wording)) return "SENDING_NOT_ONBOARDED";
	return null;
}

/** Turns a failed Email Sending call into a SendingSetupError the admin can act on; other errors pass through. */
export function explainSendingError(error: unknown, hostname: string): unknown {
	const problem = sendingSetupProblem(error);
	if (!problem) return error;
	const detail = (error as CloudflareApiError).errors.map((item) => (item.code ? `code ${item.code}: ${item.message}` : item.message)).join("; ")
		|| `HTTP ${(error as CloudflareApiError).status}`;
	return new SendingSetupError(problem, hostname, detail);
}
