// Passing a hidden card in secret (deck.pass): CardMatch seals the giver's
// shares to the receiver, and the audit checks every sealed card.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "./room.js";
import { localPair } from "./channel.js";
import { admitGuest } from "./session.js";
import { CardMatch } from "./card-match.js";
import { deckService } from "./deck-service.js";
import { toBase64, fromBase64 } from "./base64.js";
import { RuleError } from "./turn-match.js";
import { SealError } from "./seal.js";
import { withSeededRandom } from "../../test/helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 60_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}
const done = (m) => m.verdict || (m.phase === "aborted" && !m.disputing);

function tap(session, change) {
  const send = session.send.bind(session);
  session.send = (msg) => {
    const out = change(msg);
    return out === null ? true : send(out ?? msg);
  };
}

// Each seat is dealt `hand` cards. The script says who moves and how: pass your
// first card to the next seat, take the previous seat's first card, or play
// your first card face up. A card passed or taken goes first in its new hand.
function passRules(script, { hand = 2, deckSize = 9 } = {}) {
  return {
    deckSize,
    newState(first, players, deck) {
      const draw = deck.cards.slice();
      const hands = Array.from({ length: players }, (_, p) => draw.splice(0, hand).map((slot) => (deck.deal(slot, p), slot)));
      return { turn: script[0].seat, winner: -1, players, hands, played: [], step: 0 };
    },
    reveals: (state, player, move) => (move?.play ? [state.hands[player][0]] : []),
    applyMove(state, player, move, deck) {
      if (state.turn !== player) throw new RuleError("not your turn");
      const n = state.players;
      if (move.pass) {
        const slot = state.hands[player].shift();
        deck.pass(slot, (player + 1) % n);
        state.hands[(player + 1) % n].unshift(slot);
      } else if (move.take) {
        const from = (player + n - 1) % n;
        const slot = state.hands[from].shift();
        deck.pass(slot, player);
        state.hands[player].unshift(slot);
      } else if (move.play) {
        const slot = state.hands[player].shift();
        state.played.push([player, slot, deck.face(slot)]);
      } else throw new RuleError("bad move");
      if (++state.step === script.length) state.winner = 0;
      else state.turn = script[state.step].seat;
      return [];
    },
  };
}

function seated(players, rules) {
  const sessions = localRoom({ game: "toy", names: Array.from({ length: players }, (_, i) => `P${i}`) });
  const matches = sessions.map((s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => matches[i].receive(msg, from)));
  return { sessions, matches };
}

// Plays the script; at(step, matches) runs before each move. Returns once every seat is done.
async function run(players, script, { before = () => {}, at = () => {}, rules = passRules(script), done: finished = done } = {}) {
  const { sessions, matches } = seated(players, rules);
  before(sessions, matches);
  await until(() => matches.every((m) => m.phase === "playing" || done(m)));
  for (const [step, { seat, move }] of script.entries()) {
    await until(() => matches.every((m) => m.phase !== "playing" || (m.state.step === step && !m.working)) || matches.some((m) => m.phase === "aborted"));
    if (matches.some((m) => m.phase === "aborted")) break;
    await at(step, matches);
    await matches[seat].play(move);
  }
  await until(() => matches.every(finished));
  return { sessions, matches };
}

// What a seat may know: open cards, its hand, and cards it held before.
function assertKnows(m, held) {
  for (const [id, s] of m.slots.entries()) {
    if (s.face !== null && !s.gone) assert.ok(s.open || s.owner === m.me || held.has(`${m.me}:${id}`), `seat ${m.me} knows slot ${id}`);
  }
}

test("a pass, then a play: only the receiver (and the giver) reads it until it's played", () => withSeededRandom("card-pass 1", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  let passed, face;
  const { matches } = await run(3, script, {
    at: (step, ms) => {
      if (step === 0) [passed] = ms[0].state.hands[0];
      if (step !== 1) return;
      face = ms[0].face(passed);
      assert.notEqual(face, null);
      assert.equal(ms[1].face(passed), face, "the receiver reads it");
      assert.equal(ms[2].face(passed), null, "a third player doesn't");
      assert.equal(ms[2].slots[passed].owner, 1);
      for (const m of ms) assertKnows(m, new Set([`0:${passed}`]));
    },
  });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true }, `seat ${m.me}: ${m.abortReason}`);
    assert.deepEqual(m.state.played, [[1, passed, face]]);
    assert.equal(m.sealed.length, 1);
  }
}));

