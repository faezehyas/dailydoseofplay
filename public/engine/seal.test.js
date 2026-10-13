import test from "node:test";
import assert from "node:assert/strict";
import { sealKeys, sealPublic, revealedKey, seal, unseal, sealedBytes, SealError, SEAL_PUBLIC_BYTES } from "./seal.js";

const [giver, receiver, stranger] = await Promise.all([sealKeys(), sealKeys(), sealKeys()]);
const plain = Uint8Array.from({ length: 131 }, (_, i) => i);
const env = await seal(giver.privateKey, receiver.publicKey, "m1/k3/slot7/0-1", plain);

test("either side opens an envelope: the receiver with the giver's public key, or the giver", async () => {
  assert.equal(env.length, sealedBytes(131));
  assert.deepEqual(await unseal(receiver.privateKey, giver.publicKey, "m1/k3/slot7/0-1", env), plain);
  assert.deepEqual(await unseal(giver.privateKey, receiver.publicKey, "m1/k3/slot7/0-1", env), plain);
});

test("a wrong recipient, a wrong place or a changed byte can't open it", async () => {
  await assert.rejects(unseal(stranger.privateKey, giver.publicKey, "m1/k3/slot7/0-1", env), SealError);
  await assert.rejects(unseal(receiver.privateKey, giver.publicKey, "m1/k3/slot8/0-1", env), SealError, "an envelope moved to another slot");
  for (const at of [0, 12, env.length - 1]) {
    const bad = env.slice();
    bad[at] ^= 1;
    await assert.rejects(unseal(receiver.privateKey, giver.publicKey, "m1/k3/slot7/0-1", bad), SealError, `byte ${at}`);
  }
  await assert.rejects(unseal(receiver.privateKey, giver.publicKey, "m1/k3/slot7/0-1", env.slice(0, 20)), SealError);
});

test("the same card sealed twice gives different envelopes", async () => {
  const again = await seal(giver.privateKey, receiver.publicKey, "m1/k3/slot7/0-1", plain);
  assert.notDeepEqual(again, env);
});

test("public keys: 65 bytes, and a point off the curve is refused", async () => {
  assert.equal(giver.public.length, SEAL_PUBLIC_BYTES);
  await sealPublic(giver.public);
  const off = giver.public.slice();
  off[40] ^= 1;
  await assert.rejects(sealPublic(off), SealError);
  await assert.rejects(sealPublic(giver.public.slice(1)), SealError);
});

test("a revealed key is accepted only if it belongs to the published one", async () => {
  const key = await revealedKey(giver.secret, giver.publicKey, receiver);
  assert.ok(key);
  assert.deepEqual(await unseal(key, receiver.publicKey, "m1/k3/slot7/0-1", env), plain, "the audit opens it with the revealed key");
  assert.equal(await revealedKey(stranger.secret, giver.publicKey, receiver), null);
  assert.equal(await revealedKey(new Uint8Array(32).fill(3), giver.publicKey, receiver), null);
  assert.equal(await revealedKey(new Uint8Array(31), giver.publicKey, receiver), null);
});
