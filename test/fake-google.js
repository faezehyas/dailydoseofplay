// A stand-in for Google's sign-in, for the accounts tests: an authorization
// endpoint that signs in at once as `fake.user`, a token endpoint that checks
// the PKCE verifier and returns an ID token, and a JWKS with its own RSA key.
// fake.tamper(claims, header) may change the next tokens (a wrong aud, an old
// exp, another key) to test the checks in server/google.js.
import http from "node:http";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";

export const ISSUER = "https://accounts.google.com";

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function signToken(claims, { privateKey, kid }) {
  const head = `${b64({ alg: "RS256", kid, typ: "JWT" })}.${b64(claims)}`;
  return `${head}.${createSign("RSA-SHA256").update(head).sign(privateKey, "base64url")}`;
}

export async function startFakeGoogle({ clientId = "test-client" } = {}) {
  const key = { ...generateKeyPairSync("rsa", { modulusLength: 2048 }), kid: "test-key" };
  const codes = new Map(); // code -> { nonce, challenge, redirectUri, user }
  const fake = {
    clientId,
    clientSecret: "test-secret",
    key,
    user: { sub: "100000000000000000001", email: "player@example.com" },
    // Signs in as a Google account no one has used yet.
    newUser(email = `player${nextSub}@example.com`) {
      fake.user = { sub: String(200000000000000000000n + BigInt(nextSub++)), email };
      return fake.user;
    },
    tamper: null,
    jwksRequests: 0,
    // A key the JWKS doesn't publish, for a token with a bad signature.
    otherKey: { ...generateKeyPairSync("rsa", { modulusLength: 2048 }), kid: "test-key" },
  };
  let nextCode = 1;
  let nextSub = 1;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/jwks") {
      fake.jwksRequests++;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" });
      return res.end(JSON.stringify({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: key.kid, alg: "RS256", use: "sig" }] }));
    }
    if (url.pathname === "/auth") {
      const q = url.searchParams;
      const code = `code-${nextCode++}`;
      codes.set(code, { nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), clientId: q.get("client_id"), user: fake.user });
      const back = new URL(q.get("redirect_uri"));
      back.search = new URLSearchParams({ code, state: q.get("state") });
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const grant = codes.get(form.get("code"));
      codes.delete(form.get("code"));
      const verified =
        grant &&
        form.get("client_secret") === fake.clientSecret &&
        form.get("client_id") === grant.clientId &&
        form.get("redirect_uri") === grant.redirectUri &&
        createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") === grant.challenge;
      if (!verified) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "invalid_grant" }));
      }
      const now = Math.floor(Date.now() / 1000);
      let claims = { iss: ISSUER, aud: grant.clientId, sub: grant.user.sub, email: grant.user.email, email_verified: true, nonce: grant.nonce, iat: now, exp: now + 3600 };
      let signer = key;
      if (fake.tamper) ({ claims = claims, signer = signer } = fake.tamper(claims) ?? {});
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id_token: signToken(claims, signer), token_type: "Bearer" }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return Object.assign(fake, {
    base,
    urls: { authUrl: `${base}/auth`, tokenUrl: `${base}/token`, jwksUrl: `${base}/jwks` },
    // Account settings for startServer({ accounts }): everything set, on the memory store.
    settings: (origin) => ({
      sessionSecret: "a test secret that is long enough for HMAC-SHA256",
      googleClientId: clientId,
      googleClientSecret: fake.clientSecret,
      publicOrigin: origin,
      redirectUri: `${origin}/api/auth/google/callback`,
      database: null,
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  });
}
