// Sign-in with Google over OpenID Connect, done by this server: the URL that
// sends the visitor to Google, the code exchange at Google's token endpoint,
// and the ID token check (RS256 against Google's keys, iss, aud, exp, nonce)
// with node:crypto. The URLs are options, so the tests use a local stub.
import { createHash, createPublicKey, verify } from "node:crypto";

export const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
};
const TIMEOUT_MS = 10_000;
// Google's keys are cached for as long as its Cache-Control says (an hour
// when it says nothing); a token signed with a key we don't know fetches them
// again, at most once a minute.
const KEYS_MS = 60 * 60_000;
const REFETCH_MS = 60_000;

export class GoogleError extends Error {}

export const challengeOf = (verifier) => createHash("sha256").update(verifier).digest("base64url");

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new GoogleError("bad_token");
  }
}

export function createGoogle({ clientId, clientSecret, redirectUri, authUrl = GOOGLE.authUrl, tokenUrl = GOOGLE.tokenUrl, jwksUrl = GOOGLE.jwksUrl, issuers = GOOGLE.issuers, now = Date.now }) {
  let keys = new Map(); // kid -> KeyObject
  let keysUntil = 0;
  let fetchedAt = -Infinity;
  let pending = null;

  async function fetchKeys() {
    const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
    if (!res?.ok) throw new GoogleError("keys_unavailable");
    const fresh = new Map();
    for (const jwk of (await res.json()).keys ?? []) {
      if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
      try {
        fresh.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
      } catch {}
    }
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1]);
    keys = fresh;
    fetchedAt = now();
    keysUntil = fetchedAt + (maxAge > 0 ? maxAge * 1000 : KEYS_MS);
  }

  async function keyFor(kid) {
    const t = now();
    if (t >= keysUntil || (!keys.has(kid) && t - fetchedAt >= REFETCH_MS)) {
      pending ??= fetchKeys().finally(() => (pending = null));
      await pending;
    }
    const key = keys.get(kid);
    if (!key) throw new GoogleError("unknown_key");
    return key;
  }

  return {
    // Where the visitor goes to sign in. state ties Google's answer to this
    // browser, nonce ties the ID token to it, challenge is PKCE's.
    authorizeUrl({ state, nonce, challenge }) {
      const url = new URL(authUrl);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return url.href;
    },

    // The ID token for an authorization code.
    async exchange(code, verifier) {
      let res;
      try {
        res = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new GoogleError("token_unavailable");
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.id_token !== "string") throw new GoogleError("token_refused");
      return body.id_token;
    },

    // { sub, email } from a signed ID token meant for us, or a GoogleError.
    async verify(idToken, nonce) {
      const parts = String(idToken).split(".");
      if (parts.length !== 3) throw new GoogleError("bad_token");
      const header = decodePart(parts[0]);
      if (header.alg !== "RS256" || typeof header.kid !== "string") throw new GoogleError("bad_token");
      const key = await keyFor(header.kid);
      const signed = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
      if (!signed) throw new GoogleError("bad_signature");
      const claims = decodePart(parts[1]);
      if (!issuers.includes(claims.iss)) throw new GoogleError("bad_issuer");
      if (claims.aud !== clientId) throw new GoogleError("bad_audience");
      if (!(Number(claims.exp) * 1000 > now())) throw new GoogleError("expired");
      if (typeof claims.nonce !== "string" || claims.nonce !== nonce) throw new GoogleError("bad_nonce");
      if (typeof claims.sub !== "string" || !/^[\w-]{1,255}$/.test(claims.sub)) throw new GoogleError("bad_token");
      const email = typeof claims.email === "string" && claims.email.length <= 320 ? claims.email : null;
      return { sub: claims.sub, email };
    },
  };
}
