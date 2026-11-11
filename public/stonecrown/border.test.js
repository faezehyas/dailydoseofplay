import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KnownDeck, settleAll } from "../../test/fixtures/known-deck.js";
import { rngFromSeed } from "../engine/rng.js";
import { CARDS, WONDERS } from "./cards.js";
import { makeRules, deckOf, movers, legalMoves, reveals, production, shields, ROUNDS } from "./rules.js";
import { borderSvg, borderFacts, borderFlags, warResults, warnWords, wallLevel } from "./border.js";

const css = readFileSync(new URL("./border.css", import.meta.url), "utf8");

function assertWellFormed(svg) {
  const stack = [];
  assert.equal(svg.replace(/<[^>]*>/g, "").replace(/[^<>]/g, ""), "", "no stray angle brackets");
  for (const t of svg.match(/<[^>]*>/g) || []) {
    const m = t.match(/^<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>$/);
    assert.ok(m, `well-formed tag: ${t.slice(0, 120)}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `closes ${m[2]}`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, [], "every tag is closed");
}
// A border can show twice on a page (both neighbours): no ids, no url() references, no stray numbers.
function assertClean(svg) {
  assertWellFormed(svg);
  assert.ok(!/\sid="/.test(svg), "no ids");
  assert.ok(!/url\(/.test(svg), "no url() references");
  assert.ok(!/NaN|undefined|Infinity|null/.test(svg), "no NaN, undefined, null or Infinity");
  assert.match(svg, /^<svg class="sc-border-svg sc-b-(left|right) sc-b-them-\d sc-b-me-\d" viewBox="0 0 240 80" preserveAspectRatio="xMidYMax slice" role="img" aria-label="[^"]+">/);
}
const classes = (svg) => new Set([...svg.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));

const SHIELDS = [0, 1, 2, 3, 5, 6, 9];
function everyArt() {
  const all = [];
  for (const side of ["left", "right"])
    for (const raw of [1, 2])
      for (const goods of [1, 2])
        for (const theirs of SHIELDS)
          for (const mine of SHIELDS) all.push({ side, raw, goods, walls: [theirs, mine], seats: [(theirs + 1) % 7, mine % 4], svg: borderSvg({ side, raw, goods, walls: [theirs, mine], seats: [(theirs + 1) % 7, mine % 4] }) });
  return all;
}

test("every crossing, stall and wall draws a clean strip", () => {
  for (const { side, raw, goods, walls, svg } of everyArt()) {
    assertClean(svg);
    const c = classes(svg);
    assert.equal(c.has("sc-b-bridge"), raw === 1, "a bridge with a raw discount");
    assert.equal(c.has("sc-b-ferry") && c.has("sc-b-raft"), raw !== 1, "a ferry and its raft without one");
    assert.equal(c.has("sc-b-stall"), goods === 1, "a stall with a goods discount");
    assert.equal(svg.includes(`<g transform="matrix(-1 0 0 1 240 0)">`), true, "your bank is the mirror of theirs");
    assert.equal(svg.startsWith(`<svg class="sc-border-svg sc-b-${side}`), true);
    // Their bank and yours each explain their defences; the crossing explains itself.
    assert.equal((svg.match(/data-tip="wall"/g) || []).length, 2);
    assert.equal((svg.match(/data-tip="crossing"/g) || []).length, 1);
    assert.equal((svg.match(new RegExp(`data-tip-side="${side}"`, "g")) || []).length, 3);
    assert.match(svg, raw === 1 ? /aria-label="A stone bridge/ : /aria-label="A rope ferry/);
    assert.ok(walls.length === 2);
  }
});

