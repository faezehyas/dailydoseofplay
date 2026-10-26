// The account routes under /api/ on the memory store, against a local fake
// Google (test/fake-google.js) with its own RSA key and JWKS.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { accountsConfig } from "../server/accounts.js";
import { createMemoryStore } from "../server/store/memory.js";
import { ISSUER, startFakeGoogle } from "./fake-google.js";
import { startServer } from "./helpers.js";

const OPEN = { authPerMinute: 1000, accountsPerHour: 1000 };

// A browser for fetch: keeps cookies for the site, sends JSON from the site's own origin.
function browser(base) {
  const jar = new Map();
  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const url = path.startsWith("http") ? path : base + path;
    const cookie = url.startsWith(base) && jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {};
    const json = body === undefined ? {} : { "content-type": "application/json", origin: base };
    const res = await fetch(url, { method, redirect: "manual", headers: { ...cookie, ...json, ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    if (url.startsWith(base)) {
      for (const set of res.headers.getSetCookie()) {
        const [pair] = set.split(";");
        const name = pair.slice(0, pair.indexOf("="));
        if (/Max-Age=0\b/.test(set)) jar.delete(name);
        else jar.set(name, pair.slice(pair.indexOf("=") + 1));
      }
    }
    return res;
  }
  return {
    jar,
    request,
    me: async () => (await request("/api/me")).json(),
    // Start, Google's page and the callback; returns the callback's response.
    async signIn(back = "/ludo/") {
      const start = await request(`/api/auth/google/start?return=${encodeURIComponent(back)}`);
      assert.equal(start.status, 302, "start redirects to Google");
      const google = await request(start.headers.get("location"));
      return request(google.headers.get("location"));
    },
  };
}

// b's requests come from `ip`, as the proxy would say.
function fromAddress(b, ip) {
  const { request } = b;
  b.request = (path, opts = {}) => request(path, { ...opts, headers: { "x-forwarded-for": ip, ...opts.headers } });
  return b;
}

async function setup(t, { limits = OPEN, ...options } = {}) {
  const google = await startFakeGoogle();
  const srv = await startServer({ accounts: google.settings, google: google.urls, limits, ...options });
  t.after(async () => {
    await srv.close();
    await google.close();
  });
  const open = () => browser(srv.base);
  // A browser signed in with a new Google account and a public name.
  open.signedUp = async (name) => {
    google.newUser();
    return signedUp(open, name);
  };
  return { google, srv, open };
}

async function signedUp(open, name) {
  const b = open();
  const callback = await b.signIn();
  assert.match(callback.headers.get("location"), /^\/account\/\?return=/, `${name}: a new account picks its name first`);
  const res = await b.request("/api/account", { method: "POST", body: { name } });
  assert.equal(res.status, 201, `${name}: created`);
  return b;
}

test("accounts off: /api/me says so, every other route is a 503, the site is unchanged", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const me = await fetch(`${srv.base}/api/me`);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { accounts: false });
  assert.equal((await fetch(`${srv.base}/api/auth/google/start`, { redirect: "manual" })).status, 503);
  assert.equal((await fetch(`${srv.base}/api/auth/signout`, { method: "POST" })).status, 503);
  assert.equal((await fetch(`${srv.base}/api/nothing`)).status, 404);
  assert.equal((await fetch(`${srv.base}/api/me`, { method: "POST" })).status, 405);
  const health = await fetch(`${srv.base}/healthz`);
  assert.equal((await health.json()).ok, true);
  assert.equal((await fetch(`${srv.base}/ludo/`)).status, 200);
});