test("a pass twice (A to B to C), then C plays it with A's share, which B forwarded", () => withSeededRandom("card-pass 2", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { pass: true } }, { seat: 2, move: { play: true } }];
  let passed;
  const { matches } = await run(4, script, {
    at: (step, ms) => {
      if (step === 0) [passed] = ms[0].state.hands[0];
      if (step === 2) {
        assert.equal(ms[2].face(passed), ms[0].face(passed));
        assert.equal(ms[3].face(passed), null);
        assert.equal(ms[3].slots[passed].owner, 2);
        for (const m of ms) assertKnows(m, new Set([`0:${passed}`, `1:${passed}`]));
      }
    },
  });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true }, `seat ${m.me}: ${m.abortReason}`);
    assert.equal(m.state.played[0][2], matches[0].face(passed));
    assert.deepEqual(m.sealed.map((p) => [p.from, p.to, p.need]), [[0, 1, [0]], [1, 2, [0]]]);
  }
}));

test("a mover may pass a card it doesn't hold: the holder's browser seals it by itself", () => withSeededRandom("card-pass 3", async () => {
  const script = [{ seat: 1, move: { take: true } }, { seat: 1, move: { play: true } }];
  let taken;
  const { matches } = await run(3, script, {
    at: (step, ms) => {
      if (step === 0) [taken] = ms[0].state.hands[0];
      if (step === 1) {
        assert.equal(ms[1].face(taken), ms[0].face(taken));
        assert.equal(ms[2].face(taken), null);
      }
    },
  });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true }, `seat ${m.me}: ${m.abortReason}`);
    assert.deepEqual(m.sealed.map((p) => [p.from, p.to]), [[0, 1]]);
  }
}));

test("a card dealt and passed in the same call goes straight to its last seat", () => withSeededRandom("card-pass 4", async () => {
  const rules = {
    deckSize: 4,
    newState(first, players, deck) {
      deck.deal(deck.cards[0], 0);
      deck.pass(deck.cards[0], 1);
      return { turn: 0, winner: 0, card: deck.cards[0] };
    },
    applyMove: () => [],
  };
  const { matches } = seated(3, rules);
  await until(() => matches.every((m) => m.verdict));
  for (const m of matches) assert.deepEqual(m.verdict, { ok: true });
  assert.equal(matches[0].slots[0].face, null);
  assert.notEqual(matches[1].slots[0].face, null);
  assert.equal(matches[0].sealed.length, 0, "nothing to seal: it was simply dealt to seat 1");
}));

test("only a card in a hand can be passed", () => withSeededRandom("card-pass 5", async () => {
  const rules = passRules([{ seat: 0, move: {} }]);
  const bad = { ...rules, applyMove: (state, player, move, deck) => (deck.pass(8, 1), []) }; // slot 8 was never dealt
  const { matches } = seated(2, bad);
  await until(() => matches.every((m) => m.phase === "playing"));
  const invalid = [];
  matches[0].on("invalid", (why) => invalid.push(why));
  await matches[0].play({});
  assert.deepEqual(invalid, ["only a card in a hand can be passed"]);
}));

// The wire, as the room creator sees it: every message every seat sends.
test("nobody else can read a passed card from the wire until it's played, not even the room creator", () => withSeededRandom("card-pass 6", async () => {
  const script = [{ seat: 1, move: { pass: true } }, { seat: 2, move: { play: true } }];
  const wire = [];
  let passed, token;
  await run(3, script, {
    before: (sessions) => sessions.forEach((s) => tap(s, (msg) => void wire.push(JSON.stringify(msg)))),
    at: async (step, ms) => {
      if (step === 0) {
        [passed] = ms[1].state.hands[1];
        // Seat 1's share of it: the one share it never sent, which would open the card.
        const [share] = await deckService().shares(ms[1].key.secret, [ms[1].slots[passed].card]);
        token = toBase64(share).slice(0, 44);
      }
      if (step === 1) {
        assert.ok(!wire.some((m) => m.includes(token)), "seat 1's share never went out in the clear");
        assert.equal(ms[0].face(passed), null, "the room creator can't read it");
        assert.ok(wire.some((m) => m.includes('"t":"seal"')), "it went sealed");
      }
    },
  });
  assert.ok(wire.some((m) => m.includes('"t":"move"') && m.includes(token)), "playing it showed the share");
}));

// The giver's browser flips a byte of each envelope it seals.
function tamper(match, at) {
  const real = match.seals.seal;
  match.seals = { ...match.seals, seal: async (...args) => ((env) => ((env[at] ^= 1), env))(await real(...args)) };
}