test("walls grow with shields: open ground, a palisade, a stone wall, towers", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 12, -1].map(wallLevel), [0, 1, 1, 2, 2, 3, 3, 0]);
  const at = (theirs, mine) => borderSvg({ walls: [theirs, mine] });
  const looks = new Set([0, 1, 3, 6].map((s) => at(s, 0)));
  assert.equal(looks.size, 4, "each level of their bank looks different");
  assert.equal(new Set([0, 1, 3, 6].map((s) => at(0, s))).size, 4, "and of yours");
  assert.equal(at(1, 0), at(2, 0), "1 and 2 shields share the palisade");
  assert.equal(at(3, 0), at(5, 0));
  assert.equal(at(6, 0), at(11, 0));
  assert.match(at(0, 6), /a wall with towers on yours/);
  assert.match(at(4, 0), /a stone wall on their bank/);
  // Each bank's roofs take its seat's colour, the mirror flips the whole scene for a right neighbour.
  assert.match(borderSvg({ seats: [3, 2] }), /sc-b-them-3 sc-b-me-2/);
  assert.match(borderSvg({ side: "right" }), /^<svg[^>]*><g transform="matrix\(-1 0 0 1 240 0\)">/);
});

test("border.css paints every class, every colour a token with light and dark values", () => {
  const block = (start) => css.slice(css.indexOf("{", css.indexOf(start)) + 1, css.indexOf("}", css.indexOf(start)));
  const tokens = (body) => [...body.matchAll(/(--sc-b-[\w-]+):/g)].map((m) => m[1]).sort();
  const light = tokens(block(":root {"));
  assert.ok(light.length > 40);
  assert.deepEqual(tokens(block(':root:not([data-theme="light"])')), light);
  assert.deepEqual(tokens(block(':root[data-theme="dark"] {')), light);
  const defined = new Set([...light, "--sc-b-them", "--sc-b-me"]);
  for (const [, v] of css.matchAll(/var\((--sc-b-[\w-]+)\)/g)) assert.ok(defined.has(v), `${v} is defined`);
  const value = (sel, t) => block(sel).match(new RegExp(`${t}:\\s*([^;]+);`))[1];
  for (const t of ["--sc-b-night", "--sc-b-sky", "--sc-b-win", "--sc-b-water", "--sc-b-chip", "--sc-b-ink"]) assert.notEqual(value(":root {", t), value(':root[data-theme="dark"] {', t), t);
  assert.equal(value(':root[data-theme="dark"] {', "--sc-b-night"), "1");

  const used = new Set(everyArt().flatMap(({ svg }) => [...classes(svg)]));
  for (const c of used) if (/^sc-(b[fs]-[\w-]+|b-[\w-]+)$/.test(c) && !/^sc-b-(left|right|ferry|raft|bridge|stall)$/.test(c)) assert.match(css, new RegExp(`\\.${c}(?![\\w-])`), `.${c} is styled`);
  // Any seat 0 to 6 has a roof colour on either bank.
  for (let p = 0; p < 7; p++) for (const who of ["them", "me"]) assert.match(css, new RegExp(`\\.sc-b-${who}-${p} \\{ --sc-b-${who}: var\\(--sc-b-seat-${p}\\); \\}`));
  const motion = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  assert.ok(motion > 0 && !/animation:/.test(css.slice(0, motion)), "no animation outside the reduced-motion query");
});

// ---------- facts over real states ----------
const W = (key) => WONDERS.findIndex((w) => w.key === key);
const ID = (key) => CARDS.find((x) => x.key === key).id;
function table({ players = 3, side = "A", wonders, seed = "border" } = {}) {
  const rules = makeRules({ side }, players);
  const deck = new KnownDeck([...Array(rules.deckSize).keys()], seed);
  for (const s of deck.slots) s.open = true;
  const st = rules.newState(0, players, deck, rngFromSeed(seed));
  settleAll(rules, st, deck);
  if (wonders) st.wonders = wonders.map(([key, s = "A"]) => ({ w: W(key), side: s }));
  const slot = (id, owner) => deck.slots.push({ face: deckOf(players).indexOf(id), owner, open: true, gone: false, held: [] }) - 1;
  return {
    rules, deck, st,
    city: (p, ...keys) => (st.city[p] = keys.map((k) => ({ slot: slot(ID(k), p), id: ID(k) }))),
    stages: (p, k) => (st.stages[p] = Array.from({ length: k }, () => slot(deckOf(players)[0], p))),
  };
}