test("accountsConfig: reads the switch, secrets, addresses and Wasmer's database variables", () => {
  const env = {
    ACCOUNTS: "off",
    SESSION_SECRET: "s",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    PUBLIC_ORIGIN: "https://www.dailydoseofplay.com",
    GOOGLE_REDIRECT_URI: "https://www.dailydoseofplay.com/api/auth/google/callback",
    DB_HOST: "db.example",
    DB_PORT: "6543",
    DB_NAME: "ddp",
    DB_USERNAME: "u",
    DB_PASSWORD: "p",
  };
  const config = accountsConfig(env);
  assert.equal(config.off, true);
  assert.equal(config.googleClientId, "id");
  assert.deepEqual(config.database, { host: "db.example", port: 6543, database: "ddp", user: "u", password: "p" });
  assert.equal(accountsConfig({}).database, null, "no DB_HOST: the memory store");
  assert.equal(accountsConfig({}).off, false);
});

test("kill switch: ACCOUNTS=off, a missing or short secret, or a database that can't start", async (t) => {
  const google = await startFakeGoogle();
  t.after(() => google.close());
  const broken = { ...createMemoryStore(), init: async () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNREFUSED" })) };
  const cases = [
    ["ACCOUNTS=off", { accounts: (o) => ({ ...google.settings(o), off: true }) }],
    ["no client secret", { accounts: (o) => ({ ...google.settings(o), googleClientSecret: "" }) }],
    ["short session secret", { accounts: (o) => ({ ...google.settings(o), sessionSecret: "too short" }) }],
    ["database down", { accounts: google.settings, accountStore: broken }],
  ];
  for (const [why, options] of cases) {
    const lines = [];
    const srv = await startServer({ ...options, google: google.urls, limits: OPEN, log: (line) => lines.push(line) });
    assert.deepEqual(await (await fetch(`${srv.base}/api/me`)).json(), { accounts: false }, why);
    assert.equal((await fetch(`${srv.base}/api/auth/google/start`, { redirect: "manual" })).status, 503, why);
    assert.ok(lines.some((l) => /^accounts: (off|database unavailable)/.test(l)), `${why}: logged`);
    assert.ok(lines.every((l) => !l.includes(google.clientSecret) && !l.includes("long enough")), `${why}: no secret in the log`);
    await srv.close();
  }
});

test("sign-up: Google, then a public name, then signed in; the session cookie is HttpOnly, Secure, Lax", async (t) => {
  const { srv, open, google } = await setup(t);
  const b = open();
  const start = await b.request("/api/auth/google/start?return=%2Fludo%2F%3Froom%3DABCD");
  const auth = new URL(start.headers.get("location"));
  assert.equal(auth.origin + auth.pathname, google.urls.authUrl);
  const q = auth.searchParams;
  assert.equal(q.get("client_id"), google.clientId);
  assert.equal(q.get("redirect_uri"), `${srv.base}/api/auth/google/callback`);
  assert.equal(q.get("scope"), "openid email");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.ok(q.get("state") && q.get("nonce") && q.get("code_challenge"));
  const oauthCookie = start.headers.getSetCookie().find((c) => c.startsWith("__Host-ddp_oauth="));
  assert.match(oauthCookie, /; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);

  const callback = await b.request((await b.request(auth.href)).headers.get("location"));
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/account/?return=%2Fludo%2F%3Froom%3DABCD");
  assert.ok(!b.jar.has("__Host-ddp_oauth"), "the oauth cookie is cleared");
  assert.ok(!b.jar.has("__Host-ddp_sid"), "no session before the account has a name");
  assert.deepEqual(await b.me(), { accounts: true, user: null, signup: { email: "player@example.com" } });

  const created = await b.request("/api/account", { method: "POST", body: { name: "  Brave   Otter " } });
  assert.equal(created.status, 201);
  const { user } = await created.json();
  assert.equal(user.name, "Brave Otter");
  assert.equal(user.email, "player@example.com");
  assert.match(user.id, /^[\w-]{16}$/);
  const sid = created.headers.getSetCookie().find((c) => c.startsWith("__Host-ddp_sid="));
  assert.match(sid, /^__Host-ddp_sid=[\w-]{43}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
  assert.ok(!b.jar.has("__Host-ddp_signup"), "the sign-up cookie is cleared");
  assert.deepEqual(await b.me(), { accounts: true, user, signup: null });

  const security = await b.request("/api/me");
  assert.match(security.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(security.headers.get("cache-control"), "no-store");
  assert.match(security.headers.get("content-type"), /^application\/json/);
});

test("sign-in again: an existing account goes straight back, with a new session each time", async (t) => {
  const { open } = await setup(t);
  const first = await signedUp(open, "Clever Fox");
  const firstToken = first.jar.get("__Host-ddp_sid");
  const callback = await first.signIn("/chess/");
  assert.equal(callback.headers.get("location"), "/chess/");
  const secondToken = first.jar.get("__Host-ddp_sid");
  assert.notEqual(secondToken, firstToken, "the session rotates at sign-in");
  const stale = open();
  stale.jar.set("__Host-ddp_sid", firstToken);
  assert.equal((await stale.me()).user, null, "the old session ended");
  assert.equal((await first.me()).user.name, "Clever Fox");

  const phone = open();
  assert.equal((await phone.signIn("/")).headers.get("location"), "/");
  assert.equal((await phone.me()).user.name, "Clever Fox", "a second device signs in to the same account");
});

test("public names: 3 to 20 characters, the nickname rules, unique without case; rename", async (t) => {
  const { open, google } = await setup(t);
  const taken = await open.signedUp("Lucky Lynx");
  google.newUser();
  const b = open();
  await b.signIn();
  const post = (name) => b.request("/api/account", { method: "POST", body: { name } });
  for (const [name, problem] of [["ab", "short"], ["x".repeat(21), "long"], ["www.spam.com", "link"], ["fuuuck", "word"], ["<b>", "chars"], [42, "short"]]) {
    const res = await post(name);
    assert.equal(res.status, 400, String(name));
    assert.deepEqual(await res.json(), { error: "bad_name", problem }, String(name));
  }
  const clash = await post("LUCKY lynx");
  assert.equal(clash.status, 409);
  assert.deepEqual(await clash.json(), { error: "name_taken" });
  assert.equal((await post("Quiet Owl")).status, 201);

  const rename = (who, name) => who.request("/api/account", { method: "PATCH", body: { name } });
  assert.equal((await rename(b, "lucky LYNX")).status, 409, "rename to a taken name");
  const renamed = await rename(b, "Quiet Heron");
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).user.name, "Quiet Heron");
  assert.equal((await rename(taken, "lucky lynx")).status, 200, "a new case of your own name is fine");
  assert.equal((await taken.me()).user.name, "lucky lynx");
  assert.equal((await post("Another")).status, 401, "the sign-up was used");
  assert.equal((await rename(open(), "Nobody")).status, 401, "rename needs a session");
});

test("CSRF: non-GET requests need our Origin (or Sec-Fetch-Site: same-origin) and JSON", async (t) => {
  const { srv, open } = await setup(t);
  const b = await signedUp(open, "Swift Seal");
  const send = (headers, body = '{"name":"Swift Robin"}') => b.request("/api/account", { method: "PATCH", body, headers });
  assert.equal((await send({ origin: "https://evil.example" })).status, 403, "another site");
  assert.equal((await send({ origin: "null" })).status, 403, "an opaque origin");
  assert.equal((await send({ origin: "", "sec-fetch-site": "cross-site" })).status, 403, "no origin, cross-site");
  assert.equal((await send({ "content-type": "text/plain" })).status, 403, "a simple form post");
  assert.equal((await send({ "content-type": "application/x-www-form-urlencoded" })).status, 403);
  assert.equal((await send({}, "{nope")).status, 400, "not JSON");
  assert.equal((await send({}, "[1]")).status, 400, "not an object");
  assert.equal((await send({}, JSON.stringify({ name: "x".repeat(5000) }))).status, 413, "too big");
  assert.equal((await b.me()).user.name, "Swift Seal", "nothing changed");
  assert.equal((await send({ origin: "", "sec-fetch-site": "same-origin" })).status, 200, "same-origin fetch without Origin");
  assert.equal((await send({ origin: srv.base }, '{"name":"Swift Puffin"}')).status, 200);
  assert.equal((await b.me()).user.name, "Swift Puffin");
});

test("callback: a wrong, missing, reused or expired state, and a cancelled sign-in, sign nobody in", async (t) => {
  let now = Date.now();
  const { open } = await setup(t, { now: () => now });
  const fresh = async () => {
    const b = open();
    const start = await b.request("/api/auth/google/start");
    const back = new URL((await b.request(start.headers.get("location"))).headers.get("location"));
    return { b, back };
  };
  const errorOf = (res) => res.headers.get("location");

  let { b, back } = await fresh();
  const wrong = new URL(back);
  wrong.searchParams.set("state", "x".repeat(22));
  assert.equal(errorOf(await b.request(wrong.href)), "/account/?error=state", "wrong state");

  ({ b, back } = await fresh());
  b.jar.delete("__Host-ddp_oauth");
  assert.equal(errorOf(await b.request(back.href)), "/account/?error=state", "no oauth cookie");

  ({ b, back } = await fresh());
  const oauth = b.jar.get("__Host-ddp_oauth");
  b.jar.set("__Host-ddp_oauth", oauth.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
  assert.equal(errorOf(await b.request(back.href)), "/account/?error=state", "a forged cookie");

  ({ b, back } = await fresh());
  const cookie = b.jar.get("__Host-ddp_oauth");
  assert.match(errorOf(await b.request(back.href)), /^\/account\/\?return=/, "the first use works");
  b.jar.set("__Host-ddp_oauth", cookie);
  assert.equal(errorOf(await b.request(back.href)), "/account/?error=state", "reused state");

  ({ b, back } = await fresh());
  now += 10 * 60_000 + 1;
  assert.equal(errorOf(await b.request(back.href)), "/account/?error=state", "after 10 minutes");

  ({ b, back } = await fresh());
  const denied = new URL(back);
  denied.searchParams.delete("code");
  denied.searchParams.set("error", "access_denied");
  assert.equal(errorOf(await b.request(denied.href)), "/account/?error=cancelled");
  assert.ok(!b.jar.has("__Host-ddp_signup") && !b.jar.has("__Host-ddp_sid"));
});

test("ID token: a bad signature, wrong iss, aud or nonce, or an expired token is refused", async (t) => {
  const { google, open } = await setup(t);
  const cases = {
    "bad signature": () => ({ signer: google.otherKey }),
    "wrong iss": (claims) => ({ claims: { ...claims, iss: "https://evil.example" } }),
    "wrong aud": (claims) => ({ claims: { ...claims, aud: "someone-else" } }),
    "wrong nonce": (claims) => ({ claims: { ...claims, nonce: "another" } }),
    expired: (claims) => ({ claims: { ...claims, exp: Math.floor(Date.now() / 1000) - 60 } }),
    "no kid": () => ({ signer: { ...google.key, kid: undefined } }),
  };
  for (const [why, tamper] of Object.entries(cases)) {
    google.tamper = tamper;
    const b = open();
    const callback = await b.signIn();
    assert.equal(callback.headers.get("location"), "/account/?error=google", why);
    assert.equal((await b.me()).signup, null, `${why}: no sign-up`);
  }
  google.tamper = null;
  assert.match((await open().signIn()).headers.get("location"), /^\/account\/\?return=/, "an untampered token works");
});

test("Google's keys: cached, and fetched again for an unknown kid at most once a minute", async (t) => {
  let now = Date.now();
  const { google, open } = await setup(t, { now: () => now });
  const signIn = async () => (await open().signIn()).headers.get("location");
  assert.match(await signIn(), /^\/account\/\?return=/);
  assert.match(await signIn(), /^\/account\/\?return=/);
  assert.equal(google.jwksRequests, 1, "cached");
  google.tamper = () => ({ signer: { ...google.otherKey, kid: "rotated" } });
  assert.equal(await signIn(), "/account/?error=google", "unknown kid");
  assert.equal(google.jwksRequests, 1, "not again within a minute of the last fetch");
  now += 61_000;
  assert.equal(await signIn(), "/account/?error=google", "still unknown");
  assert.equal(google.jwksRequests, 2, "an unknown kid fetches the keys again");
  now += 2 * 60 * 60_000;
  google.tamper = (claims) => ({ claims: { ...claims, exp: claims.exp + 3 * 60 * 60 } }); // on the server's clock
  assert.match(await signIn(), /^\/account\/\?return=/);
  assert.equal(google.jwksRequests, 3, "fetched again once max-age has passed");
});

test("ID token: the issuer may also be written without https://", async (t) => {
  const { google, open } = await setup(t);
  google.tamper = (claims) => ({ claims: { ...claims, iss: ISSUER.replace("https://", "") } });
  assert.match((await open().signIn()).headers.get("location"), /^\/account\/\?return=/);
});

test("return path: only a path on this site", async (t) => {
  const { open } = await setup(t);
  const b = await signedUp(open, "Kind Koala");
  for (const back of ["//evil.example/", "https://evil.example/", "/\\evil.example", "javascript:alert(1)", "/a b"]) {
    assert.equal((await b.signIn(back)).headers.get("location"), "/", back);
  }
  assert.equal((await b.signIn("/hearts/?room=ABCD&key=k")).headers.get("location"), "/hearts/?room=ABCD&key=k");
});

test("rate limits: 10 auth requests a minute per address, 5 new accounts an hour", async (t) => {
  let now = Date.now();
  const { open, srv, google } = await setup(t, { limits: {}, now: () => now });
  const start = (ip) => fetch(`${srv.base}/api/auth/google/start`, { redirect: "manual", headers: { "x-forwarded-for": ip } });
  for (let i = 0; i < 10; i++) assert.equal((await start("203.0.113.1")).status, 302);
  const limited = await start("203.0.113.1");
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "rate_limited" });
  assert.equal((await start("::ffff:203.0.113.1")).status, 429, "the IPv4-mapped form is the same address");
  assert.equal((await start("203.0.113.2")).status, 302, "another address");
  assert.equal((await fetch(`${srv.base}/api/me`, { headers: { "x-forwarded-for": "203.0.113.1" } })).status, 200, "/api/me isn't limited");
  now += 60_000;
  assert.equal((await start("203.0.113.1")).status, 302, "a minute later");

  // Each sign-up takes 3 auth requests (start, callback, create), so 10 a minute allow 3.
  for (let i = 0; i < 5; i++) {
    if (i % 3 === 0) now += 60_000;
    const b = fromAddress(open(), "198.51.100.7");
    google.newUser();
    await b.signIn();
    assert.equal((await b.request("/api/account", { method: "POST", body: { name: `Player ${i}` } })).status, 201, `account ${i + 1}`);
  }
  now += 60_000;
  const sixth = fromAddress(open(), "198.51.100.7");
  google.newUser();
  await sixth.signIn();
  assert.equal((await sixth.request("/api/account", { method: "POST", body: { name: "Player 6" } })).status, 429, "the sixth account in an hour");
});