test("a tampered envelope is refused by its receiver at once, and the dispute names the giver", () => withSeededRandom("card-pass 7", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  const { matches } = await run(3, script, { before: (sessions, ms) => tamper(ms[0], 20) });
  const [, receiver, third] = matches;
  assert.equal(receiver.phase, "aborted");
  assert.deepEqual([receiver.abortSeat, receiver.abortReason], [0, "passed a card that doesn't check out"]);
  assert.deepEqual([third.abortSeat, third.abortAbout, third.abortReason], [1, 0, "stopped the match: passed a card that doesn't check out"]);
  assert.equal(third.state.step, 1, "stopped before the next move");
  for (const m of matches) assert.deepEqual(m.verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 0 }, `seat ${m.me}`);
}));

test("a share sealed for another card is caught by the receiver at once", () => withSeededRandom("card-pass 8", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  const { matches } = await run(3, script, {
    before: (sessions, ms) => {
      const real = ms[0].seals.seal;
      ms[0].seals = {
        ...ms[0].seals,
        async seal(priv, pub, context, plain) {
          const other = ms[0].state.hands[0].at(-1);
          const [wrong] = await deckService().shares(ms[0].key.secret, [ms[0].slots[other].card]);
          return real(priv, pub, context, wrong);
        },
      };
    },
  });
  assert.equal(matches[1].abortReason, "passed a card that doesn't check out");
  for (const m of matches) assert.deepEqual(m.verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 0 });
}));

test("a receiver who says a good envelope is bad is named by the dispute", () => withSeededRandom("card-pass 9", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  const { matches } = await run(3, script, {
    before: (sessions, ms) => {
      const real = ms[1].seals.unseal;
      let lied = false;
      ms[1].seals = { ...ms[1].seals, unseal: (...args) => (lied ? real(...args) : ((lied = true), Promise.reject(new SealError("lie")))) };
    },
  });
  for (const m of [matches[0], matches[2]]) {
    assert.deepEqual([m.abortSeat, m.abortAbout], [1, 0], "seat 1 stopped the match, about seat 0");
    assert.deepEqual(m.verdict, { ok: false, reason: "said a passed card didn't check out, but it did", seat: 1 }, `seat ${m.me}`);
  }
}));

test("a seat that is behind when the dispute arrives still gets there and judges it", () => withSeededRandom("card-pass 10", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  let waited = false;
  const { matches } = await run(3, script, {
    before: (sessions, ms) => {
      tamper(ms[0], 30);
      // Seat 2 gets the sealed card only after the dispute about it.
      const receive = ms[2].receive.bind(ms[2]);
      const held = [];
      ms[2].receive = (msg, from) => {
        if (msg.t === "seal") return void held.push([msg, from]);
        receive(msg, from);
        if (msg.t !== "abort") return;
        waited = ms[2].dispute !== null && ms[2].phase === "playing";
        for (const [m, f] of held.splice(0)) receive(m, f);
      };
    },
  });
  assert.ok(waited, "seat 2 played on to the disputed step before stopping");
  assert.deepEqual(matches[2].verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 0 });
}));

test("a made-up dispute about a later step doesn't hide a real one", () => withSeededRandom("card-pass 11", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  const { matches } = await run(4, script, {
    before: (sessions, ms) => {
      tamper(ms[0], 30);
      // Seat 3 claims a dispute far ahead, before anything has been passed.
      sessions[3].send({ t: "abort", m: 1, reason: "made up", about: 1, dispute: 1e9 });
      // Seat 2 gets the sealed card only after the real dispute, so it has to wait for that step.
      const receive = ms[2].receive.bind(ms[2]);
      const held = [];
      ms[2].receive = (msg, from) => {
        if (msg.t === "seal") return void held.push([msg, from]);
        receive(msg, from);
        if (msg.t === "abort" && from === 1) for (const [m, f] of held.splice(0)) receive(m, f);
      };
    },
    done: (m) => m.me === 3 || m.verdict || (m.phase === "aborted" && !m.disputing),
  });
  assert.deepEqual(matches[2].verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 0 });
}));

