/** Header the setup UI sends the operator's setup token in, on every first-run setup request. */
export const SETUP_TOKEN_HEADER = "X-MyMailbox-Setup-Token";

/** Longest token accepted from a request; longer values are refused before hashing. */
export const MAX_SETUP_TOKEN_LENGTH = 1024;

/** Hosts a deployed Worker can never be reached on, so setup there is local development. */
const LOCAL_DEVELOPMENT_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type SetupTokenErrorCode = "setup_token_unset" | "setup_token_required" | "setup_token_invalid";

export const SETUP_TOKEN_ERRORS: Record<SetupTokenErrorCode, { status: number; message: string }> = {
	setup_token_unset: {
		status: 503,
		message: "Setup is locked until the SETUP_TOKEN secret is set. Run `npx wrangler secret put SETUP_TOKEN`, then reload this page.",
	},
	setup_token_required: { status: 401, message: "Enter the setup token to continue." },
	setup_token_invalid: { status: 401, message: "That setup token is not correct." },
};

export function isLocalDevelopmentHostname(hostname: string): boolean {
	return LOCAL_DEVELOPMENT_HOSTNAMES.has(hostname.toLowerCase());
}

export function isSetupTokenErrorCode(value: unknown): value is SetupTokenErrorCode {
	return typeof value === "string" && Object.hasOwn(SETUP_TOKEN_ERRORS, value);
}
