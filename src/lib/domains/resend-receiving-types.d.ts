/** One line of a receiving provider's setup checklist. */
export type ReceivingStep = {
	key: string;
	label: string;
	ok: boolean;
	detail?: string;
};

export type ResendReceivingView = {
	steps: ReceivingStep[];
	ready: boolean;
	mx: string | null;
	dnsManaged: boolean;
	/** The key cannot manage domains or webhooks, so setup has to happen in the Resend dashboard. */
	restrictedKey: boolean;
};