test("a giver who answers a dispute with an abort of its own still gets judged", () => withSeededRandom("card-pass 12", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  const { matches } = await run(3, script, {
    before: (sessions, ms) => {
      tamper(ms[0], 30);
      // As soon as seat 0 hears the dispute, it blames seat 1 instead.
      const receive = ms[0].receive.bind(ms[0]);
      ms[0].receive = (msg, from) => {
        if (msg.t === "abort" && msg.dispute) sessions[0].send({ t: "abort", m: 1, reason: "a lie", about: 1 });
        receive(msg, from);
      };
      // Seat 2 gets the sealed card only after both aborts.
      const r2 = ms[2].receive.bind(ms[2]);
      const held = [];
      ms[2].receive = (msg, from) => {
        if (msg.t === "seal") return void held.push([msg, from]);
        r2(msg, from);
        if (msg.t === "abort" && from === 0) for (const [m, f] of held.splice(0)) r2(m, f);
      };
    },
  });
  assert.deepEqual(matches[2].verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 0 });
}));

test("playing a passed card with a forwarded share that's wrong blames the player", () => withSeededRandom("card-pass 13", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  const { matches } = await run(3, script, {
    before: (sessions) =>
      tap(sessions[1], (msg) => {
        if (msg.t !== "move" || !msg.sh.length) return;
        const sh = fromBase64(msg.sh[0]);
        sh[40] ^= 1;
        return { ...msg, sh: [toBase64(sh)] };
      }),
  });
  for (const m of [matches[0], matches[2]]) {
    assert.ok(m.abortSeat === 1 || m.abortAbout === 1, `seat ${m.me} blames ${m.abortSeat} about ${m.abortAbout}`);
    assert.match(m.abortReason, /sent a share that doesn't check out/);
  }
}));

test("a middle holder who forwards a bad share is the one named (A to B to C)", () => withSeededRandom("card-pass 14", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { pass: true } }, { seat: 2, move: { play: true } }];
  const { matches } = await run(4, script, { before: (sessions, ms) => tamper(ms[1], 25) });
  for (const m of matches) assert.deepEqual(m.verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 1 }, `seat ${m.me}`);
}));

test("in a dispute, one party's key is enough; with neither key checking out there's no verdict, and no wait", () => withSeededRandom("card-pass 15", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  // The giver lies and keeps its key to itself: the receiver's settles it.
  const quiet = await run(3, script, {
    before: (sessions, ms) => {
      tamper(ms[0], 30);
      tap(sessions[0], (msg) => (msg.t === "unseal" ? null : msg));
    },
  });
  assert.deepEqual(quiet.matches[2].verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 0 });
  // Both reveal a key that isn't theirs: the third player gives up rather than wait.
  const bad = { t: "unseal", key: toBase64(new Uint8Array(32).fill(5)) };
  const { matches } = await run(3, script, {
    before: (sessions, ms) => {
      tamper(ms[0], 30);
      for (const s of sessions.slice(0, 2)) tap(s, (msg) => (msg.t === "unseal" ? { ...bad, m: msg.m } : msg));
    },
    done: (m) => m.me !== 2 || (m.phase === "aborted" && !m.disputing),
  });
  assert.deepEqual([matches[2].verdict, matches[2].disputing], [null, false]);
}));

test("a card passed and opened in the same call needs no envelope", () => withSeededRandom("card-pass 16", async () => {
  const rules = {
    deckSize: 6,
    newState: (first, players, deck) => ({ turn: 0, winner: -1, card: [deck.cards[0]].map((slot) => (deck.deal(slot, 0), slot))[0] }),
    applyMove(state, player, move, deck) {
      deck.pass(state.card, 1);
      deck.open(state.card);
      state.winner = 0;
      return [];
    },
  };
  const { matches } = seated(3, rules);
  await until(() => matches.every((m) => m.phase === "playing"));
  await matches[0].play({});
  await until(() => matches.every((m) => m.verdict));
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.equal(m.sealed.length, 0);
    assert.notEqual(m.face(0), null, `seat ${m.me} reads the opened card`);
  }
}));

test("the audit opens every sealed card and names a giver whose receiver kept quiet", () => withSeededRandom("card-pass 17", async () => {
  // Seat 0 seals a share of another card; seat 1 (in on it) doesn't check. Nobody plays the card.
  const script = [{ seat: 0, move: { pass: true } }, { seat: 2, move: { play: true } }];
  const { matches } = await run(3, script, {
    before: (sessions, ms) => {
      const real = ms[0].seals.seal;
      ms[0].seals = {
        ...ms[0].seals,
        async seal(priv, pub, context) {
          const [wrong] = await deckService().shares(ms[0].key.secret, [ms[0].slots[ms[0].state.hands[0].at(-1)].card]);
          return real(priv, pub, context, wrong);
        },
      };
      const deck = ms[1].deck;
      ms[1].deck = { ...deck, verifyShares: async () => {}, open: (...a) => deck.open(...a).catch(() => 0) };
    },
  });
  assert.equal(matches[1].phase, "over");
  for (const m of [matches[0], matches[2]]) assert.deepEqual(m.verdict, { ok: false, reason: "passed a card that doesn't check out", seat: 0 }, `seat ${m.me}`);
}));

