import { isCloudflareApiErrorCode } from "@/lib/cloudflare-api-error";
import { MxConflictError } from "@/lib/domains/receiving-dns";
import { SendingSetupError } from "@/lib/domains/sending-errors";
import type { DomainProvisioningError } from "@/lib/domains/types";

export function getDomainProvisioningError(
	error: unknown,
	fallback: string,
	fallbackStatus = 400,
): DomainProvisioningError {
	if (isCloudflareApiErrorCode(error, 2008)) {
		return {
			code: "MX_RECORDS_CONFLICT",
			message:
				"Existing MX records currently deliver mail to another provider. Continue to delete them and replace them with Cloudflare Email Routing.",
			status: 409,
		};
	}

	if (error instanceof MxConflictError) {
		return { code: "MX_RECORDS_CONFLICT", message: error.message, status: 409 };
	}

	if (error instanceof SendingSetupError) {
		return { code: error.code, message: error.message, status: 502 };
	}

	return {
		message: error instanceof Error ? error.message : fallback,
		status: fallbackStatus,
	};
}
