import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { kit } from "./kits";

// Written against the SQLite column kit (see kits.ts).
const { table: sqliteTable, text, integer, bool, timestamp, autoId, index, uniqueIndex, desc, nowSeconds } = kit;

export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	email: text("email").notNull().unique(),
	resetEmail: text("reset_email"),
	forwardingEmail: text("forwarding_email"),
	/**
	 * A bcrypt hash, or PASSWORDLESS_PASSWORD_HASH when the account signs in only
	 * with passkeys. Kept NOT NULL so the column needs no lossy table rebuild on
	 * SQLite; every password check goes through password.ts, which rejects the
	 * sentinel.
	 */
	passwordHash: text("password_hash").notNull(),
	name: text("name").notNull(),
	timeZone: text("time_zone"),
	avatarKey: text("avatar_key"),
	role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
	// Exactly one account is the primary admin: the one created during setup.
	// They own administrator management and can hand the role to another account.
	isPrimaryAdmin: bool("is_primary_admin").notNull().default(false),
	disabled: bool("disabled").notNull().default(false),
	canManageMailboxes: bool("can_manage_mailboxes").notNull().default(false),
	// Capabilities the primary admin grants to other admins.
	canManageDomains: bool("can_manage_domains").notNull().default(false),
	canManageUsers: bool("can_manage_users").notNull().default(false),
	// Apps an admin can hide per account. Off removes the nav entry and blocks the app's API.
	calendarEnabled: bool("calendar_enabled").notNull().default(true),
	keyboardShortcutsEnabled: bool("keyboard_shortcuts_enabled").notNull().default(true),
	spamProtectionEnabled: bool("spam_protection_enabled").notNull().default(true),
	// Score at which incoming mail moves to Spam: relaxed 85, normal 70, strict 55 (SPAM_STRICTNESS_THRESHOLDS).
	spamStrictness: text("spam_strictness", { enum: ["relaxed", "normal", "strict"] }).notNull().default("strict"),
	/** Days a message may stay in Trash or Spam before the scheduled purge deletes it; null keeps it forever. */
	trashRetentionDays: integer("trash_retention_days"),
	// Off shows the mailbox only. On shows Name <mailbox> on To, Cc, and Bcc.
	showFullRecipientAddresses: bool("show_full_recipient_addresses").notNull().default(false),
	// When the reader loads remote images and styles without being asked: always ask, only for senders not yet allowed, or always.
	remoteContentMode: text("remote_content_mode", { enum: ["ask", "new_sender", "allow"] }).notNull().default("allow"),
	// TOTP second factor. The secret is written at enrolment and only counts
	// once the user has proven a code from their authenticator.
	totpSecret: text("totp_secret"),
	totpEnabled: bool("totp_enabled").notNull().default(false),
	totpConfirmedAt: timestamp("totp_confirmed_at"),
	/** Last accepted TOTP time step (unix seconds / 30); codes for this step or an earlier one are refused, so a code works once. */
	totpLastStep: integer("totp_last_step"),
	/**
	 * Password sign-ins must prove a second factor (a passkey or TOTP/recovery
	 * code). Passkey sign-ins already satisfy it, so they need no extra step.
	 */
	requireSecondFactor: bool("require_second_factor").notNull().default(false),
	/** Kept current by passkey_credentials triggers; lets the database reject the last-method removal. */
	passkeyCount: integer("passkey_count").notNull().default(0),
	/**
	 * Bumped whenever a sign-in method or second-factor policy changes. Step-up
	 * grants capture the value they were issued under, so a proof obtained
	 * before a security change cannot be replayed after it.
	 */
	securityVersion: integer("security_version").notNull().default(0),
	lastSignInAt: timestamp("last_sign_in_at"),
	// Set when an admin deletes the account. The account is also `disabled` and can be restored until the
	// retention window ends, after which the scheduled purge removes it and its data.
	deletedAt: timestamp("deleted_at"),
	createdByUserId: text("created_by_user_id").references((): AnySQLiteColumn => users.id, { onDelete: "set null" }),
	createdAt: timestamp("created_at")
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [
	index("users_created_by_idx").on(t.createdByUserId),
]);

export const domains = sqliteTable(
	"domains",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		hostname: text("hostname").notNull(),
		zoneId: text("zone_id").notNull(),
		status: text("status", { enum: ["pending", "active", "error"] })
			.notNull()
			.default("pending"),
		routingStatus: text("routing_status"),
		sendingSubdomainTag: text("sending_subdomain_tag"),
		sendingProvider: text("sending_provider", { enum: ["none", "cloudflare", "resend"] }).notNull().default("none"),
		receivingProvider: text("receiving_provider", { enum: ["none", "cloudflare", "resend"] }).notNull().default("cloudflare"),
		sendingRequested: bool("sending_requested").notNull().default(false),
		sendingEnabled: bool("sending_enabled").notNull().default(false),
		routingEnabled: bool("routing_enabled").notNull().default(false),
		/** The operator skipped adding/checking DNS; set until they confirm the records exist. */
		dnsSkipped: bool("dns_skipped").notNull().default(false),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("domains_hostname_idx").on(t.hostname),
		index("domains_user_idx").on(t.userId),
	],
);

export const mailboxes = sqliteTable(
	"mailboxes",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.id, { onDelete: "cascade" }),
		localPart: text("local_part").notNull(),
		displayName: text("display_name"),
		signature: text("signature"),
		autoReplyEnabled: bool("auto_reply_enabled").notNull().default(false),
		autoReplySubject: text("auto_reply_subject").notNull().default("Out of office"),
		autoReplyBody: text("auto_reply_body").notNull().default(""),
		avatarKey: text("avatar_key"),
		type: text("type", { enum: ["personal", "shared"] }).notNull().default("personal"),
		useAllDomains: bool("use_all_domains").notNull().default(true),
		disabled: bool("disabled").notNull().default(false),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("mailboxes_address_idx").on(t.domainId, t.localPart), index("mailboxes_user_idx").on(t.userId)],
);

