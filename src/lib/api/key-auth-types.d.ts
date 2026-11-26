import type { users } from "@/db/schema";

export type ApiAuthResult = {
	/** The API key that authenticated. */
	keyId: string;
	keyKind: "legacy" | "app";
	userId: string;
	email: string;
	scopes: string[];
	mailboxIds: string[] | null;
	user: typeof users.$inferSelect;
};
