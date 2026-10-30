// Optional accounts under /api/ (see Accounts in ARCHITECTURE.md): sign-in
// with Google, sessions, and each account's unique public name. JSON in and
// out. Playing never needs any of it.
//
// Kill switch: with ACCOUNTS=off, a missing secret or a database that can't
// be reached, every route answers 503, except GET /api/me, which says
// { accounts: false } so pages hide the account UI without a failed request
// in the console. Games, /ws and /healthz don't depend on any of this.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { clientIp, createRateLimit } from "./limits.js";
import { GoogleError, challengeOf, createGoogle } from "./google.js";
import { StoreError, createMemoryStore } from "./store/memory.js";
import { checkPublicName, nameKey } from "../public/engine/names.js";

const SESSION_COOKIE = "__Host-ddp_sid";
const OAUTH_COOKIE = "__Host-ddp_oauth"; // state, nonce, PKCE verifier and return path, for 10 minutes
const SIGNUP_COOKIE = "__Host-ddp_signup"; // a new Google account, until it picks a public name
const DAY_MS = 24 * 60 * 60_000;
const SESSION_MS = 30 * DAY_MS;
const OAUTH_MS = 10 * 60_000;
const SIGNUP_MS = 30 * 60_000;
const RETRY_MS = 30_000; // how soon a database that failed to start is tried again
const BODY_MAX = 4096;
export const ACCOUNT_LIMITS = { authPerMinute: 10, accountsPerHour: 5 };

// The settings accounts need, by the environment variable each comes from.
const SETTINGS = {
  sessionSecret: "SESSION_SECRET",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  publicOrigin: "PUBLIC_ORIGIN",
  redirectUri: "GOOGLE_REDIRECT_URI",
};

// The settings, from the environment unless given.
export function accountsConfig(env = process.env) {
  return {
    off: env.ACCOUNTS === "off",
    ...Object.fromEntries(Object.entries(SETTINGS).map(([key, name]) => [key, env[name]])),
    database: env.DB_HOST
      ? { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.DB_NAME, user: env.DB_USERNAME, password: env.DB_PASSWORD }
      : null,
  };
}

// Why accounts can't run with these settings (names only, never values), or null.
function offReason(config) {
  if (config.off) return "ACCOUNTS=off";
  const missing = Object.entries(SETTINGS).filter(([key]) => !config[key]).map(([, name]) => name);
  if (missing.length) return `missing ${missing.join(", ")}`;
  if (config.sessionSecret.length < 32) return "SESSION_SECRET is shorter than 32 characters";
  return null;
}

const random = (bytes) => randomBytes(bytes).toString("base64url");
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email });

// A path on this site to come back to after signing in, else "/".
function safeReturn(value) {
  return typeof value === "string" && value.length <= 300 && /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : "/";
}

function cookieJar(req) {
  const jar = new Map();
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return jar;
}
// __Host- cookies must be Secure with Path=/ and no Domain. Lax, because Google's callback is a top-level navigation.
const setCookie = (name, value, ms) => `${name}=${value}; Path=/; Max-Age=${Math.floor(ms / 1000)}; HttpOnly; Secure; SameSite=Lax`;

// The request body as an object, null when it isn't JSON, or "too_big".
function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= BODY_MAX) chunks.push(chunk);
      else resolve("too_big"); // the rest is read and dropped, so the answer still arrives
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(body && typeof body === "object" && !Array.isArray(body) ? body : null);
      } catch {
        resolve(null);
      }
    });
    req.on("close", () => resolve(null)); // aborted; after "end" this changes nothing
  });
}

