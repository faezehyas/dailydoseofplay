// The account store's contract, on the memory store and, with TEST_PG=1, on
// PostgreSQL from DB_HOST, DB_PORT, DB_NAME, DB_USERNAME and DB_PASSWORD
// (a throwaway database: the test drops and recreates the account tables).
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { accountsConfig } from "../server/accounts.js";
import { StoreError, createMemoryStore } from "../server/store/memory.js";
import { createPostgresStore } from "../server/store/postgres.js";

const DAY = 24 * 60 * 60_000;
const stores = { memory: async () => createMemoryStore() };
if (process.env.TEST_PG === "1") {
  stores.postgres = async () => {
    const store = await createPostgresStore(accountsConfig().database);
    const { default: pg } = await import("pg");
    const client = new pg.Client({ ...accountsConfig().database, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query("DROP TABLE IF EXISTS sessions, users, schema_migrations");
    await client.end();
    return store;
  };
}

const id = () => randomBytes(12).toString("base64url");
const user = (name, n = name) => ({ id: id(), name, googleSub: `sub-${n}`, email: `${n}@example.com`.replace(/\s/g, ""), createdAt: Date.now() });

for (const [kind, open] of Object.entries(stores)) {
  test(`${kind} store: users by Google id, unique names without case, rename, delete`, async (t) => {
    const store = await open();
    t.after(() => store.close());
    await store.init();
    await store.init(); // migrations apply once
    const otter = await store.createUser(user("Brave Otter", "otter"));
    assert.equal(otter.name, "Brave Otter");
    assert.equal(otter.email, "otter@example.com");
    assert.deepEqual(await store.userByGoogle("sub-otter"), otter);
    assert.equal(await store.userByGoogle("sub-nobody"), null);
    await assert.rejects(store.createUser(user("BRAVE otter", "other")), (e) => e instanceof StoreError && e.code === "name_taken");
    await assert.rejects(store.createUser({ ...user("Calm Seal"), googleSub: "sub-otter" }), (e) => e instanceof StoreError && e.code === "google_taken");
    const seal = await store.createUser(user("Calm Seal", "seal"));
    await assert.rejects(store.renameUser(seal.id, "brave OTTER"), (e) => e.code === "name_taken");
    assert.equal((await store.renameUser(otter.id, "brave otter")).name, "brave otter", "your own name in another case");
    assert.equal((await store.renameUser(otter.id, "Swift Otter")).name, "Swift Otter");
    assert.equal(await store.renameUser("no-such-id", "Ghost"), null);
    await store.deleteUser(otter.id);
    assert.equal(await store.userByGoogle("sub-otter"), null);
    assert.equal((await store.createUser(user("Brave Otter", "again"))).name, "Brave Otter", "a deleted account's name is free");
  });

  test(`${kind} store: sessions expire, renew, end one at a time, all at once, and with their user`, async (t) => {
    const store = await open();
    t.after(() => store.close());
    await store.init();
    const now = Date.now();
    const a = await store.createUser(user("Lucky Lynx", "lynx"));
    const b = await store.createUser(user("Quiet Owl", "owl"));
    await store.createSession({ tokenHash: "a1", userId: a.id, createdAt: now, expiresAt: now + DAY });
    await store.createSession({ tokenHash: "a2", userId: a.id, createdAt: now, expiresAt: now + DAY });
    await store.createSession({ tokenHash: "b1", userId: b.id, createdAt: now, expiresAt: now + DAY });
    const session = await store.session("a1", now);
    assert.equal(session.userId, a.id);
    assert.equal(session.expiresAt, now + DAY);
    assert.deepEqual(session.user, a);
    assert.equal(await store.session("a1", now + DAY), null, "expired");
    await store.renewSession("a1", now + 2 * DAY);
    assert.equal((await store.session("a1", now + DAY)).expiresAt, now + 2 * DAY);
    await store.deleteSession("a1");
    assert.equal(await store.session("a1", now), null);
    await store.createSession({ tokenHash: "a3", userId: a.id, createdAt: now, expiresAt: now + DAY });
    await store.deleteUserSessions(a.id);
    assert.equal(await store.session("a2", now), null);
    assert.equal(await store.session("a3", now), null);
    assert.ok(await store.session("b1", now), "another user's session stays");
    await store.createSession({ tokenHash: "b2", userId: b.id, createdAt: now, expiresAt: now + 10 });
    await store.deleteExpiredSessions(now + 10);
    assert.equal(await store.session("b2", now), null, "swept");
    assert.ok(await store.session("b1", now));
    await store.deleteUser(b.id);
    assert.equal(await store.session("b1", now), null, "a deleted user's sessions go with it");
  });
}

test("postgres store: migrations are NNN_name.sql files, applied in order", async () => {
  const { readdirSync } = await import("node:fs");
  const { MIGRATIONS_DIR } = await import("../server/store/postgres.js");
  const files = readdirSync(MIGRATIONS_DIR);
  assert.ok(files.length >= 1);
  for (const file of files) assert.match(file, /^\d{3}_[\w-]+\.sql$/, file);
});