export const mailboxAliases = sqliteTable(
	"mailbox_aliases",
	{
		id: text("id").primaryKey(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.id, { onDelete: "cascade" }),
		localPart: text("local_part").notNull(),
		// User-facing name for the alias ("Shopping", "Newsletter"). Masked aliases
		// use it as their only identity so the account name stays hidden.
		label: text("label"),
		// Disabled aliases reject inbound mail before catch-all rules and cannot
		// be used as a sender address.
		enabled: bool("enabled").notNull().default(true),
		// Masked aliases are generated addresses that hide the account name when
		// sending ("Hide My Email"-style), unlike manually created aliases.
		masked: bool("masked").notNull().default(false),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("mailbox_aliases_address_idx").on(t.domainId, t.localPart),
		index("mailbox_aliases_mailbox_idx").on(t.mailboxId),
	],
);

export const autoReplyDeliveries = sqliteTable(
	"auto_reply_deliveries",
	{
		id: text("id").primaryKey(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		recipient: text("recipient").notNull(),
		sentAt: timestamp("sent_at").notNull(),
	},
	(t) => [
		uniqueIndex("auto_reply_deliveries_mailbox_recipient_idx").on(t.mailboxId, t.recipient),
		index("auto_reply_deliveries_sent_idx").on(t.sentAt),
	],
);

export const mailboxAccess = sqliteTable(
	"mailbox_access",
	{
		id: text("id").primaryKey(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		permission: text("permission", { enum: ["read_only", "send_as", "send_on_behalf", "full_access"] })
			.notNull()
			.default("read_only"),
		createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("mailbox_access_mailbox_user_idx").on(t.mailboxId, t.userId),
		index("mailbox_access_user_idx").on(t.userId),
		index("mailbox_access_mailbox_idx").on(t.mailboxId),
		index("mailbox_access_created_by_idx").on(t.createdByUserId),
	],
);

export const contacts = sqliteTable(
	"contacts",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		displayName: text("display_name"),
		avatarKey: text("avatar_key"),
		source: text("source", { enum: ["manual", "inbound", "outbound"] })
			.notNull()
			.default("inbound"),
		blocked: bool("blocked").notNull().default(false),
		// Set when the user allows remote content from this sender; "new_sender" mode loads it without asking afterwards.
		remoteContentAllowed: bool("remote_content_allowed").notNull().default(false),
		lastSeenAt: timestamp("last_seen_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("contacts_user_email_idx").on(t.userId, t.email),
		index("contacts_user_idx").on(t.userId),
	],
);

/**
 * Labels (Gmail-style, formerly folders): per mailbox, many per message through `message_labels`. A label never
 * takes a message out of the inbox; status alone decides Inbox, Archive, Spam and Trash.
 */
export const labels = sqliteTable(
	"labels",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull().default("#2563eb"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("labels_mailbox_name_idx").on(t.mailboxId, t.name),
		index("labels_user_idx").on(t.userId),
		index("labels_mailbox_idx").on(t.mailboxId),
	],
);

export const jmapMailboxRevisions = sqliteTable("jmap_mailbox_revisions", {
	mailboxId: text("mailbox_id").primaryKey(),
	revision: integer("revision").notNull().default(0),
});

/**
 * JMAP change log, written only by the `jmap_changes_*` triggers
 * (`0001_triggers_and_seeds.sql`): one row per created, updated or destroyed Email (and per folder or
 * mailbox change), so `Email/changes`, `Mailbox/changes` and `Thread/changes`
 * return real deltas. `seq` is the state; rows older than the retention
 * window are pruned and `jmap_change_floor` records the last pruned seq.
 */
export const jmapChanges = sqliteTable(
	"jmap_changes",
	{
		seq: autoId("seq"),
		mailboxId: text("mailbox_id").notNull(),
		objectType: text("object_type", { enum: ["email", "mailbox"] }).notNull(),
		objectId: text("object_id").notNull(),
		threadId: text("thread_id"),
		// "hidden" marks a message that stopped being visible to everyone but its author (a scheduled send
		// cancelled back to a draft): readers who could see it are told it was destroyed, the author is not.
		change: text("change", { enum: ["created", "updated", "destroyed", "hidden"] }).notNull(),
		createdAt: integer("created_at").notNull().default(nowSeconds),
	},
	(table) => [index("jmap_changes_mailbox_seq_idx").on(table.mailboxId, table.seq)],
);

export const jmapChangeFloor = sqliteTable("jmap_change_floor", {
	id: integer("id").primaryKey(),
	seq: integer("seq").notNull().default(0),
});

/**
 * Short-lived, single-use undo tokens. The nonce is consumed by the first
 * authenticated undo request and only pruned after it expires; it is internal
 * security state and deliberately excluded from backups.
 */
export const messageActionUndoClaims = sqliteTable(
	"message_action_undo_claims",
	{
		nonce: text("nonce").primaryKey(),
		userId: text("user_id").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
	},
	(table) => [index("message_action_undo_claims_expires_idx").on(table.expiresAt)],
);

export const apiKeys = sqliteTable("api_keys", {
	id: text("id").primaryKey(),
	/** `legacy` keys are ordinary API keys (`/api/api-keys`); `app` keys are JMAP app passwords (`/api/app-passwords`). */
	kind: text("kind", { enum: ["legacy", "app"] }).notNull().default("legacy"),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	prefix: text("prefix").notNull(),
	/**
	 * bcrypt for keys issued before SHA-256 lookups. Newer keys store the same
	 * SHA-256 hex as `keySha256` so creation does not run bcrypt either.
	 */
	keyHash: text("key_hash").notNull(),
	/**
	 * SHA-256 hex of the secret. High-entropy API keys and app passwords are
	 * verified with this so auth stays inside the Workers free-tier CPU limit.
	 * Null on rows that only have a bcrypt hash.
	 */
	keySha256: text("key_sha256"),
	scopes: text("scopes").notNull(),
	mailboxScopeEnabled: bool("mailbox_scope_enabled").notNull().default(false),
	createdAt: timestamp("created_at")
		.notNull()
		.$defaultFn(() => new Date()),
	lastUsedAt: timestamp("last_used_at"),
	/** Protocol (`jmap`) and client IP of the last use, written with `lastUsedAt`. */
	lastUsedProtocol: text("last_used_protocol"),
	lastUsedIp: text("last_used_ip"),
}, (t) => [index("api_keys_user_idx").on(t.userId), uniqueIndex("api_keys_key_sha256_idx").on(t.keySha256), index("idx_api_keys_prefix").on(t.prefix)]);

export const messages = sqliteTable(
	"messages",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
		direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
		providerMessageId: text("provider_message_id"),
		folderId: text("folder_id").references(() => labels.id, { onDelete: "set null" }),
		fromAddr: text("from_addr").notNull(),
		toAddr: text("to_addr").notNull(),
		ccAddr: text("cc_addr"),
		bccAddr: text("bcc_addr"),
		/** Full Reply-To header, comma-joined. Replies go here instead of `fromAddr` when set. */
		replyTo: text("reply_to"),
		subject: text("subject"),
		snippet: text("snippet"),
		textBody: text("text_body"),
		htmlBody: text("html_body"),
		rawR2Key: text("raw_r2_key"),
		status: text("status").notNull().default("received"),
		read: bool("read").notNull().default(false),
		starred: bool("starred").notNull().default(false),
		// An unsent draft stays private to its author for as long as the row exists, wherever it is moved
		// (Trash, Archive, a label). Cleared when the row becomes sent mail.
		privateDraft: bool("private_draft").notNull().default(false),
		snoozedUntil: timestamp("snoozed_until"),
		threadId: text("thread_id"),
		// RFC 5322 threading headers, kept so replies land in the right conversation
		// and so outgoing replies can carry them on to the recipient's client.
		inReplyTo: text("in_reply_to"),
		references: text("references_header"),
		/** Whether the message offers a way to unsubscribe (List-Unsubscribe header or a body link), so lists can show the action without reading the raw MIME. */
		hasUnsubscribe: bool("has_unsubscribe").notNull().default(false),
		/** The user's answer to the calendar invitation this message carries: accepted, tentative or declined; null until answered. */
		inviteResponse: text("invite_response"),
		spamScore: integer("spam_score"),
		spamVerdict: text("spam_verdict", { enum: ["inbox", "suspicious", "spam"] }),
		spamSignals: text("spam_signals"),
		spamAnalyzedAt: timestamp("spam_analyzed_at"),
		spamAnalysisError: text("spam_analysis_error"),
		/** When the message last entered Trash or Spam; maintained by the `messages_trashed_at_*` triggers. */
		trashedAt: timestamp("trashed_at"),
		/** `promotions` from bulk-mail headers or a manual move. `primary` is an explicit "not promotions" marker (Move to Inbox) that the backfill must not reclassify. Null is a normal message or one not classified yet; every reader treats `primary` like null. */
		category: text("category", { enum: ["promotions", "primary"] }),
		/** Lower-cased bare From address, grouped on by Subscriptions. Null when longer than 191 characters, never truncated. */
		senderAddress: text("sender_address"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		index("messages_user_created_idx").on(t.userId, t.createdAt),
		index("messages_mailbox_idx").on(t.mailboxId),
		index("messages_folder_idx").on(t.folderId),
		index("messages_thread_idx").on(t.mailboxId, t.threadId),
		index("messages_provider_message_idx").on(t.mailboxId, t.providerMessageId),
		index("messages_raw_r2_key_idx").on(t.rawR2Key),
		index("messages_trashed_at_idx").on(t.trashedAt),
		index("messages_category_page_idx").on(
			t.mailboxId,
			t.category,
			t.status,
			desc(t.createdAt),
			desc(t.id),
		),
		// Covers the Promotions count (equality columns first, then the grouped and filtered `read` and `snoozed_until`).
		index("messages_category_count_idx").on(t.mailboxId, t.category, t.direction, t.status, t.read, t.snoozedUntil),
		// Serves the bounded sender re-file (one sender, newest first) and the Subscriptions sender grouping.
		index("messages_sender_idx").on(t.mailboxId, t.senderAddress, t.createdAt),
		index("messages_inbox_page_idx").on(
			t.mailboxId,
			t.status,
			desc(t.createdAt),
			desc(t.id),
		),
		index("messages_thread_key_idx").on(
			t.mailboxId,
			t.status,
			sql`coalesce(${t.threadId}, ${t.id})`,
			t.createdAt,
		),
		index("messages_mailbox_thread_key_idx").on(t.mailboxId, sql`coalesce(${t.threadId}, ${t.id})`),
		index("messages_nav_cover_idx").on(
			t.mailboxId,
			t.status,
			desc(t.createdAt),
			desc(t.id),
			t.direction,
			t.read,
			t.threadId,
			t.snoozedUntil,
			// The draft filter (user_id = ? OR NOT private_draft) is evaluated from the index too.
			t.userId,
			t.privateDraft,
		),
		// Covering index for the folder-counts GROUP BY: lets the counts
		// endpoint stream grouped rows straight off the index instead of
		// sorting the whole table.
		index("messages_counts_cover_idx").on(
			t.mailboxId,
			t.direction,
			t.status,
			t.read,
			t.starred,
			t.snoozedUntil,
			// The draft filter (user_id = ? OR NOT private_draft) is evaluated from the index too.
			t.userId,
			t.privateDraft,
		),
		// Conversation paging partitions by coalesce(thread_id, id) and orders
		// each partition by created_at desc, so the thread key must precede
		// created_at for the index to feed the window in sorted order. The
		// snoozed_until filter rides the tail column and never touches the
		// table.
		index("messages_conv_cover_idx").on(
			t.mailboxId,
			t.status,
			sql`coalesce(${t.threadId}, ${t.id})`,
			t.createdAt,
			t.id,
			t.snoozedUntil,
		),
	],
);

/**
 * Which labels each message carries (no surrogate id). Writes go through `src/lib/labels/service.ts`; triggers log an
 * `updated` Email change and bump the mailbox revision per row, and refuse a label from another mailbox.
 */
export const messageLabels = sqliteTable(
	"message_labels",
	{
		messageId: text("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		labelId: text("label_id")
			.notNull()
			.references(() => labels.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().default(nowSeconds),
	},
	(t) => [
		uniqueIndex("message_labels_message_label_idx").on(t.messageId, t.labelId),
		index("message_labels_label_message_idx").on(t.labelId, t.messageId),
	],
);

export const spamTokenStats = sqliteTable(
	"spam_token_stats",
	{
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		token: text("token").notNull(),
		spamCount: integer("spam_count").notNull().default(0),
		hamCount: integer("ham_count").notNull().default(0),
		updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("spam_token_stats_mailbox_token_idx").on(t.mailboxId, t.token),
		index("spam_token_stats_mailbox_idx").on(t.mailboxId),
	],
);

export const spamReputation = sqliteTable(
	"spam_reputation",
	{
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		type: text("type", { enum: ["email", "domain", "fingerprint"] }).notNull(),
		key: text("key").notNull(),
		messagesSeen: integer("messages_seen").notNull().default(0),
		spamCount: integer("spam_count").notNull().default(0),
		hamCount: integer("ham_count").notNull().default(0),
		firstSeenAt: timestamp("first_seen_at").notNull().$defaultFn(() => new Date()),
		lastSeenAt: timestamp("last_seen_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("spam_reputation_mailbox_type_key_idx").on(t.mailboxId, t.type, t.key),
		index("spam_reputation_mailbox_idx").on(t.mailboxId),
	],
);

export const spamFeedback = sqliteTable(
	"spam_feedback",
	{
		messageId: text("message_id").primaryKey().references(() => messages.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
		classification: text("classification", { enum: ["spam", "ham"] }).notNull(),
		trainingTokens: text("training_tokens").notNull(),
		reputationKeys: text("reputation_keys").notNull(),
		tokenizerVersion: integer("tokenizer_version").notNull().default(1),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
		updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		index("spam_feedback_mailbox_idx").on(t.mailboxId),
		index("spam_feedback_actor_user_idx").on(t.actorUserId),
	],
);

export const messageAttachments = sqliteTable(
	"message_attachments",
	{
		id: text("id").primaryKey(),
		messageId: text("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		filename: text("filename").notNull(),
		contentType: text("content_type").notNull(),
		size: integer("size").notNull(),
		disposition: text("disposition", { enum: ["attachment", "inline"] })
			.notNull()
			.default("attachment"),
		contentId: text("content_id"),
		r2Key: text("r2_key").notNull().unique(),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("message_attachments_message_idx").on(t.messageId)],
);

export const sharedAttachmentLinks = sqliteTable("shared_attachment_links", {
	id: text("id").primaryKey(),
	attachmentId: text("attachment_id").notNull().references(() => messageAttachments.id, { onDelete: "cascade" }).unique(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
});

export const outboundJobs = sqliteTable("outbound_jobs", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
	status: text("status", { enum: ["queued", "sending", "sent", "failed"] }).notNull().default("queued"),
	payload: text("payload").notNull(),
	error: text("error"),
	scheduledAt: timestamp("scheduled_at"),
	createdAt: timestamp("created_at")
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [
	index("outbound_jobs_user_idx").on(t.userId),
	index("outbound_jobs_message_idx").on(t.messageId),
]);

/** One row per sent message that carries an open-tracking pixel; the token is the pixel URL's secret. */
export const messageTracking = sqliteTable(
	"message_tracking",
	{
		token: text("token").primaryKey(),
		messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
		/** Opens that were not classified as automated prefetches. */
		openCount: integer("open_count").notNull().default(0),
		firstOpenedAt: timestamp("first_opened_at"),
		lastOpenedAt: timestamp("last_opened_at"),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("message_tracking_message_idx").on(t.messageId)],
);

/** Hostname under a domain that serves its read-receipt pixels, so the pixel matches the sender. */
export const domainTrackingHosts = sqliteTable(
	"domain_tracking_hosts",
	{
		domainId: text("domain_id").primaryKey().references(() => domains.id, { onDelete: "cascade" }),
		hostname: text("hostname").notNull(),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("domain_tracking_hosts_hostname_idx").on(t.hostname)],
);

/** Recipients that bounced or complained, per sending domain. Whether it is enforced is `app_settings.suppression_mode`. */
export const emailSuppressions = sqliteTable(
	"email_suppressions",
	{
		id: text("id").primaryKey(),
		domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		reason: text("reason", { enum: ["hard_bounce", "complaint", "manual"] }).notNull(),
		source: text("source", { enum: ["resend", "dsn", "admin"] }).notNull(),
		detail: text("detail"),
		/** Only confirmed entries are enforced. A single returned message (DSN) can be forged by a co-recipient, so it is stored unconfirmed. */
		confirmed: bool("confirmed").notNull().default(true),
		/** Message-ID of the first message a DSN named; a DSN about a different message corroborates the entry. */
		evidenceRef: text("evidence_ref"),
		eventCount: integer("event_count").notNull().default(1),
		firstEventAt: timestamp("first_event_at").notNull().$defaultFn(() => new Date()),
		lastEventAt: timestamp("last_event_at").notNull().$defaultFn(() => new Date()),
		createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
	},
	(t) => [
		uniqueIndex("email_suppressions_domain_email_idx").on(t.domainId, t.email),
		index("email_suppressions_created_by_idx").on(t.createdByUserId),
	],
);

/** DMARC reporting per sending domain. No row means off. */
export const domainDeliverability = sqliteTable("domain_deliverability", {
	domainId: text("domain_id").primaryKey().references(() => domains.id, { onDelete: "cascade" }),
	reportsEnabled: bool("reports_enabled").notNull().default(false),
	reportsEnabledAt: timestamp("reports_enabled_at"),
	alertEmail: bool("alert_email").notNull().default(false),
	lastReportAt: timestamp("last_report_at"),
	updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	/** The `_dmarc` record text MyMailbox created because none existed, so turning reports off can remove it again (only while it is unchanged). */
	dmarcCreatedRecord: text("dmarc_created_record"),
	/** TLS-RPT reporting (`_smtp._tls`) shares the DMARC report address, so it needs `reportsEnabled`. */
	tlsRptEnabled: bool("tls_rpt_enabled").notNull().default(false),
	/** The MTA-STS policy this domain publishes. `none` with a policy id means the removal period is running; no policy id means off. */
	mtaStsMode: text("mta_sts_mode", { enum: ["none", "testing", "enforce"] }).notNull().default("none"),
	/** The `id` of the `_mta-sts` TXT record; it changes whenever the policy changes. */
	mtaStsPolicyId: text("mta_sts_policy_id"),
	/** JSON array of the MX host names listed in the policy. */
	mtaStsMx: text("mta_sts_mx"),
	mtaStsMaxAge: integer("mta_sts_max_age").notNull().default(604800),
	/** The longest max_age any policy served since this one was first published: the removal period waits that long so no sender still caches an older policy. */
	mtaStsServedMaxAge: integer("mta_sts_served_max_age"),
	/** When the admin last confirmed from the browser that the policy host serves the expected policy. */
	mtaStsVerifiedAt: timestamp("mta_sts_verified_at"),
	/** While the removal policy (`mode: none`) is served: when the `_mta-sts` record may be deleted. */
	mtaStsRetireAfter: timestamp("mta_sts_retire_after"),
});

/** One row per aggregate report mail. The raw XML is never stored. */
export const deliverabilityReports = sqliteTable(
	"deliverability_reports",
	{
		id: text("id").primaryKey(),
		domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: ["dmarc", "tlsrpt"] }).notNull().default("dmarc"),
		/** sha256 of reporter org and report id; the same report arriving twice conflicts here. */
		reportKey: text("report_key").notNull(),
		reporterOrg: text("reporter_org"),
		reporterEmail: text("reporter_email"),
		externalReportId: text("external_report_id"),
		dateBegin: timestamp("date_begin"),
		dateEnd: timestamp("date_end"),
		policyP: text("policy_p"),
		policyPct: integer("policy_pct"),
		recordCount: integer("record_count").notNull().default(0),
		messageCount: integer("message_count").notNull().default(0),
		/** The report mail itself passed DMARC by the trusted-verdict rules. */
		authenticated: bool("authenticated").notNull().default(false),
		/** Organisational domain of the mail's From header; only meaningful when `authenticated`. */
		senderDomain: text("sender_domain"),
		/** Authenticated AND the From organisation equals the organisation of the report's own contact email. Only these write aggregates. */
		verifiedReporter: bool("verified_reporter").notNull().default(false),
		/** Aggregate rows this report was allowed to write; the daily budgets are sums of it. */
		statsRows: integer("stats_rows").notNull().default(0),
		status: text("status", { enum: ["processing", "ok", "rejected", "failed", "unverified", "over_budget"] }).notNull().default("processing"),
		error: text("error"),
		receivedAt: timestamp("received_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("deliverability_reports_domain_key_idx").on(t.domainId, t.reportKey),
		index("deliverability_reports_domain_received_idx").on(t.domainId, t.receivedAt),
		index("deliverability_reports_received_idx").on(t.receivedAt),
	],
);

/** Daily DMARC aggregates from verified reporters only, one row per (day, source, result). `day` is the UTC day the report window began; `reporterOrg` is the verified reporter's organisational domain. */
export const dmarcDailyStats = sqliteTable(
	"dmarc_daily_stats",
	{
		id: autoId("id"),
		domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
		day: text("day").notNull(),
		rowKey: text("row_key").notNull(),
		sourceIp: text("source_ip").notNull(),
		sourceHost: text("source_host"),
		reporterOrg: text("reporter_org").notNull(),
		headerFrom: text("header_from").notNull(),
		disposition: text("disposition", { enum: ["none", "quarantine", "reject"] }).notNull(),
		dkimAligned: bool("dkim_aligned").notNull(),
		spfAligned: bool("spf_aligned").notNull(),
		messageCount: integer("message_count").notNull().default(0),
	},
	(t) => [
		uniqueIndex("dmarc_daily_stats_domain_day_key_idx").on(t.domainId, t.day, t.rowKey),
		index("dmarc_daily_stats_day_idx").on(t.day),
	],
);

/**
 * Daily TLS-RPT (RFC 8460) totals from verified reporters only. One row per (day, reporter, policy, result): the
 * summary success count sits on the row with an empty `resultType`, each failure type on its own row, so an upsert
 * only ever adds integers and needs no JSON merge.
 */
export const tlsDailyStats = sqliteTable(
	"tls_daily_stats",
	{
		id: autoId("id"),
		domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
		day: text("day").notNull(),
		rowKey: text("row_key").notNull(),
		reporterOrg: text("reporter_org").notNull(),
		policyType: text("policy_type").notNull(),
		mxHost: text("mx_host"),
		resultType: text("result_type").notNull(),
		successCount: integer("success_count").notNull().default(0),
		failureCount: integer("failure_count").notNull().default(0),
	},
	(t) => [
		uniqueIndex("tls_daily_stats_domain_day_key_idx").on(t.domainId, t.day, t.rowKey),
		index("tls_daily_stats_day_idx").on(t.day),
	],
);

export const deliverabilityAlerts = sqliteTable(
	"deliverability_alerts",
	{
		id: text("id").primaryKey(),
		domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: ["spoofing", "auth_regression", "no_reports"] }).notNull(),
		day: text("day").notNull(),
		detail: text("detail").notNull(),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
		acknowledgedAt: timestamp("acknowledged_at"),
		acknowledgedByUserId: text("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
	},
	(t) => [
		uniqueIndex("deliverability_alerts_domain_kind_day_idx").on(t.domainId, t.kind, t.day),
		index("deliverability_alerts_ack_user_idx").on(t.acknowledgedByUserId),
	],
);

export const messageOpens = sqliteTable(
	"message_opens",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().references(() => messageTracking.token, { onDelete: "cascade" }),
		openedAt: timestamp("opened_at").notNull(),
		client: text("client"),
		device: text("device"),
		country: text("country"),
		city: text("city"),
		automated: bool("automated").notNull().default(false),
	},
	(t) => [index("message_opens_token_idx").on(t.token, t.openedAt)],
);

/**
 * Per-user composer defaults. Kept out of `users` because every session
 * lookup selects the whole users row.
 */
export const userComposePreferences = sqliteTable("user_compose_preferences", {
	userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
	trackOpensDefault: bool("track_opens_default").notNull().default(false),
	undoSendSeconds: integer("undo_send_seconds").notNull().default(15),
	updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
});

/**
 * "Remind me if there is no reply": a sent message whose thread comes back to the
 * inbox at `dueAt` unless an inbound message joined the thread after it.
 */
export const followUps = sqliteTable(
	"follow_ups",
	{
		id: text("id").primaryKey(),
		messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		dueAt: timestamp("due_at").notNull(),
		status: text("status", { enum: ["pending", "due", "replied", "dismissed"] }).notNull().default("pending"),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("follow_ups_message_idx").on(t.messageId),
		index("follow_ups_status_due_idx").on(t.status, t.dueAt),
		index("follow_ups_user_status_idx").on(t.userId, t.status),
	],
);

/**
 * Notes on a conversation, shared with everyone who can read the mailbox.
 * `threadKey` is the conversation key the message list uses: the thread id, or
 * the lone message's id when the conversation was never threaded. `messageId`
 * is set when the note is about one email of the conversation.
 */
export const conversationNotes = sqliteTable(
	"conversation_notes",
	{
		id: text("id").primaryKey(),
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		threadKey: text("thread_key").notNull(),
		messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
		html: text("html").notNull(),
		authorUserId: text("author_user_id").references((): AnySQLiteColumn => users.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
		updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		index("conversation_notes_mailbox_thread_idx").on(t.mailboxId, t.threadKey, t.createdAt),
		index("conversation_notes_message_idx").on(t.messageId),
		index("conversation_notes_author_idx").on(t.authorUserId),
	],
);

/** Per-mailbox Promotions mode. A missing row means `off`; mail delivery never depends on this table. */
export const mailboxPromotionSettings = sqliteTable(
	"mailbox_promotion_settings",
	{
		mailboxId: text("mailbox_id").primaryKey().references(() => mailboxes.id, { onDelete: "cascade" }),
		mode: text("mode", { enum: ["off", "show", "separate"] }).notNull().default("off"),
		backfillStatus: text("backfill_status", { enum: ["idle", "pending", "running", "done", "failed"] }).notNull().default("idle"),
		backfillCursor: text("backfill_cursor"),
		/** Consecutive backfill takeovers that made no progress; the job is marked failed after 3. */
		backfillStalls: integer("backfill_stalls").notNull().default(0),
		backfillError: text("backfill_error"),
		/** UTC day number (`floor(ms / 86_400_000)`) that `backfill_day_rows` counts rows for; the installation-wide daily cap sums the rows of today. */
		backfillDay: integer("backfill_day").notNull().default(0),
		backfillDayRows: integer("backfill_day_rows").notNull().default(0),
		backfillScanned: integer("backfill_scanned").notNull().default(0),
		updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [index("mailbox_promotion_settings_backfill_idx").on(t.backfillStatus)],
);

/** Per-sender override ("always Inbox" / "always Promotions") and unsubscribe record, keyed on the exact sender address. */
export const mailboxSenderPreferences = sqliteTable(
	"mailbox_sender_preferences",
	{
		id: text("id").primaryKey(),
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		senderAddress: text("sender_address").notNull(),
		categoryOverride: text("category_override", { enum: ["inbox", "promotions"] }),
		unsubscribedAt: timestamp("unsubscribed_at"),
		updatedByUserId: text("updated_by_user_id").references((): AnySQLiteColumn => users.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("mailbox_sender_preferences_mailbox_sender_idx").on(t.mailboxId, t.senderAddress),
		index("mailbox_sender_preferences_updated_by_idx").on(t.updatedByUserId),
	],
);

export const emailTemplates = sqliteTable(
	"email_templates",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		subject: text("subject").notNull().default(""),
		textBody: text("text_body").notNull().default(""),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
		updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [index("email_templates_user_idx").on(t.userId)],
);

export const calendarEvents = sqliteTable(
	"calendar_events",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		location: text("location").notNull().default(""),
		attendees: text("attendees").notNull().default("[]"),
		color: text("color").notNull().default("blue"),
		repeat: text("repeat", { enum: ["none", "daily", "weekly", "monthly", "weekdays", "yearly"] }).notNull().default("none"),
		repeatDays: text("repeat_days").notNull().default("[]"),
		repeatAnchorDay: integer("repeat_anchor_day"),
		repeatUntil: timestamp("repeat_until"),
		/** Step between recurrences: every N days/weeks/months/years. */
		repeatInterval: integer("repeat_interval").notNull().default(1),
		/** Weekday (0-6) and week-of-month (1-5, -1 = last) for nth-weekday monthly repeats. */
		repeatWeekday: integer("repeat_weekday"),
		repeatWeek: integer("repeat_week"),
		excludedOccurrences: text("excluded_occurrences").notNull().default("[]"),
		timeZone: text("time_zone"),
		startsAt: timestamp("starts_at").notNull(),
		endsAt: timestamp("ends_at").notNull(),
		/** Minutes before an occurrence's start to send a push reminder; null means no reminder. */
		reminderMinutes: integer("reminder_minutes"),
		/** Start of the latest occurrence a reminder was sent for; dedupes the five-minute cron. */
		lastRemindedStart: timestamp("last_reminded_start"),
		/** null for events the user made; "needs-action", "tentative" or "accepted" for events created from an emailed invitation. */
		responseStatus: text("response_status"),
		/** Message that carried the invitation, so the calendar can answer it. */
		inviteMessageId: text("invite_message_id"),
		/** Lower-case address of the sender whose invitation created the event; only that sender's mail may change it. */
		inviteSender: text("invite_sender"),
		/** SEQUENCE of the invitation revision the event reflects, so an older revision arriving late is ignored. */
		inviteSequence: integer("invite_sequence"),
		/** Outgoing iTIP revision counter; every sent invitation or update bumps SEQUENCE so guests ignore stale mail. */
		eventSequence: integer("event_sequence").notNull().default(0),
		/** JSON map of guest address to accepted, tentative or declined, filled from their replies to an invitation this user sent. */
		attendeeResponses: text("attendee_responses"),
		createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
		updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		index("calendar_events_user_starts_idx").on(t.userId, t.startsAt),
		index("calendar_events_mailbox_idx").on(t.mailboxId),
	],
);

/**
 * Per-occurrence edits of a recurring series (RECURRENCE-ID): null fields
 * inherit the series value. Fully deleted occurrences stay in
 * `excludedOccurrences` on the series instead.
 */
export const calendarEventOverrides = sqliteTable(
	"calendar_event_overrides",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id")
			.notNull()
			.references(() => calendarEvents.id, { onDelete: "cascade" }),
		/** Start of the overridden occurrence, epoch ms. */
		occurrenceMs: integer("occurrence_ms").notNull(),
		startsAt: timestamp("starts_at").notNull(),
		endsAt: timestamp("ends_at").notNull(),
		title: text("title"),
		description: text("description"),
		location: text("location"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp("updated_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("calendar_event_overrides_event_occurrence_idx").on(t.eventId, t.occurrenceMs),
		index("calendar_event_overrides_event_idx").on(t.eventId),
	],
);

/**
 * Cancellation memory for invitations this user sent: the SEQUENCE of the last
 * CANCEL per UID, so a late RSVP arriving after cancellation is ignored. The
 * id is a caller-provided hash of userId and UID.
 */
export const calendarInviteTombstones = sqliteTable(
	"calendar_invite_tombstones",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		inviteSequence: integer("invite_sequence").notNull().default(0),
		inviteSender: text("invite_sender").notNull().default(""),
		cancelledAt: timestamp("cancelled_at").notNull(),
	},
	(t) => [index("calendar_invite_tombstones_user_idx").on(t.userId)],
);

/**
 * Latest RSVP per guest per occurrence of an invitation this user sent. The id
 * is a caller-provided hash of eventId, occurrenceMs and guest.
 */
export const calendarOccurrenceResponses = sqliteTable(
	"calendar_occurrence_responses",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id")
			.notNull()
			.references(() => calendarEvents.id, { onDelete: "cascade" }),
		/** Start of the occurrence the guest answered, epoch ms. */
		occurrenceMs: integer("occurrence_ms").notNull(),
		guest: text("guest").notNull(),
		status: text("status").notNull(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("calendar_occurrence_responses_event_occurrence_guest_idx").on(t.eventId, t.occurrenceMs, t.guest),
		index("calendar_occurrence_responses_event_idx").on(t.eventId),
	],
);

export const routingRules = sqliteTable(
	"routing_rules",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.id, { onDelete: "cascade" }),
		// "mailbox" rules run after delivery: they add a label (and may skip the inbox) or move to spam/trash.
		// "domain" rules run during address resolution and can catch-all, forward, or reject.
		scope: text("scope", { enum: ["mailbox", "domain"] }).notNull().default("mailbox"),
		name: text("name"),
		enabled: bool("enabled").notNull().default(true),
		pattern: text("pattern").notNull(),
		matchField: text("match_field", {
			enum: ["email", "content", "title", "sender", "recipient", "mail_type"],
		})
			.notNull()
			.default("email"),
		matchOperator: text("match_operator", {
			enum: ["contains", "exact", "starts_with", "ends_with", "regex"],
		})
			.notNull()
			.default("contains"),
		matchValue: text("match_value").notNull().default(""),
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
		labelId: text("label_id").references(() => labels.id, { onDelete: "set null" }),
		/** A matching `store` rule also archives the message, so it skips the inbox (Gmail's "Skip the Inbox"). */
		skipInbox: bool("skip_inbox").notNull().default(false),
		action: text("action", { enum: ["store", "forward", "reject", "spam", "trash"] }).notNull().default("store"),
		forwardTo: text("forward_to"),
		// Forward actions drop the message by default; keepCopy also delivers it to the mailbox.
		keepCopy: bool("keep_copy").notNull().default(false),
		rejectReason: text("reject_reason"),
		priority: integer("priority").notNull().default(0),
		lastMatchedAt: timestamp("last_matched_at"),
		matchCount: integer("match_count").notNull().default(0),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		index("routing_rules_domain_scope_idx").on(t.domainId, t.scope, t.enabled),
		index("routing_rules_mailbox_idx").on(t.mailboxId),
		index("routing_rules_priority_idx").on(t.priority),
		index("routing_rules_user_idx").on(t.userId),
		index("routing_rules_label_idx").on(t.labelId),
	],
);

export const webhooks = sqliteTable("webhooks", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	description: text("description"),
	url: text("url").notNull(),
	secret: text("secret").notNull(),
	events: text("events").notNull(),
	enabled: bool("enabled").notNull().default(true),
	maxAttempts: integer("max_attempts").notNull().default(5),
	createdAt: timestamp("created_at")
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [index("webhooks_user_idx").on(t.userId)]);

export const webhookDeliveries = sqliteTable(
	"webhook_deliveries",
	{
		id: text("id").primaryKey(),
		webhookId: text("webhook_id")
			.notNull()
			.references(() => webhooks.id, { onDelete: "cascade" }),
		eventType: text("event_type").notNull(),
		payload: text("payload").notNull(),
		// pending | delivered | failed | retrying | exhausted
		status: text("status").notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		responseStatus: integer("response_status"),
		error: text("error"),
		durationMs: integer("duration_ms"),
		lastAttemptAt: timestamp("last_attempt_at"),
		nextRetryAt: timestamp("next_retry_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt),
		index("webhook_deliveries_status_idx").on(t.status),
	],
);

export const sessions = sqliteTable("sessions", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	tokenHash: text("token_hash").notNull().unique(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at")
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const pushSubscriptions = sqliteTable(
	"push_subscriptions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		sessionId: text("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		endpoint: text("endpoint").notNull(),
		p256dh: text("p256dh").notNull(),
		auth: text("auth").notNull(),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp("updated_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
		index("push_subscriptions_user_idx").on(t.userId),
		index("push_subscriptions_session_idx").on(t.sessionId),
	],
);

/** Single-use links mailed to a user's recovery address. Only the hash is stored. */
export const passwordResetTokens = sqliteTable(
	"password_reset_tokens",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull().unique(),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("password_reset_tokens_user_idx").on(t.userId)],
);

/** One-time backup codes for accounts with TOTP, hashed like session tokens. */
export const mfaRecoveryCodes = sqliteTable(
	"mfa_recovery_codes",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		codeHash: text("code_hash").notNull().unique(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("mfa_recovery_codes_user_idx").on(t.userId)],
);

/**
 * A password that checked out but still needs a second factor. The challenge
 * token stands in for the password on the follow-up request, so the password
 * is never held client-side between the two steps.
 */
export const loginChallenges = sqliteTable("login_challenges", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	tokenHash: text("token_hash").notNull().unique(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at")
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [index("login_challenges_user_idx").on(t.userId)]);

/**
 * A WebAuthn credential. The credential id is public, so it is stored in full
 * for backup and display; lookups go through its SHA-256 hash, which keeps
 * the index small. Key material is stored as base64url text so backups stay
 * plain JSON.
 */
export const passkeyCredentials = sqliteTable(
	"passkey_credentials",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		credentialId: text("credential_id").notNull(),
		credentialHash: text("credential_hash").notNull().unique(),
		publicKey: text("public_key").notNull(),
		counter: integer("counter").notNull().default(0),
		transports: text("transports"),
		deviceType: text("device_type").notNull(),
		backedUp: bool("backed_up").notNull().default(false),
		/** Authenticator model identifier, used only to suggest a friendly default name. */
		aaguid: text("aaguid"),
		/** Empty means "show the provider or a dated default"; the user can rename it. */
		name: text("name").notNull(),
		lastUsedAt: timestamp("last_used_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("passkey_credentials_user_idx").on(t.userId)],
);

/**
 * Server-side WebAuthn ceremony state. Every row is single-use and bound to a
 * browser cookie, session, login challenge, or enrollment grant.
 */
export const webauthnChallenges = sqliteTable(
	"webauthn_challenges",
	{
		id: text("id").primaryKey(),
		ceremonyHash: text("ceremony_hash").notNull().unique(),
		challenge: text("challenge").notNull(),
		purpose: text("purpose", { enum: ["login", "mfa", "register", "step_up", "check", "enroll", "recovery"] }).notNull(),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		bindingHash: text("binding_hash").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("webauthn_challenges_user_idx").on(t.userId), index("webauthn_challenges_expires_idx").on(t.expiresAt)],
);

/**
 * A short-lived, single-use permission to enrol a passkey. Created for the
 * first-run passkey account, a recovery-code flow, or an administrator who
 * sends a recovery link. Never a session: it may only reach enrolment routes.
 */
export const passkeyEnrollmentGrants = sqliteTable(
	"passkey_enrollment_grants",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull().unique(),
		kind: text("kind", { enum: ["setup", "recovery", "admin"] }).notNull(),
		createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("passkey_enrollment_grants_user_idx").on(t.userId)],
);

/**
 * Proof that the current session re-authenticated recently, for one sensitive
 * security change. Bound to the session token hash and consumed once.
 */
export const authStepUps = sqliteTable(
	"auth_step_ups",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		sessionHash: text("session_hash").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		/** The exact action and, for administrator actions, the account it may affect. */
		purpose: text("purpose").notNull(),
		targetUserId: text("target_user_id"),
		/** The target account's security_version at the time the grant was issued. */
		securityVersion: integer("security_version").notNull().default(0),
		/** The acting account's security_version at the time the grant was issued. */
		actorSecurityVersion: integer("actor_security_version").notNull().default(0),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("auth_step_ups_user_idx").on(t.userId)],
);

export const auditLogs = sqliteTable(
	"audit_logs",
	{
		id: text("id").primaryKey(),
		actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
		targetUserId: text("target_user_id").references(() => users.id, { onDelete: "set null" }),
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
		messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
		action: text("action").notNull(),
		metadata: text("metadata"),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		index("audit_logs_actor_idx").on(t.actorUserId),
		index("audit_logs_mailbox_idx").on(t.mailboxId),
		index("audit_logs_created_idx").on(t.createdAt),
		index("audit_logs_message_id_idx").on(t.messageId),
		index("audit_logs_target_user_idx").on(t.targetUserId),
	],
);

export const backupSettings = sqliteTable("backup_settings", {
	id: text("id").primaryKey(),
	enabled: bool("enabled").notNull().default(false),
	scheduleType: text("schedule_type", { enum: ["daily", "weekly", "monthly"] })
		.notNull()
		.default("daily"),
	scheduleValue: integer("schedule_value"),
	retentionEnabled: bool("retention_enabled").notNull().default(false),
	retentionDays: integer("retention_days").notNull().default(30),
	excludedTableGroups: text("excluded_table_groups").notNull().default("[]"),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$defaultFn(() => new Date()),
});

export const appSettings = sqliteTable("app_settings", {
	id: text("id").primaryKey(),
	appName: text("app_name").notNull().default("MyMailbox"),
	outboundAttachmentMaxMb: integer("outbound_attachment_max_mb").notNull().default(25),
	resendApiKey: text("resend_api_key"),
	resendWebhookId: text("resend_webhook_id"),
	resendWebhookSecret: text("resend_webhook_secret"),
	iconKey: text("icon_key"),
	/** Spam analysis lookups; the SPAMHAUS_DQS_KEY and ABUSECH_AUTH_KEY env vars apply when these are null. */
	spamhausDqsKey: text("spamhaus_dqs_key"),
	abusechAuthKey: text("abusech_auth_key"),
	spamDomainAgeCheck: bool("spam_domain_age_check").notNull().default(true),
	/** JSON: brands the administrator added for display-name impersonation checks (see src/lib/spam/settings.ts). */
	spamBrands: text("spam_brands"),
	/** "off" ignores bounce and complaint events, "record" stores them, "enforce" also refuses to send to those recipients. */
	suppressionMode: text("suppression_mode", { enum: ["off", "record", "enforce"] }).notNull().default("off"),
	/** Resend webhook for email.bounced and email.complained; separate from the receiving webhook above. */
	resendEventsWebhookId: text("resend_events_webhook_id"),
	resendEventsWebhookSecret: text("resend_events_webhook_secret"),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$defaultFn(() => new Date()),
});

export const backups = sqliteTable(
	"backups",
	{
		id: text("id").primaryKey(),
		status: text("status", { enum: ["queued", "running", "completed", "failed"] })
			.notNull()
			.default("queued"),
		trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
		r2Key: text("r2_key"),
		filename: text("filename"),
		size: integer("size"),
		error: text("error"),
		createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at")
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
	},
	(t) => [
		index("backups_created_idx").on(t.createdAt),
		index("backups_status_idx").on(t.status),
		index("backups_created_by_idx").on(t.createdByUserId),
	],
);

/** Per-key mailbox allowlist for API keys and app passwords whose `mailbox_scope_enabled` is set. */
export const apiKeyMailboxes = sqliteTable("api_key_mailboxes", {
	keyId: text("key_id").notNull().references(() => apiKeys.id, { onDelete: "cascade" }),
	mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
}, (t) => [
	uniqueIndex("api_key_mailbox_idx").on(t.keyId, t.mailboxId),
	index("api_key_mailboxes_mailbox_idx").on(t.mailboxId),
]);

export const schema = {
	users,
	domains,
	mailboxes,
	mailboxAliases,
	autoReplyDeliveries,
	mailboxAccess,
	contacts,
	labels,
	apiKeys,
	messages,
	messageLabels,
	spamTokenStats,
	spamReputation,
	spamFeedback,
	messageAttachments,
	sharedAttachmentLinks,
	outboundJobs,
	emailTemplates,
	calendarEvents,
	calendarEventOverrides,
	calendarInviteTombstones,
	calendarOccurrenceResponses,
	routingRules,
	webhooks,
	webhookDeliveries,
	sessions,
	pushSubscriptions,
	auditLogs,
	backupSettings,
	backups,
	appSettings,
	apiKeyMailboxes,
};
