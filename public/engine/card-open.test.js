// Open start cards (rules.openFaces): the first faces start face up and
// unshuffled, so they cost no cryptography until a shuffle hides them.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "./room.js";
import { CardMatch } from "./card-match.js";
import { fromBase64 } from "./base64.js";
import { RuleError } from "./turn-match.js";
import { withSeededRandom } from "../../test/helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 60_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

// The top `bankSize` cards are a bank (face up if they are the open faces)
// and the rest a hidden pile; each seat starts with a bank card. A turn: take from the bank, draw from the pile,
// grab an open card from another hand, mix a seat's hand (it is shuffled and
// the mover gets the first card), give a card in secret, play a card face up,
// or end the game.
function openRules({ deckSize = 12, openFaces = 6, bankSize = 6 } = {}) {
  return {
    deckSize,
    openFaces,
    newState(first, players, deck) {
      const bank = deck.cards.slice(0, bankSize);
      const pile = deck.cards.slice(bankSize);
      const known = deck.cards.slice(0, openFaces ?? 0).map((s) => deck.face(s));
      const hands = Array.from({ length: players }, (_, p) => {
        const s = bank.shift();
        deck.deal(s, p);
        return [s];
      });
      return { turn: first, winner: -1, players, known, bank, pile, hands, played: [], moves: 0 };
    },
    reveals: (state, player, move) => (Number.isInteger(move?.play) ? [move.play] : []),
    applyMove(state, player, move, deck) {
      if (state.turn !== player) throw new RuleError("not your turn");
      const hand = state.hands[player];
      const holder = (slot) => state.hands.findIndex((h) => h.includes(slot));
      if (move?.take && state.bank.length) {
        const s = state.bank.shift();
        deck.deal(s, player);
        hand.push(s);
      } else if (move?.draw && state.pile.length) {
        const s = state.pile.shift();
        deck.deal(s, player);
        hand.push(s);
      } else if (Number.isInteger(move?.grab) && holder(move.grab) !== -1 && holder(move.grab) !== player && deck.face(move.grab) !== null) {
        const from = state.hands[holder(move.grab)];
        from.splice(from.indexOf(move.grab), 1);
        deck.deal(move.grab, player);
        hand.push(move.grab);
      } else if (Number.isInteger(move?.mix) && state.hands[move.mix]?.length) {
        const [first, ...rest] = deck.shuffle(state.hands[move.mix]);
        deck.deal(first, player);
        for (const s of rest) deck.deal(s, move.mix);
        state.hands[move.mix] = rest;
        state.hands[player].push(first);
      } else if (hand.includes(move?.give) && Number.isInteger(move.to) && move.to !== player) {
        hand.splice(hand.indexOf(move.give), 1);
        deck.pass(move.give, move.to);
        state.hands[move.to].push(move.give);
      } else if (hand.includes(move?.play)) {
        hand.splice(hand.indexOf(move.play), 1);
        state.played.push(deck.face(move.play));
      } else if (move?.end) {
        state.winner = player;
      } else throw new RuleError("bad move");
      state.moves++;
      state.turn = (player + 1) % state.players;
      return [];
    },
  };
}

