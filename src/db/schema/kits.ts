import { sql, type SQL } from "drizzle-orm";
import * as sqlite from "drizzle-orm/sqlite-core";

/**
 * The column and table constructors the schema is written against (SQLite/D1). Timestamps are whole
 * seconds in an integer, booleans are 0/1 integers.
 */
export const kit = {
	table: sqlite.sqliteTable,
	text: sqlite.text,
	integer: (name: string) => sqlite.integer(name),
	bool: (name: string) => sqlite.integer(name, { mode: "boolean" }),
	timestamp: (name: string) => sqlite.integer(name, { mode: "timestamp" }),
	autoId: (name: string) => sqlite.integer(name).primaryKey({ autoIncrement: true }),
	index: sqlite.index,
	uniqueIndex: sqlite.uniqueIndex,
	desc: (column: unknown): SQL | never => sql`${column} desc` as never,
	nowSeconds: sql`(unixepoch())` as SQL,
};
