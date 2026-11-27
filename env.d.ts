interface CloudflareEnv {
	DB: D1Database;
	/** The raw D1 binding, kept on the primary while `DB` is a read-replica session (set by `withD1ReadSession`). */
	DB_PRIMARY?: D1Database;
	EMAIL: SendEmail;
	BUCKET: R2Bucket;
	INBOUND_QUEUE: Queue<import("./src/lib/email/inbound").InboundQueueMessage>;
	// The outbound queue also carries webhook retries so that scheduled redelivery needs no extra binding.
	OUTBOUND_QUEUE: Queue<
		| import("./src/lib/email/send").OutboundQueueMessage
		| import("./src/lib/email/webhooks").WebhookRetryMessage
	>;
	ASSETS: Fetcher;
	IMAGES: ImagesBinding;
	WORKER_SELF_REFERENCE: Fetcher;
	REALTIME: DurableObjectNamespace<
		import("./src/lib/realtime/hub").RealtimeHub
	>;
	LOGIN_RATE_LIMIT?: RateLimit;
	/** Per-client budget for unverified app-password guesses (JMAP Basic auth); falls back to LOGIN_RATE_LIMIT. */
	DEVICE_LOGIN_RATE_LIMIT?: RateLimit;
	/** Spamhaus Data Query Service key; enables ZEN (sending IP) and DBL (domain) checks in spam analysis. */
	SPAMHAUS_DQS_KEY?: string;
	/** abuse.ch Auth-Key; enables URLhaus malware-host checks for links in incoming mail. */
	ABUSECH_AUTH_KEY?: string;
	/** "off" disables the RDAP domain-age check in spam analysis. */
	SPAM_DOMAIN_AGE_CHECK?: string;
	CF_TOKEN?: string;
	/** Deployed Worker name Email Routing rules target; defaults to "mymailbox". */
	CF_EMAIL_WORKER_NAME?: string;
	CF_API_KEY?: string;
	CF_EMAIL?: string;
	TURNSTILE_SECRET_KEY?: string;
	/**
	 * Secret the operator enters to run first-run setup (`npx wrangler secret put SETUP_TOKEN`). Without it,
	 * setup and first-account registration are refused everywhere but a localhost development host.
	 */
	SETUP_TOKEN?: string;
	/** Public origin of this install (https://mail.example.com); used for links in mail (resets, download links, read receipts) and for passkeys. */
	APP_URL?: string;
	/** VAPID public key (uncompressed P-256 point, URL-safe base64) for Web Push. */
	VAPID_PUBLIC_KEY?: string;
	/** VAPID private scalar (URL-safe base64). Keep this secret. */
	VAPID_PRIVATE_KEY?: string;
	/** Contact URI for VAPID, e.g. mailto:admin@example.com or https://mail.example.com. */
	VAPID_SUBJECT?: string;
}
