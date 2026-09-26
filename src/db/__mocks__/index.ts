/**
 * Vitest manual mock for `@/db`.
 *
 * Activated in a test file with `vi.mock("@/db")`. Replaces the on-disk
 * `lite-clip.db` with an in-memory SQLite database whose tables are generated
 * directly from the Drizzle schema in `../schema.ts`, so production queries run
 * unchanged against a schema that cannot drift from the code.
 *
 * Note: the SQL files under `./drizzle` are not used because they lag behind the
 * schema (the `settings` table has no CREATE TABLE migration).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import * as schema from "../schema";
import * as relations from "../relations";

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");

const emptySnapshot = await generateSQLiteDrizzleJson({});
const currentSnapshot = await generateSQLiteDrizzleJson(schema);
const statements = await generateSQLiteMigration(emptySnapshot, currentSnapshot);
for (const statement of statements) {
  sqlite.exec(statement);
}

export const db = drizzle(sqlite, { schema: { ...schema, ...relations } });