export function createAccounts({ config = accountsConfig(), store, google: googleUrls = {}, headers = {}, log = () => {}, now = Date.now, clientIpHeader, clientIpEntry, limits = {} } = {}) {
  const reason = offReason(config);
  const { authPerMinute, accountsPerHour } = { ...ACCOUNT_LIMITS, ...limits };
  const authLimit = createRateLimit({ max: authPerMinute, windowMs: 60_000, now });
  const createLimit = createRateLimit({ max: accountsPerHour, windowMs: 60 * 60_000, now });
  const usedStates = new Map(); // state -> when its cookie expires: each Google answer is taken once
  const publicHost = reason ? null : new URL(config.publicOrigin).host;
  const google = reason
    ? null
    : createGoogle({ ...googleUrls, clientId: config.googleClientId, clientSecret: config.googleClientSecret, redirectUri: config.redirectUri, now });

  // The store starts in the background, so the site never waits for the database.
  let ready = false;
  let starting = null;
  let failedAt = -Infinity;
  let sessionsSweptAt = 0;
  function available() {
    if (reason || ready) return Promise.resolve(ready);
    if (now() - failedAt < RETRY_MS) return Promise.resolve(false);
    starting ??= (async () => {
      store ??= config.database ? await (await import("./store/postgres.js")).createPostgresStore(config.database) : createMemoryStore();
      await store.init();
      ready = true;
      log(`accounts: on (${config.database ? "PostgreSQL" : "memory store"})`);
    })()
      .catch((err) => {
        failedAt = now();
        log(`accounts: database unavailable (${err.code || err.name})`);
      })
      .then(() => {
        starting = null;
        return ready;
      });
    return starting;
  }
  if (reason) log(`accounts: off (${reason})`);
  else available();

  const mac = (data) => createHmac("sha256", config.sessionSecret).update(data).digest("base64url");
  const tokenHash = (token) => createHmac("sha256", config.sessionSecret).update(token).digest("hex");
  // A cookie value only this server could have written: the payload, signed under the cookie's name.
  function signed(name, payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${mac(`${name}.${body}`)}`;
  }
  function unsigned(name, value) {
    const [body, sig, extra] = String(value || "").split(".");
    if (!body || extra !== undefined || !same(sig, mac(`${name}.${body}`))) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      return payload.exp > now() ? payload : null;
    } catch {
      return null;
    }
  }

  // The signed-in session and user, renewed for another 30 days once a day.
  async function currentSession(ctx) {
    const token = ctx.jar.get(SESSION_COOKIE);
    if (!/^[\w-]{43}$/.test(token || "")) return null;
    const session = await store.session(tokenHash(token), now());
    if (!session) return null;
    if (session.expiresAt - SESSION_MS + DAY_MS <= now()) {
      await store.renewSession(tokenHash(token), now() + SESSION_MS);
      ctx.cookies.push(setCookie(SESSION_COOKIE, token, SESSION_MS));
    }
    return session;
  }

  // A new session for userId; the one this browser had, if any, ends (rotation at sign-in).
  async function startSession(ctx, userId) {
    const old = ctx.jar.get(SESSION_COOKIE);
    if (old) await store.deleteSession(tokenHash(old));
    const token = random(32);
    await store.createSession({ tokenHash: tokenHash(token), userId, createdAt: now(), expiresAt: now() + SESSION_MS });
    ctx.cookies.push(setCookie(SESSION_COOKIE, token, SESSION_MS), setCookie(SIGNUP_COOKIE, "", 0));
  }

  const json = (status, body) => ({ status, body });
  const redirect = (location) => ({ status: 302, location });
  const signedOut = json(401, { error: "signed_out" });

  async function me(ctx) {
    // Google sends visitors back to PUBLIC_ORIGIN only, so other addresses of the site have no sign-in.
    const hosts = [ctx.req.headers.host, String(ctx.req.headers["x-forwarded-host"] || "").split(",")[0].trim()];
    if (!hosts.includes(publicHost)) return json(200, { accounts: false });
    const session = await currentSession(ctx);
    const signup = !session && unsigned(SIGNUP_COOKIE, ctx.jar.get(SIGNUP_COOKIE));
    return json(200, { accounts: true, user: session ? publicUser(session.user) : null, signup: signup ? { email: signup.email } : null });
  }

  function start(ctx) {
    const state = random(16);
    const nonce = random(16);
    const verifier = random(32);
    const back = safeReturn(ctx.url.searchParams.get("return"));
    ctx.cookies.push(setCookie(OAUTH_COOKIE, signed(OAUTH_COOKIE, { state, nonce, verifier, back, exp: now() + OAUTH_MS }), OAUTH_MS));
    return redirect(google.authorizeUrl({ state, nonce, challenge: challengeOf(verifier) }));
  }

  // Google's answer comes back here as a top-level navigation, so problems go
  // to the account page (?error=…) rather than as JSON.
  async function callback(ctx) {
    const oauth = unsigned(OAUTH_COOKIE, ctx.jar.get(OAUTH_COOKIE));
    ctx.cookies.push(setCookie(OAUTH_COOKIE, "", 0));
    const query = ctx.url.searchParams;
    const fail = (error) => redirect(`/account/?error=${error}`);
    if (!oauth || !same(query.get("state"), oauth.state) || usedStates.has(oauth.state)) return fail("state");
    usedStates.set(oauth.state, oauth.exp);
    if (query.has("error")) return fail("cancelled");
    const code = query.get("code");
    if (!code || code.length > 2048) return fail("google");
    let identity;
    try {
      identity = await google.verify(await google.exchange(code, oauth.verifier), oauth.nonce);
    } catch (err) {
      if (err instanceof GoogleError) return fail("google");
      throw err;
    }
    const user = await store.userByGoogle(identity.sub);
    if (user) {
      await startSession(ctx, user.id);
      return redirect(oauth.back);
    }
    // A new account: it is created once it has a public name (POST /api/account).
    ctx.cookies.push(setCookie(SIGNUP_COOKIE, signed(SIGNUP_COOKIE, { sub: identity.sub, email: identity.email, exp: now() + SIGNUP_MS }), SIGNUP_MS));
    return redirect(`/account/?return=${encodeURIComponent(oauth.back)}`);
  }

  async function createAccount(ctx) {
    const signup = unsigned(SIGNUP_COOKIE, ctx.jar.get(SIGNUP_COOKIE));
    if (!signup) return signedOut;
    const { name, problem } = checkPublicName(ctx.body.name);
    if (problem) return json(400, { error: "bad_name", problem });
    if (!createLimit.take(ctx.ip)) return json(429, { error: "rate_limited" });
    const user = await store.createUser({ id: random(12), name, googleSub: signup.sub, email: signup.email, createdAt: now() });
    await startSession(ctx, user.id);
    return json(201, { user: publicUser(user) });
  }

  async function rename(ctx) {
    const session = await currentSession(ctx);
    if (!session) return signedOut;
    const { name, problem } = checkPublicName(ctx.body.name);
    if (problem) return json(400, { error: "bad_name", problem });
    const user = await store.renameUser(session.userId, name);
    return user ? json(200, { user: publicUser(user) }) : signedOut;
  }

  // Deleting needs the account's name typed again.
  async function remove(ctx) {
    const session = await currentSession(ctx);
    if (!session) return signedOut;
    const typed = typeof ctx.body.name === "string" ? checkPublicName(ctx.body.name).name : "";
    if (!typed || nameKey(typed) !== nameKey(session.user.name)) return json(400, { error: "confirm" });
    await store.deleteUser(session.userId);
    ctx.cookies.push(setCookie(SESSION_COOKIE, "", 0));
    return json(200, { ok: true });
  }

  async function signOut(ctx) {
    const token = ctx.jar.get(SESSION_COOKIE);
    if (token) await store.deleteSession(tokenHash(token));
    ctx.cookies.push(setCookie(SESSION_COOKIE, "", 0), setCookie(SIGNUP_COOKIE, "", 0));
    return json(200, { ok: true });
  }

  async function signOutEverywhere(ctx) {
    const session = await currentSession(ctx);
    if (!session) return signedOut;
    await store.deleteUserSessions(session.userId);
    ctx.cookies.push(setCookie(SESSION_COOKIE, "", 0));
    return json(200, { ok: true });
  }

  // path -> method -> handler
  const ROUTES = {
    "/api/me": { GET: me },
    "/api/auth/google/start": { GET: start },
    "/api/auth/google/callback": { GET: callback },
    "/api/auth/signout": { POST: signOut },
    "/api/auth/signout-all": { POST: signOutEverywhere },
    "/api/account": { POST: createAccount, PATCH: rename, DELETE: remove },
  };

  // Every non-GET request comes from a page of this site (a form on another
  // site can't send these headers) and carries JSON.
  function csrfOk(req) {
    const fromSite = req.headers.origin === config.publicOrigin || req.headers["sec-fetch-site"] === "same-origin";
    return fromSite && /^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] || ""));
  }

  async function route(req, pathname) {
    const methods = ROUTES[pathname];
    if (!methods) return json(404, { error: "not_found" });
    const handler = methods[req.method];
    if (!handler) return { ...json(405, { error: "method_not_allowed" }), allow: Object.keys(methods).join(", ") };
    const ctx = { req, url: new URL(req.url, "http://localhost"), jar: cookieJar(req), cookies: [], body: {} };
    const off = handler === me ? json(200, { accounts: false }) : json(503, { error: "unavailable" });
    if (handler !== me) {
      // The limit comes first, so it holds (and can be checked) while accounts are off.
      ctx.ip = clientIp(req, clientIpHeader || undefined, clientIpEntry);
      if (!authLimit.take(ctx.ip)) return json(429, { error: "rate_limited" });
    }
    if (!(await available())) return off;
    if (req.method !== "GET") {
      if (!csrfOk(req)) return json(403, { error: "forbidden" });
      const body = await readJson(req);
      if (body === "too_big") return json(413, { error: "too_big" });
      if (!body) return json(400, { error: "bad_json" });
      ctx.body = body;
    }
    try {
      return { ...(await handler(ctx)), cookies: ctx.cookies };
    } catch (err) {
      if (err instanceof StoreError) return json(409, { error: err.code });
      log(`accounts: database error (${err.code || err.name})`);
      return off;
    }
  }

  return {
    async handle(req, res, pathname) {
      const { status, body, location, allow, cookies = [] } = await route(req, pathname);
      res.writeHead(status, {
        ...headers,
        "Cache-Control": "no-store",
        ...(cookies.length ? { "Set-Cookie": cookies } : {}),
        ...(allow ? { Allow: allow } : {}),
        ...(location ? { Location: location } : { "Content-Type": "application/json; charset=utf-8" }),
      });
      res.end(location ? undefined : JSON.stringify(body));
    },
    // Forgets old rate-limit entries and used states; expired sessions go once an hour.
    sweep() {
      authLimit.sweep();
      createLimit.sweep();
      const t = now();
      for (const [state, exp] of usedStates) if (exp <= t) usedStates.delete(state);
      if (ready && t - sessionsSweptAt >= 60 * 60_000) {
        sessionsSweptAt = t;
        store.deleteExpiredSessions(t).catch(() => {});
      }
    },
    close: () => store?.close().catch(() => {}),
  };
}
