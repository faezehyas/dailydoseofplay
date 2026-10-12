// Sealing a hidden card's shares to one player, so a card can change hands in
// secret (see ARCHITECTURE.md "Card games"). WebCrypto only: ECDH on P-256
// between the giver's and the receiver's keys, HKDF-SHA256 bound to where the
// envelope belongs, and AES-GCM. Either side's key opens it, so the audit can.

export const SEAL_PUBLIC_BYTES = 65; // an uncompressed P-256 point
export const SEAL_SECRET_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const sealedBytes = (plainBytes) => IV_BYTES + plainBytes + TAG_BYTES;

const ECDH = { name: "ECDH", namedCurve: "P-256" };
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

// A key or envelope that doesn't check out.
export class SealError extends Error {
  name = "SealError";
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// A fresh key pair: { privateKey, publicKey, public: its 65 bytes }.
export async function sealKeys() {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  return { ...pair, public: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)) };
}

// The 32 secret bytes, revealed for the audit.
export async function sealSecret(pair) {
  return fromB64url((await subtle().exportKey("jwk", pair.privateKey)).d);
}

// Another player's public key; refuses a point that isn't on the curve.
export async function sealPublic(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== SEAL_PUBLIC_BYTES) throw new SealError("bad key");
  try {
    return await subtle().importKey("raw", bytes, ECDH, true, []);
  } catch {
    throw new SealError("bad key");
  }
}

async function envelopeKey(privateKey, publicKey, context) {
  const shared = await subtle().deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const ikm = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const params = { name: "HKDF", hash: "SHA-256", salt: enc.encode("ddp-seal/1"), info: enc.encode(context) };
  return subtle().deriveKey(params, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// Seals `plain` from one side to the other; context names the envelope's place.
export async function seal(privateKey, publicKey, context, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const body = await subtle().encrypt({ name: "AES-GCM", iv }, await envelopeKey(privateKey, publicKey, context), plain);
  const out = new Uint8Array(IV_BYTES + body.byteLength);
  out.set(iv);
  out.set(new Uint8Array(body), IV_BYTES);
  return out;
}

// Opens an envelope with either side's private key and the other's public key.
export async function unseal(privateKey, publicKey, context, envelope) {
  if (!(envelope instanceof Uint8Array) || envelope.length < IV_BYTES + TAG_BYTES) throw new SealError("bad envelope");
  try {
    const key = await envelopeKey(privateKey, publicKey, context);
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: envelope.slice(0, IV_BYTES) }, key, envelope.slice(IV_BYTES)));
  } catch {
    throw new SealError("bad envelope");
  }
}

// A private key revealed in the audit, or null unless it belongs to `publicKey`
// (theirs, a CryptoKey): it must agree with mine as the published key does.
export async function revealedKey(secret, publicKey, mine) {
  if (!(secret instanceof Uint8Array) || secret.length !== SEAL_SECRET_BYTES) return null;
  try {
    const { x, y } = await subtle().exportKey("jwk", publicKey);
    const key = await subtle().importKey("jwk", { kty: "EC", crv: "P-256", d: b64url(secret), x, y, ext: true }, ECDH, true, ["deriveBits"]);
    const theirs = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: mine.publicKey }, key, 256));
    const ours = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: publicKey }, mine.privateKey, 256));
    return theirs.every((b, i) => b === ours[i]) ? key : null;
  } catch {
    return null;
  }
}