// Three CardMatches over a localRoom, with every message they send in `wire`.
function table(rules, players = 3) {
  const sessions = localRoom({ game: "toy", names: Array.from({ length: players }, (_, i) => `P${i}`) });
  const wire = [];
  const matches = sessions.map((s) => new CardMatch({ send: (msg) => (wire.push({ ...msg, from: s.index }), s.send(msg)), me: s.index, players, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => matches[i].receive(msg, from)));
  const idle = (n) => matches.every((m) => m.phase !== "starting" && m.state.moves === n && m.busy === null && !m.working);
  // The mover plays; resolves to what went out on the wire meanwhile.
  const move = async (m) => {
    const n = matches[0].state.moves;
    const mover = matches[matches[0].state.turn];
    const from = wire.length;
    await mover.play(m);
    await until(() => idle(n + 1) || matches.some((x) => x.phase === "aborted"));
    for (const x of matches) assert.notEqual(x.phase, "aborted", x.abortReason);
    return wire.slice(from);
  };
  return { matches, wire, move, start: () => until(() => idle(0)) };
}

// Each shuffle's size, from the card count heading its proof's first part.
const shuffleSizes = (msgs) => msgs.filter((m) => m.t === "shuffle" && m.i === 0).map((m) => Number(new DataView(fromBase64(m.d.slice(0, 12)).buffer).getBigUint64(0, true)));
const deckWork = (msgs) => msgs.filter((m) => ["shuffle", "shares", "seal"].includes(m.t));

test("open start cards are known to every seat at once, only the rest are shuffled, and dealing them costs nothing", () => withSeededRandom("card-open 1", async () => {
  const { matches, wire, start } = table(openRules());
  await start();
  for (const m of matches) {
    assert.deepEqual(m.state.known, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(m.slots.slice(0, 6).map((s) => [s.open, s.face]), [0, 1, 2, 3, 4, 5].map((f) => [true, f]));
    assert.ok(m.slots.slice(6).every((s) => !s.open && s.face === null), "the rest are hidden");
  }
  const shuffles = wire.filter((m) => m.t === "shuffle");
  assert.ok(shuffles.every((m) => m.k === 1), "one shuffle round");
  assert.deepEqual(shuffleSizes(shuffles), [6, 6, 6], "each seat shuffles the 6 hidden cards");
  assert.deepEqual(wire.filter((m) => m.t === "shares"), [], "the starting deal of open cards needs no shares");
}));

test("open start cards deal, change hands and show for free; a shuffle hides them, and they deal, pass and show after", () => withSeededRandom("card-open 2", async () => {
  const { matches, move, start } = table(openRules());
  await start();
  const a = matches[0].state.turn;
  const [b, c] = [(a + 1) % 3, (a + 2) % 3];
  const st = () => matches[0].state;

  assert.deepEqual(deckWork(await move({ take: true })), [], "a bank card dealt");
  assert.deepEqual(deckWork(await move({ grab: st().hands[c][0] })), [], "an open card from another hand");
  const faces = st().hands[a].map((s) => matches[0].face(s));
  assert.equal(faces.length, 2);

  const mixed = await move({ mix: a });
  assert.deepEqual(shuffleSizes(mixed), [2, 2, 2]);
  assert.ok(mixed.some((m) => m.t === "shares"), "dealing a hidden card takes shares");
  const [kept] = st().hands[a];
  const stolen = st().hands[c].at(-1);
  for (const m of matches) {
    assert.equal(m.face(kept) !== null, m.me === a, `seat ${m.me} and the card seat ${a} kept`);
    assert.equal(m.face(stolen) !== null, m.me === c, `seat ${m.me} and the card seat ${c} took`);
  }
  assert.deepEqual([matches[a].face(kept), matches[c].face(stolen)].sort(), faces.slice().sort());

  await move({ draw: true });
  const played = await move({ play: st().hands[b][0] });
  assert.deepEqual(played.find((m) => m.t === "move").sh, [], "an open card shows without shares");
  assert.ok(deckWork(await move({ give: stolen, to: b })).some((m) => m.t === "seal"), "a hidden card passes sealed");
  for (const m of matches) assert.equal(m.face(stolen) !== null, m.me === b || m.me === c);
  const shown = await move({ play: kept });
  assert.equal(shown.find((m) => m.t === "move").sh.length, 1, "a hidden card shows with its holder's share");
  for (const m of matches) assert.equal(m.face(kept), matches[a].face(kept));
  assert.equal(st().played.at(-1), matches[a].face(kept));

  await move({ end: true });
  await until(() => matches.every((m) => m.verdict));
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
  }
}));

test("without openFaces nothing starts open: the whole deck is shuffled and the starting deal takes shares", () => withSeededRandom("card-open 3", async () => {
  const rules = openRules({ openFaces: 0 });
  delete rules.openFaces;
  const { matches, wire, move, start } = table(rules);
  await start();
  for (const m of matches) {
    assert.ok(m.slots.every((s) => !s.open), "every card hidden");
    assert.equal(m.slots.filter((s) => s.face !== null).length, 1, "a seat knows its own card alone");
  }
  assert.deepEqual(shuffleSizes(wire), [12, 12, 12]);
  assert.ok(wire.some((m) => m.t === "shares"));
  await move({ end: true });
  await until(() => matches.every((m) => m.verdict));
  for (const m of matches) assert.deepEqual(m.verdict, { ok: true });
}));

test("a deck that is all open starts with no shuffle at all; openFaces outside the deck is refused", () => withSeededRandom("card-open 4", async () => {
  const { matches, wire, move, start } = table(openRules({ deckSize: 6, openFaces: 6 }));
  await start();
  assert.deepEqual(deckWork(wire), []);
  assert.ok(matches.every((m) => m.slots.every((s, f) => s.open && s.face === f)));
  assert.deepEqual(shuffleSizes(await move({ mix: matches[0].state.turn })), [1, 1, 1]);
  await move({ end: true });
  await until(() => matches.every((m) => m.verdict));
  for (const m of matches) assert.deepEqual(m.verdict, { ok: true });

  for (const openFaces of [-1, 1.5, 7, "3"]) {
    assert.throws(() => new CardMatch({ send() {}, me: 0, players: 2, rules: openRules({ deckSize: 6, openFaces }) }), /openFaces must be 0 to deckSize/);
  }
}));