test("revealing a seal key that isn't yours fails the audit", () => withSeededRandom("card-pass 18", async () => {
  const script = [{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }];
  const { matches } = await run(2, script, {
    before: (sessions) => tap(sessions[1], (msg) => (msg.t === "audit" ? { ...msg, seal: toBase64(new Uint8Array(32).fill(7)) } : msg)),
  });
  assert.deepEqual(matches[0].verdict, { ok: false, reason: "revealed a key that isn't the one they played with", seat: 1 });
}));

test("a seal key swapped at the hello doesn't check out, since the card key's proof covers it", () => withSeededRandom("card-pass 19", async () => {
  const { matches } = seated(2, passRules([{ seat: 0, move: { pass: true } }]));
  const { sealKeys } = await import("./seal.js");
  const other = await sealKeys();
  // A relay that swaps in its own seal key for seat 1's.
  const receive = matches[0].receive.bind(matches[0]);
  matches[0].receive = (msg, from) => receive(msg.t === "hello" ? { ...msg, seal: toBase64(other.public) } : msg, from);
  await until(() => matches[0].phase === "aborted");
  assert.equal(matches[0].abortSeat, 1);
  assert.match(matches[0].abortReason, /sent a key that doesn't check out/);
}));

test("a sealed round with an envelope missing stops the match", () => withSeededRandom("card-pass 20", async () => {
  const rules = {
    deckSize: 6,
    newState: (first, players, deck) => ({ turn: 0, winner: -1, hand: deck.cards.slice(0, 2).map((slot) => (deck.deal(slot, 0), slot)) }),
    applyMove(state, player, move, deck) {
      state.hand.forEach((slot) => deck.pass(slot, 1));
      state.winner = 0;
      return [];
    },
  };
  const { sessions, matches } = seated(3, rules);
  tap(sessions[0], (msg) => (msg.t === "seal" ? { ...msg, d: msg.d.slice(1) } : msg));
  await until(() => matches.every((m) => m.phase === "playing"));
  await matches[0].play({});
  await until(() => matches.slice(1).every((m) => m.phase === "aborted"));
  for (const m of matches.slice(1)) assert.ok(m.abortSeat === 0 || m.abortAbout === 0);
  assert.match(matches[1].abortReason, /sent 1 sealed cards where 2 were due/);
}));

test("a match sends its audit keys as soon as it ends, so a rematch vote can't overtake them", () => withSeededRandom("card-pass 21", async () => {
  // The router drops an old match's messages once a rematch starts, so the keys must go first.
  const { sessions, matches } = seated(2, passRules([{ seat: 0, move: { pass: true } }, { seat: 1, move: { play: true } }]));
  const sent = [];
  tap(sessions[1], (msg) => void sent.push(msg.t));
  const before = new Promise((resolve) => matches[1].on("over", () => setTimeout(() => resolve(sent.includes("audit")), 0)));
  await until(() => matches.every((m) => m.phase === "playing"));
  // A slow device: WebCrypto takes a while from here on.
  const subtle = globalThis.crypto.subtle;
  const exportKey = subtle.exportKey;
  subtle.exportKey = async (...args) => (await new Promise((r) => setTimeout(r, 50)), exportKey.apply(subtle, args));
  try {
    await matches[0].play({ pass: true });
    await until(() => matches[1].canMove());
    await matches[1].play({ play: true });
    assert.equal(await before, true, "the audit went out before the next task, where a click would land");
    await until(() => matches.every((m) => m.verdict));
  } finally {
    subtle.exportKey = exportKey;
  }
}));

test("a page from before the secret pass is told to reload when it connects, before any game", () => withSeededRandom("card-pass 22", async () => {
  const [host, guest] = localPair();
  const admitted = admitGuest(host, { game: "hearts" });
  const answers = [];
  guest.on("message", (msg) => answers.push(msg.t));
  guest.send({ t: "$hello", name: "Old", game: "hearts", v: 2 });
  await assert.rejects(admitted, /version_mismatch/);
  await until(() => answers.length);
  assert.deepEqual(answers, ["$reject"]);
}));
