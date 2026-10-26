// The account store on Wasmer's managed PostgreSQL (DB_HOST and friends).
// pg is imported only here, when a database is configured. init() applies
// the migrations in server/db/migrations/ in name order, each once, recorded
// in schema_migrations; an advisory lock makes instances starting together
// take turns.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nameKey } from "../../public/engine/names.js";
import { StoreError } from "./memory.js";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
// Any fixed number: the key of the advisory lock the migrations run under.
const MIGRATION_LOCK = 4_071_966;

const readdir = (dir) => new Promise((resolve, reject) => fs.readdir(dir, (err, names) => (err ? reject(err) : resolve(names))));
const readText = (file) => new Promise((resolve, reject) => fs.readFile(file, "utf8", (err, text) => (err ? reject(err) : resolve(text))));

const toUser = (row) => row && { id: row.id, name: row.name, googleSub: row.google_sub, email: row.email, createdAt: row.created_at.getTime() };

// A unique violation names its constraint; anything else is passed on.
function uniqueError(err) {
  if (err.code !== "23505") return err;
  return new StoreError(String(err.constraint).includes("name_key") ? "name_taken" : "google_taken");
}

// db: { host, port, database, user, password }. TLS without checking the
// certificate, as Wasmer's managed database needs.
export async function createPostgresStore(db, { migrationsDir = MIGRATIONS_DIR } = {}) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ ...db, ssl: { rejectUnauthorized: false }, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
  // An idle connection that drops must not crash the server; the next query reconnects.
  pool.on("error", () => {});
  const query = (text, values) => pool.query(text, values);

  return {
    async init() {
      const files = (await readdir(migrationsDir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
        await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
        for (const file of files.filter((f) => !done.has(f))) {
          await client.query(await readText(path.join(migrationsDir, file)));
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
    async userByGoogle(googleSub) {
      return toUser((await query("SELECT * FROM users WHERE google_sub = $1", [googleSub])).rows[0]) ?? null;
    },
    async createUser({ id, name, googleSub, email, createdAt }) {
      try {
        const { rows } = await query(
          "INSERT INTO users (id, name, name_key, google_sub, email, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
          [id, name, nameKey(name), googleSub, email, new Date(createdAt)],
        );
        return toUser(rows[0]);
      } catch (err) {
        throw uniqueError(err);
      }
    },
    async renameUser(id, name) {
      try {
        const { rows } = await query("UPDATE users SET name = $2, name_key = $3 WHERE id = $1 RETURNING *", [id, name, nameKey(name)]);
        return toUser(rows[0]) ?? null;
      } catch (err) {
        throw uniqueError(err);
      }
    },
    async deleteUser(id) {
      // Its sessions go with it (ON DELETE CASCADE).
      await query("DELETE FROM users WHERE id = $1", [id]);
    },
    async createSession({ tokenHash, userId, createdAt, expiresAt }) {
      await query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [tokenHash, userId, new Date(createdAt), new Date(expiresAt)]);
    },
    async session(tokenHash, now) {
      const { rows } = await query(
        "SELECT s.user_id, s.created_at AS session_created_at, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2",
        [tokenHash, new Date(now)],
      );
      const row = rows[0];
      return row ? { userId: row.user_id, createdAt: row.session_created_at.getTime(), expiresAt: row.expires_at.getTime(), user: toUser(row) } : null;
    },
    async renewSession(tokenHash, expiresAt) {
      await query("UPDATE sessions SET expires_at = $2 WHERE token_hash = $1", [tokenHash, new Date(expiresAt)]);
    },
    async deleteSession(tokenHash) {
      await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    },
    async deleteUserSessions(userId) {
      await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    },
    async deleteExpiredSessions(now) {
      await query("DELETE FROM sessions WHERE expires_at <= $1", [new Date(now)]);
    },
  };
}