test("borderFacts: prices by side and kind, shields, what they sell, from a real state", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  // Seat 0's left neighbour is seat 1, its right seat 2.
  let f = borderFacts(t.st, 0, "left");
  assert.equal(f.seat, 1);
  assert.deepEqual([f.raw, f.goods], [2, 2]);
  assert.deepEqual(f.shields, { mine: 0, theirs: 0 });
  assert.deepEqual(f.flags, [null, null, null]);
  assert.equal(f.warn, null);
  t.city(0, "west-road", "palisade");
  t.city(1, "woodcutters-camp", "glass-kiln", "guard-post");
  t.city(2, "artisans-row");
  f = borderFacts(t.st, 0, "left");
  assert.deepEqual([f.raw, f.goods], [1, 2], "West Road lays the bridge on the left only");
  assert.deepEqual([borderFacts(t.st, 0, "right").raw, borderFacts(t.st, 0, "right").goods], [2, 2]);
  assert.deepEqual(f.shields, { mine: shields(t.st, 0), theirs: shields(t.st, 1) });
  assert.ok(f.shields.mine >= 1 && f.shields.theirs >= 1);
  assert.deepEqual(f.sale, production(t.st, 1).sale);
  assert.ok(f.sale.some((u) => u.includes(4)), "their glass is for sale");
  // Artisans' Row puts up a stall on both of seat 2's borders.
  assert.deepEqual(["left", "right"].map((s) => borderFacts(t.st, 2, s).goods), [1, 1]);
  assert.deepEqual(["left", "right"].map((s) => borderFacts(t.st, 2, s).raw), [2, 2]);
  // Olympia B's first stage: raw at 1 from both neighbours.
  const o = table({ side: "B", wonders: [["olympia", "B"], ["giza"], ["babylon"]] });
  o.stages(0, 1);
  assert.deepEqual(["left", "right"].map((s) => borderFacts(o.st, 0, s).raw), [1, 1]);
});

test("warnWords: from turn 5 of an age, by how your shields compare", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  t.city(0, "palisade");
  t.city(1, "ramparts");
  for (const round of [1, 4]) {
    t.st.round = round;
    assert.equal(warnWords(t.st, 0, "left"), null);
  }
  t.st.round = 5;
  const gap = shields(t.st, 1) - shields(t.st, 0);
  assert.ok(gap > 0);
  assert.equal(warnWords(t.st, 0, "left"), `you trail by ${gap}`);
  assert.equal(warnWords(t.st, 1, "right"), `you lead by ${gap}`);
  assert.equal(warnWords(t.st, 1, "left"), `you lead by ${shields(t.st, 1)}`);
  t.st.city[2] = [];
  t.st.city[0] = [];
  assert.equal(warnWords(t.st, 0, "right"), "level");
  t.st.round = ROUNDS;
  assert.equal(borderFacts(t.st, 0, "left").warn, `you trail by ${shields(t.st, 1)}`);
  t.st.phase = "over";
  assert.equal(warnWords(t.st, 0, "left"), null);
});

test("flags read each age's result on each border back from the tokens", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  // As the rules' own military test leaves them: seat 0 beats its left and loses to its right each age.
  t.st.tokens = [[1, -1, 3, -1, 5, -1], [-1, -1, -1, -1, -1, -1], [1, 1, 3, 3, 5, 5]];
  t.st.phase = "over";
  assert.deepEqual(borderFlags(t.st, 0, "left"), [1, 1, 1]);
  assert.deepEqual(borderFlags(t.st, 0, "right"), [-1, -1, -1]);
  assert.deepEqual(borderFlags(t.st, 2, "left"), [1, 1, 1]);
  // Mid game: only finished ages have flags; a draw is 0.
  t.st.phase = "pick";
  t.st.age = 2;
  // Shields 1, 1 and 0: seats 0 and 1 draw, both beat seat 2.
  t.st.tokens = [[1], [1], [-1, -1]];
  assert.deepEqual(borderFlags(t.st, 0, "left"), [0, null, null]);
  assert.deepEqual(borderFlags(t.st, 0, "right"), [1, null, null]);
  assert.deepEqual(borderFlags(t.st, 1, "left"), [1, null, null]);
  assert.deepEqual(borderFlags(t.st, 1, "right"), [0, null, null]);
  assert.deepEqual(borderFlags(t.st, 2, "left"), [-1, null, null]);
  // Tokens no war could give read as nothing.
  t.st.tokens = [[1], [], [-1]];
  assert.deepEqual(borderFlags(t.st, 0, "right"), [null, null, null]);
  t.st.age = 1;
  assert.deepEqual(borderFlags(t.st, 0, "right"), [null, null, null], "age I still to come");
});

