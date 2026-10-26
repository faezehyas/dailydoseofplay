// The account store in memory: used when DB_HOST is unset, so `npm start` and
// the tests need no database. Everything is gone when the server stops.
// postgres.js has the same interface; test/store.test.js runs on both.
import { nameKey } from "../../public/engine/names.js";

export class StoreError extends Error {
  // code: "name_taken" or "google_taken"
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function createMemoryStore() {
  const users = new Map(); // id -> { id, name, googleSub, email, createdAt }
  const sessions = new Map(); // tokenHash -> { userId, createdAt, expiresAt }
  const copy = (user) => user && { ...user };
  const nameTaken = (name, exceptId) => [...users.values()].some((u) => u.id !== exceptId && nameKey(u.name) === nameKey(name));

  return {
    async init() {},
    async close() {},
    async userByGoogle(googleSub) {
      return copy([...users.values()].find((u) => u.googleSub === googleSub)) ?? null;
    },
    async createUser({ id, name, googleSub, email, createdAt }) {
      if (nameTaken(name)) throw new StoreError("name_taken");
      if ([...users.values()].some((u) => u.googleSub === googleSub)) throw new StoreError("google_taken");
      const user = { id, name, googleSub, email, createdAt };
      users.set(id, user);
      return copy(user);
    },
    async renameUser(id, name) {
      if (!users.has(id)) return null;
      if (nameTaken(name, id)) throw new StoreError("name_taken");
      users.get(id).name = name;
      return copy(users.get(id));
    },
    async deleteUser(id) {
      users.delete(id);
      for (const [hash, s] of sessions) if (s.userId === id) sessions.delete(hash);
    },
    async createSession({ tokenHash, userId, createdAt, expiresAt }) {
      sessions.set(tokenHash, { userId, createdAt, expiresAt });
    },
    // The session and its user, or null when there is none or it has expired.
    async session(tokenHash, now) {
      const s = sessions.get(tokenHash);
      if (!s || s.expiresAt <= now || !users.has(s.userId)) return null;
      return { ...s, user: copy(users.get(s.userId)) };
    },
    async renewSession(tokenHash, expiresAt) {
      const s = sessions.get(tokenHash);
      if (s) s.expiresAt = expiresAt;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async deleteUserSessions(userId) {
      for (const [hash, s] of sessions) if (s.userId === userId) sessions.delete(hash);
    },
    async deleteExpiredSessions(now) {
      for (const [hash, s] of sessions) if (s.expiresAt <= now) sessions.delete(hash);
    },
  };
}