test("rate limits: CLIENT_IP_ENTRY=last takes the address the proxy appended", async (t) => {
  const { srv } = await setup(t, { limits: {}, clientIpEntry: "last" });
  const start = (xff) => fetch(`${srv.base}/api/auth/google/start`, { redirect: "manual", headers: { "x-forwarded-for": xff } });
  for (let i = 0; i < 10; i++) assert.equal((await start(`192.0.2.${i}, 203.0.113.9`)).status, 302);
  assert.equal((await start("192.0.2.200, 203.0.113.9")).status, 429, "a forged first entry doesn't help");
});

test("sign out, and sign out everywhere", async (t) => {
  const { open } = await setup(t);
  const laptop = await signedUp(open, "Calm Panda");
  const phone = open();
  await phone.signIn();
  const tablet = open();
  await tablet.signIn();
  assert.equal((await phone.me()).user.name, "Calm Panda");

  const out = await phone.request("/api/auth/signout", { method: "POST", body: {} });
  assert.equal(out.status, 200);
  assert.match(out.headers.getSetCookie().join("\n"), /__Host-ddp_sid=; Path=\/; Max-Age=0/);
  assert.equal((await phone.me()).user, null);
  assert.equal((await laptop.me()).user.name, "Calm Panda", "other devices stay signed in");

  assert.equal((await laptop.request("/api/auth/signout-all", { method: "POST", body: {} })).status, 200);
  assert.equal((await laptop.me()).user, null);
  assert.equal((await tablet.me()).user, null, "every session ended");
  assert.equal((await tablet.request("/api/auth/signout-all", { method: "POST", body: {} })).status, 401);
  assert.equal((await tablet.request("/api/auth/signout", { method: "POST", body: {} })).status, 200, "signing out twice is fine");
});

