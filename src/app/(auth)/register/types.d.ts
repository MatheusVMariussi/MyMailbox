/** The public `/api/setup/status` answer: whether setup is closed and whether its domain step is done, nothing more. */
export type SetupStatus = {
	hasAdminAccount: boolean;
	hasPrimaryDomain: boolean;
	error?: string;
};

/** The primary domain an interrupted setup already created; only the setup-token-gated prepare step returns it. */
export type SetupPrimaryDomain = {
	hostname: string;
	sendingRequested: boolean;
};

export type SetupRequirementCheck = {
	key: string;
	configured: boolean;
	message: string;
};

/** Machine-readable codes a setup route may answer with; the setup token codes are translated. */
export type SetupErrorCode = import("@/lib/setup/token-utils").SetupTokenErrorCode;

export type SetupPreparationResult = {
	checks?: SetupRequirementCheck[];
	migrated?: boolean;
	primaryDomain?: SetupPrimaryDomain | null;
	error?: string;
	code?: SetupErrorCode;
};

export type DomainPreflight = {
	hostname: string;
	zone: { id: string; name: string };
};

export type DomainSetupResult = {
	domain?: DomainPreflight;
	error?: string;
	code?: SetupErrorCode;
};

export type MxCheckResult = {
	hasExistingMx?: boolean;
	error?: string;
	code?: SetupErrorCode;
};

export type RegisterResult = {
	redirect?: string;
	error?: string;
	code?: "MX_RECORDS_CONFLICT" | "passkey_unavailable" | SetupErrorCode;
	/** The admin account exists but the domain step failed; finish it after signing in. */
	accountCreated?: boolean;
};