test("in random games at 3 to 7 seats the flags always match the war events", () => {
  let read = 0, all = 0;
  for (const players of [3, 4, 5, 6, 7]) {
    for (const seed of ["a", "b", "c"]) {
      const t = table({ players, seed: `border ${players} ${seed}` });
      const rng = rngFromSeed(`border ${players} ${seed}`);
      const wars = [];
      let steps = 0;
      while (t.st.winner === -1) {
        assert.ok(++steps < 100);
        for (const p of movers(t.st)) {
          const moves = legalMoves(t.st, p, t.deck.view(p));
          const build = moves.filter((m) => !("discard" in m));
          const list = build.length && rng() < 0.85 ? build : moves;
          const m = list[Math.floor(rng() * list.length)];
          for (const id of reveals(t.st, p, m)) t.deck.slots[id].open = true;
          t.rules.applyMove(t.st, p, m, t.deck);
        }
        for (const ev of settleAll(t.rules, t.st, t.deck).filter((e) => e.type === "war")) {
          wars.push(ev.results);
          const res = warResults(t.st);
          // Every result the tokens can tell is right; the events fill in any they can't.
          res[ev.age - 1].forEach((r, p) => r.forEach((x, k) => x === null || assert.equal(x, ev.results[p][k], `${players} seats, age ${ev.age}`)));
          read += res[ev.age - 1].flat().filter((x) => x !== null).length;
          all += players * 2;
          for (let p = 0; p < players; p++) {
            for (const [k, side] of [[0, "left"], [1, "right"]]) {
              assert.deepEqual(borderFlags(t.st, p, side, wars), [0, 1, 2].map((a) => (a < ev.age ? wars[a][p][k] : null)));
              assert.deepEqual(borderFacts(t.st, p, side, { wars }).flags, borderFlags(t.st, p, side, wars));
            }
          }
        }
      }
    }
  }
  assert.equal(all, 2 * 3 * 3 * (3 + 4 + 5 + 6 + 7));
  assert.ok(read / all > 0.95, "the tokens alone tell nearly every result");
});

test("tokens two wars could have left read as unknown until the war events say", () => {
  // Four seats: in ages I and II seats 1 and 3 lose everything, and the
  // tokens can't say on which side seats 0 and 2 drew.
  const t = table({ players: 4, wonders: [["rhodes"], ["giza"], ["babylon"], ["ephesus"]] });
  t.st.age = 3;
  t.st.tokens = [[1, 1, 3], [-1, -1, -1], [1, 3, 3], [-1, -1, -1]];
  const res = warResults(t.st);
  assert.ok(res.flat(2).includes(null));
  const wars = [
    [[1, 1], [-1, -1], [0, 1], [-1, 0]],
    [[0, 1], [-1, 0], [1, 1], [-1, -1]],
  ];
  for (const [a, e] of res.entries()) e.forEach((r, p) => r.forEach((x, k) => x === null || assert.equal(x, wars[a][p][k])));
  assert.deepEqual(borderFlags(t.st, 0, "left", wars), [1, 0, null]);
  assert.deepEqual(borderFacts(t.st, 0, "right", { wars }).flags, [1, 1, null]);
  // Seat 1 lost to seat 0 on its right in age I whichever war it was.
  assert.equal(res[0][1][1], -1);
});