test("delete: type the name to confirm; the account, its sessions and email are gone, the name is free", async (t) => {
  const { open, google } = await setup(t);
  const b = await signedUp(open, "Merry Robin");
  const other = open();
  await other.signIn();
  const del = (who, name) => who.request("/api/account", { method: "DELETE", body: { name } });
  assert.equal((await del(b, "Merry Robn")).status, 400);
  assert.equal((await del(b, undefined)).status, 400);
  assert.equal((await del(b, " merry  ROBIN ")).status, 200);
  assert.equal((await b.me()).user, null);
  assert.equal((await other.me()).user, null, "the other device's session went with it");
  assert.equal((await del(b, "Merry Robin")).status, 401);

  const again = open();
  assert.match((await again.signIn()).headers.get("location"), /^\/account\/\?return=/, "the same Google account starts over");
  assert.equal((await again.request("/api/account", { method: "POST", body: { name: "Merry Robin" } })).status, 201, "the name was freed");
  google.user = { sub: "100000000000000000002", email: "second@example.com" };
  const second = open();
  await second.signIn();
  assert.equal((await second.me()).signup.email, "second@example.com");
});

test("sessions last 30 days and are renewed once a day", async (t) => {
  let now = Date.now();
  const { open } = await setup(t, { now: () => now });
  const b = await signedUp(open, "Plucky Gecko");
  const renewed = async () => (await b.request("/api/me")).headers.getSetCookie().some((c) => c.startsWith("__Host-ddp_sid="));
  now += 60 * 60_000;
  assert.equal(await renewed(), false, "not within the first day");
  now += 24 * 60 * 60_000;
  assert.equal(await renewed(), true, "after a day");
  assert.equal(await renewed(), false, "once");
  now += 30 * 24 * 60 * 60_000 - 60_000;
  assert.equal((await b.me()).user.name, "Plucky Gecko", "30 days from the renewal, not from sign-in");
  now += 30 * 24 * 60 * 60_000 + 60_000;
  assert.equal((await b.me()).user, null, "expired after 30 days away");
});

test("/api/me: only on PUBLIC_ORIGIN, since Google sends visitors back there", async (t) => {
  const { srv } = await setup(t);
  assert.equal((await (await fetch(`${srv.base}/api/me`)).json()).accounts, true);
  // fetch always sends the real Host, so these go through node:http.
  const me = (headers) =>
    new Promise((resolve, reject) => {
      http.get(`${srv.base}/api/me`, { headers }, async (res) => {
        let body = "";
        for await (const chunk of res) body += chunk;
        resolve(JSON.parse(body));
      }).on("error", reject);
    });
  assert.deepEqual(await me({ host: "dailydoseofplay.wasmer.app" }), { accounts: false });
  assert.equal((await me({ host: "10.0.0.2:8080", "x-forwarded-host": new URL(srv.base).host })).accounts, true, "behind a proxy that rewrites Host");
});
