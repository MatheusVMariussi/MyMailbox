interface CloudflareEnv {
	DB: D1Database;
	/** The raw D1 binding, kept on the primary while `DB` is a read-replica session (set by `withD1ReadSession`). */
	DB_PRIMARY?: D1Database;
	/** Connection string for an external database (PostgreSQL, MySQL, libSQL, ...); unset keeps D1. See docs/databases.md. */
	DATABASE_URL?: string;
	/** Driver override when it cannot be inferred from DATABASE_URL (neon, postgres-js, pglite, planetscale, ...). */
	DATABASE_DRIVER?: string;
	/** Auth token for libSQL / Turso. */
	DATABASE_AUTH_TOKEN?: string;
	/** Hyperdrive binding, used as the connection string when DATABASE_URL is unset. */
	HYPERDRIVE?: { connectionString: string };
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
	/** Deployed Worker name Email Routing rules target; defaults to "mailflare". */
	CF_EMAIL_WORKER_NAME?: string;
	CF_API_KEY?: string;
	CF_EMAIL?: string;
	TURNSTILE_SECRET_KEY?: string;
	/** "node" when served by the self-hosted runtime in server/; unset on Workers. */
	MAILFLARE_RUNTIME?: "node";
	/** Shared secret the Cloudflare email relay signs inbound webhooks with (self-hosted only). */
	INBOUND_WEBHOOK_SECRET?: string;
	/** "1" refuses relays that do not sign the header map with a timestamp (relay Worker v2). */
	INBOUND_REQUIRE_SIGNED_HEADERS?: string;
	/** Cloudflare account id, needed for the Email Sending REST API off Workers. */
	CF_ACCOUNT_ID?: string;
	/** Public origin of this install (https://mail.example.com) when it sits behind a proxy. */
	APP_URL?: string;
	/** Node runtime only: set when a reverse proxy terminates TLS, so x-forwarded-proto is trusted. */
	TRUST_PROXY?: string;
	/** VAPID public key (uncompressed P-256 point, URL-safe base64) for Web Push. */
	VAPID_PUBLIC_KEY?: string;
	/** VAPID private scalar (URL-safe base64). Keep this secret. */
	VAPID_PRIVATE_KEY?: string;
	/** Contact URI for VAPID, e.g. mailto:admin@example.com or https://mail.example.com. */
	VAPID_SUBJECT?: string;
}
