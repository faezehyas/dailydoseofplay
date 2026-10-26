// Limits keyed by who is asking: a client address today, an account later.
// Everything is in memory, and keys are never logged.

// An address in the client-IP header (X-Forwarded-For unless overridden),
// else the socket's. `entry` picks which one: "first", or "last" when the
// proxy appends the visitor's address to whatever the visitor sent. An
// IPv4-mapped address (::ffff:203.0.113.5) counts as the plain IPv4 one.
// Used only as a limit key, never logged.
export function clientIp(req, header = "x-forwarded-for", entry = "first") {
  const entries = String(req?.headers?.[header.toLowerCase()] || "").split(",").map((e) => e.trim()).filter(Boolean);
  const ip = (entry === "last" ? entries.at(-1) : entries[0]) || req?.socket?.remoteAddress || null;
  return ip && ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
}

// At most `max` live things (connections, rooms) per key. A null key is never
// limited: one shared bucket for unknown clients would lock everyone out.
export function createQuota(max) {
  const counts = new Map();
  return {
    take(key) {
      if (key == null) return true;
      const n = counts.get(key) || 0;
      if (n >= max) return false;
      counts.set(key, n + 1);
      return true;
    },
    give(key) {
      if (key == null) return;
      const n = (counts.get(key) || 0) - 1;
      if (n > 0) counts.set(key, n);
      else counts.delete(key);
    },
    count: (key) => counts.get(key) || 0,
  };
}

// Refills `rate` tokens a second and holds at most `burst`; take() spends one.
export function createTokenBucket({ rate, burst, now = Date.now }) {
  let tokens = burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) * rate) / 1000);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

// At most `max` takes per key in any `windowMs` (a sliding window). A null key
// is never limited; sweep() drops keys whose window has emptied.
export function createRateLimit({ max, windowMs, now = Date.now }) {
  const hits = new Map(); // key -> timestamps in the window, oldest first
  const recent = (list, t) => {
    while (list.length && t - list[0] >= windowMs) list.shift();
    return list;
  };
  return {
    take(key) {
      if (key == null) return true;
      const t = now();
      const list = recent(hits.get(key) || [], t);
      if (list.length >= max) return false;
      list.push(t);
      hits.set(key, list);
      return true;
    },
    sweep() {
      const t = now();
      for (const [key, list] of hits) if (!recent(list, t).length) hits.delete(key);
    },
  };
}
