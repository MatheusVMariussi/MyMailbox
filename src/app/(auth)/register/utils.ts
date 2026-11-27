import { readResponseJson } from "@/lib/http/response";
import { clearClientSession } from "@/lib/auth/client";
import { SETUP_TOKEN_HEADER } from "@/lib/setup/token-utils";
import type {
	DomainSetupResult,
	MxCheckResult,
	RegisterResult,
	SetupPreparationResult,
	SetupStatus,
} from "./types";

/** Every setup request carries the operator's setup token; an empty one is left out (local development). */
function setupHeaders(setupToken: string, headers: Record<string, string> = {}): Record<string, string> {
	const token = setupToken.trim();
	return token ? { ...headers, [SETUP_TOKEN_HEADER]: token } : headers;
}

export async function prepareSetup(setupToken: string): Promise<{ ok: boolean; data: SetupPreparationResult }> {
	const res = await fetch("/api/setup/prepare", { method: "POST", headers: setupHeaders(setupToken) });
	return {
		ok: res.ok,
		data: (await readResponseJson(res)) as SetupPreparationResult,
	};
}

export async function getSetupStatus(): Promise<SetupStatus> {
	const res = await fetch("/api/setup/status");
	const data = (await readResponseJson(res)) as SetupStatus;
	if (!res.ok || typeof data.hasAdminAccount !== "boolean") throw new Error(data.error ?? "Could not load setup status");
	return data;
}

export async function submitPrimaryDomain(setupToken: string, hostname: string, skipDns = false): Promise<{ ok: boolean; data: DomainSetupResult }> {
	const res = await fetch("/api/setup/domain", {
		method: "POST",
		headers: setupHeaders(setupToken, { "Content-Type": "application/json" }),
		body: JSON.stringify(skipDns ? { hostname, skipDns: true } : { hostname }),
	});

	return {
		ok: res.ok,
		data: (await readResponseJson(res)) as DomainSetupResult,
	};
}

export async function checkExistingMx(setupToken: string, hostname: string): Promise<{ ok: boolean; data: MxCheckResult }> {
	const res = await fetch("/api/setup/domain/mx", {
		method: "POST",
		headers: setupHeaders(setupToken, { "Content-Type": "application/json" }),
		body: JSON.stringify({ hostname }),
	});

	return {
		ok: res.ok,
		data: (await readResponseJson(res)) as MxCheckResult,
	};
}

export async function submitRegistration(
	setupToken: string,
	form: FormData,
	payload: { firstRun: boolean; domain: string; enableSending?: boolean; replaceMxRecords?: boolean; skipDns?: boolean },
): Promise<{ ok: boolean; data: RegisterResult }> {
	const res = await fetch("/api/auth/register", {
		method: "POST",
		headers: setupHeaders(setupToken, { "Content-Type": "application/json" }),
		body: JSON.stringify(
			payload.firstRun
				? {
						domain: payload.domain,
						enableSending: payload.enableSending,
						replaceMxRecords: payload.replaceMxRecords,
						skipDns: payload.skipDns,
						username: form.get("username"),
						password: form.get("usePasskey") === "on" ? undefined : form.get("password"),
						usePasskey: form.get("usePasskey") === "on",
						resetEmail: form.get("resetEmail"),
						turnstileToken: form.get("turnstileToken"),
					}
				: {
						username: form.get("username"),
						password: form.get("usePasskey") === "on" ? undefined : form.get("password"),
						usePasskey: form.get("usePasskey") === "on",
						resetEmail: form.get("resetEmail"),
						turnstileToken: form.get("turnstileToken"),
					},
		),
	});

	const data = (await readResponseJson(res)) as RegisterResult;
	if (res.ok) clearClientSession();
	return { ok: res.ok, data };
}
