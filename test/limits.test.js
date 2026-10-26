import test from "node:test";
import assert from "node:assert/strict";
import { clientIp, createQuota, createRateLimit, createTokenBucket } from "../server/limits.js";

test("quota: at most max per key, give frees a slot, a null key is never limited", () => {
  const quota = createQuota(2);
  assert.ok(quota.take("a") && quota.take("a"));
  assert.equal(quota.take("a"), false);
  assert.ok(quota.take("b"));
  quota.give("a");
  assert.equal(quota.count("a"), 1);
  assert.ok(quota.take("a"));
  for (let i = 0; i < 10; i++) assert.ok(quota.take(null));
  quota.give("a");
  quota.give("a");
  quota.give("a");
  assert.equal(quota.count("a"), 0, "never below zero");
});

test("token bucket: a full burst, then refills at the rate up to the burst", () => {
  let now = 0;
  const bucket = createTokenBucket({ rate: 20, burst: 3, now: () => now });
  assert.deepEqual([bucket.take(), bucket.take(), bucket.take(), bucket.take()], [true, true, true, false]);
  now += 50; // one token at 20 a second
  assert.deepEqual([bucket.take(), bucket.take()], [true, false]);
  now += 60_000;
  assert.deepEqual([bucket.take(), bucket.take(), bucket.take(), bucket.take()], [true, true, true, false]);
});

test("clientIp: first forwarded address, a named header, else the socket", () => {
  const socket = { remoteAddress: "127.0.0.1" };
  assert.equal(clientIp({ headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" }, socket }), "203.0.113.1");
  assert.equal(clientIp({ headers: { "fly-client-ip": "192.0.2.4" }, socket }, "Fly-Client-IP"), "192.0.2.4");
  assert.equal(clientIp({ headers: {}, socket }), "127.0.0.1");
  assert.equal(clientIp({ headers: {} }), null);
});

test("clientIp: the last entry when the proxy appends, and IPv4-mapped addresses as plain IPv4", () => {
  const socket = { remoteAddress: "::ffff:127.0.0.100" };
  const req = (xff) => ({ headers: { "x-forwarded-for": xff }, socket });
  assert.equal(clientIp(req("198.51.100.9, 203.0.113.1"), undefined, "last"), "203.0.113.1");
  assert.equal(clientIp(req("198.51.100.9, 203.0.113.1"), undefined, "first"), "198.51.100.9");
  assert.equal(clientIp(req("::ffff:203.0.113.1")), "203.0.113.1");
  assert.equal(clientIp(req("2001:db8::1")), "2001:db8::1");
  assert.equal(clientIp(req("::ffff:2001:db8::1")), "::ffff:2001:db8::1", "only a mapped IPv4 address loses the prefix");
  assert.equal(clientIp(req(""), undefined, "last"), "127.0.0.100", "else the socket, normalised too");
});

test("rate limit: at most max per key in a sliding window; a null key is never limited", () => {
  let now = 0;
  const limit = createRateLimit({ max: 2, windowMs: 1000, now: () => now });
  assert.deepEqual([limit.take("a"), limit.take("a"), limit.take("a"), limit.take("b")], [true, true, false, true]);
  now = 999;
  assert.equal(limit.take("a"), false);
  now = 1000;
  assert.deepEqual([limit.take("a"), limit.take("a")], [true, true], "the first two left the window");
  for (let i = 0; i < 10; i++) assert.ok(limit.take(null));
  limit.sweep();
});
