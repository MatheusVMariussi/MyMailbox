import { defineConfig } from "drizzle-kit";

// SQLite (D1).
export default defineConfig({
	schema: "./src/db/schema/index.ts",
	out: "./drizzle/migrations",
	dialect: "sqlite",
});
