// The tips' words over real tables (a known deck, as in rules.test.js): every
// kind says something with the right numbers, and reads only what everyone
// may see plus your own cards. Also the legend's words and the hints' memory.
import test from "node:test";
import assert from "node:assert/strict";
import { KnownDeck, settleAll } from "../../test/fixtures/known-deck.js";
import { rngFromSeed } from "../engine/rng.js";
import { CARDS, WONDERS } from "./cards.js";
import { makeRules, deckOf, legalMoves, movers, canBuild, sideCoins, sciencePoints, purchases, ROUNDS } from "./rules.js";
import { viewOf, costWords as artCostWords } from "./art.js";
import { tipWords, TIP_KINDS, LEGEND, HINT_WORDS, HINTS_KEY, hints, argsOf, costWords } from "./tips.js";

const W = (key) => WONDERS.findIndex((w) => w.key === key);
const ID = (key) => CARDS.find((c) => c.key === key).id;
const NAMES = ["Ana", "Robot 1", "Robot 2", "Robot 3"];
const nameOf = (p) => NAMES[p];

// A dealt table with every face known; city(p, ...keys) replaces a seat's city.
function table({ players = 3, wonders, side = "A", seed = "tips" } = {}) {
  const rules = makeRules({ side }, players);
  const deck = new KnownDeck([...Array(rules.deckSize).keys()], seed);
  for (const s of deck.slots) s.open = true;
  const st = rules.newState(0, players, deck, rngFromSeed(seed));
  settleAll(rules, st, deck);
  if (wonders) st.wonders = wonders.map(([key, s = "A"]) => ({ w: W(key), side: s }));
  const slot = (id, owner) => deck.slots.push({ face: deckOf(players).indexOf(id), owner, open: true, gone: false, held: [] }) - 1;
  return {
    rules,
    deck,
    st,
    city: (p, ...keys) => (st.city[p] = keys.map((k) => ({ slot: slot(ID(k), p), id: ID(k) }))),
    stages: (p, n) => (st.stages[p] = Array.from({ length: n }, () => slot(CARDS[deckOf(players)[0]].id, p))),
  };
}
const say = (st, kind, args = {}, me = 0) => tipWords(kind, args, { state: viewOf(st), me, nameOf });
const text = (w) => [w.title, w.body, ...(w.more ?? [])].join(" ");
const clean = (w, where) => {
  assert.ok(w && w.title && w.body, `${where}: no words`);
  assert.doesNotMatch(text(w), /undefined|NaN|null|\[object|  |\.\.|^\s|\s$/, `${where}: ${text(w)}`);
};

// Every kind with the arguments the table gives it, for every seat.
function everyTip(st, me, players) {
  const out = [];
  const seats = [...Array(players).keys()];
  const ids = st.city.flat().map((x) => x.id);
  const hand = [ID("palisade"), ID("west-road"), ID("hot-springs"), ID("water-channel"), ID("olive-press"), ID("harbour"), ID("judges-guild"), ID("scholars-guild"), ID("caravan-yard"), ID("timber-mill")];
  for (const kind of TIP_KINDS) {
    const args = [];
    if (["coins", "shields", "tokens", "stages", "sells", "counts", "seat", "science", "score", "wall"].includes(kind)) args.push(...seats.map((p) => ({ seat: String(p) })));
    else if (kind === "card") args.push(...ids.flatMap((id) => seats.map((p) => ({ id: String(id), seat: String(p) }))), ...hand.map((id) => ({ id: String(id), where: "hand" })), { id: "-1" });
    else if (kind === "badge") args.push(...hand.map((id) => ({ id: String(id) })), {});
    else if (kind === "back") args.push({}, { where: "pick", seat: "1" }, { where: "stack", seat: "2", count: "5" }, { where: "tucked", seat: "1" });
    else if (kind === "slot") args.push(...seats.flatMap((p) => [0, 1, 2, 3].map((n) => ({ seat: String(p), stage: String(n) }))));
    else if (kind === "either") args.push({ res: "0,2", seat: "0" }, { res: "0,2", seat: "1", source: "Riverside Grove" });
    else if (["price", "crossing", "flags", "warn"].includes(kind)) args.push(...seats.map((p) => ({ seat: String(p), res: "3", results: "1,-1," })), { side: "right" });
    else if (kind === "make") args.push(...seats.flatMap((p) => [0, 1, 2, 3, 4, 5, 6].map((r) => ({ seat: String(p), res: String(r) }))));
    else args.push({});
    for (const a of args) out.push([kind, a, tipWords(kind, a, { state: viewOf(st), me, nameOf })]);
  }
  return out;
}

test("every kind the spec names has words", () => {
  for (const kind of ["coins", "shields", "tokens", "stages", "sells", "counts", "card", "back", "slot", "either", "price", "crossing", "flags", "warn", "seat", "direction", "turn", "bank", "discard", "badge", "science", "score", "wall"]) assert.ok(TIP_KINDS.includes(kind), kind);
  const t = table();
  assert.equal(say(t.st, "nonsense"), null);
  assert.equal(tipWords("coins", {}, null), null);
});

test("the mock-up's panel: shields, stages, sells, counts and a card, in its words with live numbers", () => {
  const t = table({ wonders: [["rhodes"], ["ephesus"], ["giza"]] });
  t.st.age = 2;
  t.city(1, "woodcutters-camp", "stone-cut", "clay-bank", "ore-seam", "reed-press", "west-road", "palisade", "ramparts", "copy-house");
  t.city(0, "watchtower", "guard-post");
  t.stages(1, 2);
  t.st.coins[1] = 4;
  assert.deepEqual(say(t.st, "shields", { seat: 1 }), { title: "Shields", body: "Robot 1 has 3 and you have 2. If the age ended now you would lose this border and take a −1 token." });
  assert.equal(say(t.st, "stages", { seat: 1 }).body, "Robot 1 has built 2 of 3. The next one costs 2 papyrus and is worth 7 points.");
  assert.equal(say(t.st, "counts", { seat: 1 }).body, "4 brown, 1 grey, 1 yellow, 2 red and 1 green. Tap to open Robot 1's whole city.");
  assert.equal(say(t.st, "coins", { seat: 1 }).body, "Robot 1 has 4. Every 3 coins are worth 1 point at the end. Coins you pay them arrive when the turn ends.");
  assert.deepEqual(say(t.st, "sells", { seat: 1 }), { title: "For sale to you", body: "2 papyrus, wood, stone, clay and ore: what Robot 1's brown and grey cards and wonder make. 2 coins a unit. Buying doesn't use them up." });
  // Robot 1's West Road buys from their left neighbour, seat 2, not from you.
  const road = say(t.st, "card", { id: ID("west-road"), seat: 1 });
  assert.equal(road.title, "West Road");
  assert.equal(road.body, "Robot 1 buys wood, stone, clay and ore from their left neighbour for 1 coin. It does nothing for you.");
  assert.equal(road.card, ID("west-road"));
  assert.match(road.more[0], /^West Road, age I yellow card\./);
  assert.match(road.more[0], /Makes Agora free\.$/);
  assert.equal(road.more.length, 1);
  // The same card on your right neighbour's side does touch you: their left is you.
  t.city(2, "west-road");
  assert.match(say(t.st, "card", { id: ID("west-road"), seat: 2 }).body, /That's you: they pay you 1 coin a unit instead of 2\./);
  // A tie, and a win in age II worth +3.
  t.city(0, "watchtower", "guard-post", "palisade");
  assert.match(say(t.st, "shields", { seat: 1 }).body, /draw this border and take no token/);
  t.city(0, "watchtower", "guard-post", "ramparts");
  assert.match(say(t.st, "shields", { seat: 1 }).body, /win this border and take a \+3 token/);
  assert.equal(say(t.st, "shields").body, "You have 4: Robot 1 has 3 and Robot 2 has 0. If the age ended now you would beat Robot 1 (+3) and beat Robot 2 (+3).");
});

test("prices follow your trade cards: a road on one side, Artisans' Row for goods", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["ephesus"]] });
  t.city(0, "west-road");
  // Left (seat 1, Giza) sells stone at 1 thanks to the road; right (seat 2, Ephesus) papyrus at 2.
  assert.match(say(t.st, "sells", { seat: 1 }).body, /^Stone: .* 1 coin a unit, thanks to your West Road\./);
  assert.match(say(t.st, "sells", { seat: 2 }).body, /^Papyrus: .* 2 coins a unit\./);
  assert.match(say(t.st, "price", { seat: 1, res: 1 }).body, /^Stone from Robot 1 costs you 1 coin a unit thanks to your West Road\./);
  assert.equal(say(t.st, "price", { seat: 2, res: 6 }).title, "2 coins each");
  assert.equal(say(t.st, "crossing", { seat: 1 }).title, "The bridge");
  assert.match(say(t.st, "crossing", { seat: 2 }).body, /a ferry carries what you buy, at 2 coins a unit; East Road would build a bridge/);
  t.city(0, "west-road", "artisans-row");
  t.city(1, "stone-cut", "glass-kiln");
  assert.match(say(t.st, "sells", { seat: 1 }).body, /^2 stone and glass: /);
  // Stone is cheap through the road, glass through Artisans' Row: each card is credited.
  assert.match(say(t.st, "sells", { seat: 1 }).body, /1 coin a unit, thanks to your West Road and your Artisans' Row\./);
  assert.match(say(t.st, "price", { seat: 1, res: 4 }).body, /costs you 1 coin a unit thanks to your Artisans' Row\./);
  t.city(0, "artisans-row");
  assert.match(say(t.st, "sells", { seat: 1 }).body, /1 coin for glass \(your Artisans' Row\) and 2 for stone\./);
  assert.match(say(t.st, "price", { seat: 2 }).body, /1 coin for glass, cloth and papyrus \(your Artisans' Row\) and 2 for wood, stone, clay and ore/);
  assert.match(say(t.st, "crossing", { seat: 2 }).body, /Your Artisans' Row set up the market stall/);
});

test("your hand: badges with the coins they cost, chains, and what a card would do for you", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["ephesus"]] });
  t.st.age = 2;
  t.st.coins[0] = 5;
  t.city(0, "hot-springs", "herbalist", "tinkers-shed");
  t.city(1, "woodcutters-camp");
  // Water Channel chains from Hot Springs.
  assert.deepEqual(say(t.st, "badge", { id: ID("water-channel") }), { title: "Chain · free", body: "Your Hot Springs chains to it, so you build it without paying anything." });
  assert.match(say(t.st, "card", { id: ID("water-channel"), where: "hand" }).more[1], /You have Hot Springs, so you build it free\./);
  // Bronze Figure: 2 ore (yours: Rhodes makes 1) and wood: buy 1 ore? Nobody sells ore but you; check the rules' cheapest price.
  for (const key of ["bronze-figure", "ramparts", "palisade", "sanctuary", "copy-house"]) {
    const id = ID(key);
    const b = canBuild(viewOf(t.st), 0, id);
    const w = say(t.st, "badge", { id });
    clean(w, key);
    if (b.ok && b.purchases.length) {
      const paid = sideCoins(viewOf(t.st), 0, b.purchases[0]);
      const total = CARDS[id].cost.coins + paid.left + paid.right;
      if (total) assert.equal(w.title, `${total} coin${total === 1 ? "" : "s"}`, key);
    } else assert.equal(w.title, "Can't build", key);
  }
  // Palisade costs 1 wood, sold by Robot 1 (left) at 2.
  assert.deepEqual(say(t.st, "badge", { id: ID("palisade") }), { title: "2 coins", body: "Building it costs you 2 coins: 2 to Robot 1 for 1 wood." });
  t.city(0, "hot-springs", "herbalist", "tinkers-shed", "palisade");
  assert.equal(say(t.st, "badge", { id: ID("palisade") }).body, "You already built Palisade, and a city holds only one of each.");
  // A quill would complete a set: 2 now, 10 after.
  assert.equal(say(t.st, "card", { id: ID("copy-house"), where: "hand" }).body, "A quill for your science: it would go from 2 to 10 points.");
  assert.equal(say(t.st, "science").body, `You have 1 star, 1 cog and 0 quills: 2 points now. The next quill adds ${sciencePoints([1, 1, 1]) - 2}, completing another set of three. Each symbol scores its count squared, and each set of all three 7 more.`);
  // A red card would put you level with the left neighbour.
  t.city(1, "woodcutters-camp", "ramparts");
  assert.equal(say(t.st, "card", { id: ID("ramparts"), where: "hand" }).body, "+2: you'd have 3 shields to Robot 1's 2 and Robot 2's 0.");
  // Income counts the cities as they stand, the card itself included when it counts its own kind.
  t.city(1, "woodcutters-camp", "stone-cut");
  t.city(2, "clay-bank");
  assert.equal(say(t.st, "card", { id: ID("olive-press"), where: "hand" }).body, "Pays you 3 coins now: 3 brown cards in your city and your neighbours'.");
  t.st.age = 3;
  t.city(0, "ore-seam", "agora");
  assert.equal(say(t.st, "card", { id: ID("harbour"), where: "hand" }).body, "Pays you 1 coin now and scores 1 point at the end as things stand: 1 brown card in your city.");
  assert.equal(say(t.st, "card", { id: ID("judges-guild"), where: "hand" }).body, "Scores 0 points at the end as things stand: 0 blue cards in your neighbours' cities.");
});

test("seats, direction, turn, tokens, flags and warnings say who and how many", () => {
  const t = table({ players: 4, wonders: [["rhodes"], ["giza"], ["ephesus"], ["babylon"]] });
  assert.equal(say(t.st, "seat", { seat: 1 }).title, "Your left neighbour");
  assert.match(say(t.st, "seat", { seat: 1 }).body, /In ages I and III your hand goes to them; in age II theirs comes to you\./);
  assert.equal(say(t.st, "seat", { seat: 3 }).title, "Your right neighbour");
  assert.match(say(t.st, "seat", { seat: 2 }).body, /^Across the table: not your neighbour/);
  assert.equal(say(t.st, "direction", { age: 2 }).title, "Age II: hands go right");
  assert.match(say(t.st, "direction", { age: 1 }).body, /^After each turn your leftover cards go to Robot 1 and Robot 3's come to you\./);
  t.st.age = 2;
  t.st.round = 3;
  assert.deepEqual(say(t.st, "turn"), { title: "Age II · turn 3 of 6", body: "3 more turns after this one, then war with your neighbours and age III." });
  t.st.round = ROUNDS;
  assert.match(say(t.st, "turn").body, /^The last turn of the age/);
  t.st.tokens[1] = [1, -1, 3];
  assert.equal(say(t.st, "tokens", { seat: 1 }).body, "Robot 1 won 1 point in age I and 3 points in age II, and lost once (−1). Tokens add up to +3 on the score sheet.");
  t.st.tokens[0] = [];
  assert.match(say(t.st, "tokens").body, /^You have no war tokens yet\. .* wins 3 points and fewer loses 1\./);
  assert.equal(say(t.st, "flags", { seat: 1, results: "1,-1," }).body, "Your wars with Robot 1: won age I (+1), lost age II (−1) and age III still to come. A raised gold flag is a win, a torn red one at half-mast a loss, a striped one a draw, and a faint one on a dotted pole still to come.");
  assert.match(say(t.st, "flags", { seat: 1, results: "0" }).body, /: drew age I and ages II and III still to come\./);
  t.city(1, "ramparts");
  assert.deepEqual(say(t.st, "warn", { seat: 1 }), { title: "You trail by 2", body: "Robot 1 has 2 shields and you have 0. You need 3 more shields before the age ends to win +3, or 2 to draw; otherwise you take −1." });
  t.city(0, "ramparts", "palisade");
  assert.equal(say(t.st, "warn", { seat: 1 }).title, "You lead by 1");
  t.st.discard = [1, 2, 3, 4, 5];
  assert.match(say(t.st, "discard").body, /^5 cards face down/);
  assert.match(say(t.st, "back", { where: "stack", seat: 2, count: 4 }).body, /^4 cards, face down\. After this turn the last card is discarded\./);
  t.st.round = 2;
  assert.equal(say(t.st, "back", { where: "stack", seat: 2, count: 4 }).body, "4 cards, face down. After this turn they go to Robot 1.");
  assert.equal(say(t.st, "hand", { count: 5 }).body, "5 cards: Robot 1's leftovers. Pick one; the rest go to Robot 3.");
});

test("coins, score, walls, stage slots and what you make", () => {
  const t = table({ wonders: [["ephesus"], ["rhodes"], ["giza"]] });
  t.st.coins[0] = 7;
  assert.equal(say(t.st, "coins").body, "You have 7, worth 2 points at the end (1 for every 3); 2 more make another. Card prices go to the bank and purchases to your neighbours.");
  t.st.coins[0] = 2;
  assert.match(say(t.st, "coins").body, /^You have 2, worth 0 points at the end \(1 for every 3\); 1 more makes your first\./);
  t.st.coins[0] = 7;
  t.city(0, "shrine", "reed-press", "riverside-grove", "palisade");
  t.stages(0, 1);
  assert.equal(say(t.st, "score").body, "If the game ended now you would have 7 points: 2 from coins, 3 from the wonder and 2 civic.");
  assert.equal(say(t.st, "wall").body, "1 shield, from Palisade.");
  // Stage II needs 2 wood: the grove makes one, and nobody next door sells wood.
  assert.equal(say(t.st, "slot", { seat: 0, stage: 1 }).body, "It costs 2 wood and pays 9 coins at once. You can't pay for it yet.");
  assert.equal(say(t.st, "slot", { seat: 0, stage: 2 }).body, "It costs 2 papyrus and is worth 7 points. Build stage II first.");
  assert.equal(say(t.st, "slot", { seat: 0, stage: 0 }).body, "Built: it is worth 3 points. A card is tucked face down under it.");
  assert.equal(say(t.st, "make", { res: 0 }).body, "None for sure, but 1 either token can make it. Neither neighbour sells it.");
  t.city(0, "shrine", "reed-press", "riverside-grove", "palisade", "woodcutters-camp");
  assert.equal(say(t.st, "slot", { seat: 0, stage: 1 }).body, "It costs 2 wood and pays 9 coins at once. You can build it now by tucking a card from your hand.");
  assert.equal(say(t.st, "make", { res: 6 }).body, "You make 2 a turn: your wonder and Reed Press.");
  assert.equal(say(t.st, "make", { res: 0 }).body, "You make 1 a turn: Woodcutter's Camp. 1 either token can make one more.");
  assert.equal(say(t.st, "make", { res: 3 }).body, "You don't make ore. Robot 1 sells it for 2 coins.");
  assert.equal(say(t.st, "make", { res: 3, seat: 1 }).body, "Robot 1 makes 1 a turn: their wonder. You can buy one a turn for 2 coins.");
  assert.equal(say(t.st, "either", { res: "0,2" }).body, "Makes wood or clay, one a turn, from your Riverside Grove. You choose which each time you pay.");
});

test("a neighbour's Timber Mill sells both its wood in one turn, as rules.purchases allows", () => {
  const t = table({ wonders: [["ephesus"], ["rhodes"], ["giza"]] });
  t.city(1, "timber-mill");
  assert.equal(say(t.st, "make", { res: 0, seat: 1 }).body, "Robot 1 makes 2 a turn: Timber Mill (2). You can buy up to 2 a turn for 2 coins each.");
  assert.equal(purchases(viewOf(t.st), 0, [2, 0, 0, 0, 0, 0, 0]).some((b) => b.left[0] === 2), true, "both wood from the left in one turn");
  assert.equal(say(t.st, "make", { res: 3, seat: 1 }).body, "Robot 1 makes 1 a turn: their wonder. You can buy one a turn for 2 coins.");
  assert.equal(say(t.st, "make", { res: 0, seat: 2 }).body, "Robot 2 doesn't make wood.");
});

test("one shield, one point: live numbers in the singular", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["ephesus"]] });
  t.city(1, "palisade");
  assert.equal(say(t.st, "warn", { seat: 1 }).body.split(".")[0], "Robot 1 has 1 shield and you have 0");
  assert.match(say(t.st, "card", { id: ID("palisade"), where: "hand" }).body, /^\+1: you'd have 1 shield to Robot 1's 1 and Robot 2's 0\.$/);
  t.st.age = 1;
  assert.match(say(t.st, "tokens").body, /wins 1 point and fewer loses 1\./);
});

test("Babylon B with stage II plays its seventh card: no tip says it is discarded", () => {
  const t = table({ wonders: [["babylon", "B"], ["giza"], ["ephesus"]] });
  t.st.age = 1;
  t.st.round = ROUNDS;
  t.stages(0, 2);
  t.st.hands[0] = t.st.hands[0].slice(0, 2);
  assert.equal(say(t.st, "turn").body, "The last turn of the age: your wonder lets you play your seventh card too, then war with your neighbours.");
  assert.equal(say(t.st, "hand", { count: 2 }).body, "2 cards: Robot 2's leftovers. Pick one; your wonder lets you play the other one too.");
  assert.equal(say(t.st, "back", { where: "stack", seat: 0, count: 2 }).body, "2 cards, face down. Your wonder plays the last card instead of discarding it.");
  assert.equal(say(t.st, "back", { where: "stack", seat: 0, count: 2 }, 1).body, "2 cards, face down. Their wonder plays the last card instead of discarding it.");
  assert.equal(say(t.st, "back", { where: "stack", seat: 1, count: 2 }).body, "2 cards, face down. After this turn the last card is discarded.");
  t.st.phase = "last";
  t.st.lastSeat = 0;
  assert.equal(say(t.st, "hand", { count: 1 }).title, "Your seventh card");
  // Without the stage, the seventh card goes.
  t.stages(0, 1);
  t.st.phase = "pick";
  assert.match(say(t.st, "turn").body, /your seventh card is discarded/);
  assert.equal(say(t.st, "hand", { count: 2 }).body, "2 cards: Robot 2's leftovers. Pick one; the other is discarded.");
});

test("digging the discards: the Free badge says the dig builds it free, never a price", () => {
  const t = table({ wonders: [["halicarnassus"], ["giza"], ["ephesus"]] });
  t.stages(0, 2);
  t.st.coins[0] = 0;
  const ramparts = ID("ramparts");
  assert.equal(say(t.st, "badge", { id: ramparts }).title, "Can't build");
  assert.deepEqual(say(t.st, "badge", { id: ramparts, kind: "free", where: "dig" }), { title: "Free from the discards", body: "Your wonder lets you build one card from the discard pile without paying anything, Ramparts included." });
  t.city(0, "ramparts");
  assert.equal(say(t.st, "badge", { id: ramparts, kind: "no", where: "dig" }).body, "You already built Ramparts, and a city holds only one of each.");
  assert.equal(say(t.st, "card", { id: ID("water-channel"), where: "dig" }).more.length, 1, "no chain sentence while the card is free anyway");
});

test("every kind over whole games at 3 and 4 seats: plain words, no undefined or NaN", () => {
  for (const players of [3, 4]) {
    const rules = makeRules({ side: players === 3 ? "B" : "A" }, players);
    const deck = new KnownDeck([...Array(rules.deckSize).keys()], `game${players}`);
    const st = rules.newState(0, players, deck, rngFromSeed(`game${players}`));
    settleAll(rules, st, deck);
    const rng = rngFromSeed(`moves${players}`);
    let checks = 0;
    for (let step = 0; st.winner === -1 && step < 200; step++) {
      if (step % 4 === 0) {
        for (const me of [0, players - 1]) for (const [kind, a, w] of everyTip(st, me, players)) {
          if (w === null && kind === "make") continue;
          clean(w, `${kind} ${JSON.stringify(a)} age ${st.age} round ${st.round}`);
          checks++;
        }
      }
      for (const p of movers(st)) {
        const moves = legalMoves(st, p, deck.view(p));
        const m = moves[Math.floor(rng() * moves.length)];
        for (const id of rules.reveals(st, p, m)) deck.slots[id].open = true;
        rules.applyMove(st, p, m, deck);
      }
      settleAll(rules, st, deck);
    }
    assert.notEqual(st.winner, -1);
    for (const [kind, a, w] of everyTip(st, 0, players)) if (w) clean(w, `end ${kind} ${JSON.stringify(a)}`);
    assert.ok(checks > 1000);
  }
});

// The public state behind a proxy that throws on anything hidden: picks, the
// face-up piles and pool, which slots are in a hand or the discard pile.
function guarded(view) {
  const lengthOnly = (xs) => new Proxy(xs, { get: (o, k) => (k === "length" ? o.length : k === Symbol.iterator || /^\d+$/.test(String(k)) || typeof o[k] === "function" ? assert.fail(`read a hidden slot (${String(k)})`) : o[k]) });
  const v = { ...view, hands: view.hands.map(lengthOnly), discard: lengthOnly(view.discard) };
  return new Proxy(v, { get: (o, k) => (["picks", "pool", "piles"].includes(k) ? assert.fail(`read ${k}`) : o[k]) });
}

test("hidden information: tips read hand sizes and the pile's size, never a hidden slot, a pick or the pool", () => {
  const t = table({ players: 4, wonders: [["rhodes"], ["giza"], ["ephesus"], ["babylon"]] });
  t.city(0, "palisade", "west-road", "herbalist");
  t.city(1, "ramparts", "stone-cut", "glass-kiln");
  t.st.discard = [3, 4, 5];
  t.st.picks = [{ build: 1 }, { discard: 2 }, null, null];
  for (const [kind, a] of everyTip(t.st, 0, 4)) {
    const w = tipWords(kind, a, { state: guarded(viewOf(t.st)), me: 0, nameOf });
    if (w || kind !== "make") clean(w, kind);
  }
  // Different hidden cards give the same words.
  const a = viewOf(t.st);
  const b = viewOf(t.st);
  b.hands = b.hands.map((h) => h.map((s) => s + 1000));
  b.discard = b.discard.map((s) => s + 1000);
  const words = (v) => everyTip(t.st, 0, 4).map(([kind, args]) => JSON.stringify(tipWords(kind, args, { state: v, me: 0, nameOf })));
  assert.deepEqual(words(a), words(b));
});

test("costs are said as the rest of the game says them", () => {
  for (const c of CARDS) assert.equal(costWords(c.cost), artCostWords(c.cost), c.key);
  for (const w of WONDERS) for (const s of Object.values(w.sides)) for (const x of s) assert.equal(costWords(x.cost), artCostWords(x.cost));
});

test("the legend: every icon has a name and a sentence", () => {
  const names = new Set();
  for (const g of LEGEND) {
    assert.ok(g.title && g.items.length);
    for (const it of g.items) {
      assert.ok(Array.isArray(it.icon) && it.name && it.text, JSON.stringify(it));
      assert.doesNotMatch(`${it.name} ${it.text}`, /undefined|NaN/);
      assert.match(it.text, /\.$/);
      names.add(it.name);
    }
  }
  for (const n of ["Wood", "Papyrus", "Coins", "Shields", "Victory token", "Defeat token", "Star", "Any symbol", "Purple", "Chain · free", "Can't build", "Ferry", "Bridge", "Market stall", "Flags"]) assert.ok(names.has(n), n);
  for (const [id, words] of Object.entries(HINT_WORDS)) assert.match(words, /^[A-Z][^.]*\.$/, id);
});

test("hints: once ever per id, under ddp-stonecrown-hints, and safe when storage throws or is missing", () => {
  assert.equal(HINTS_KEY, "ddp-stonecrown-hints");
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
  const h = hints(undefined, storage);
  assert.equal(h.seen("buy"), false);
  h.mark("buy");
  h.mark("buy");
  assert.equal(h.seen("buy"), true);
  assert.deepEqual(JSON.parse(data.get("ddp-stonecrown-hints")), ["buy"]);
  assert.equal(hints(undefined, storage).seen("buy"), true, "remembered across visits");
  assert.equal(hints(undefined, storage).seen("war"), false);
  data.set("ddp-stonecrown-hints", "{not json");
  assert.equal(hints(undefined, storage).seen("buy"), false);
  hints(undefined, storage).mark("war");
  assert.deepEqual(JSON.parse(data.get("ddp-stonecrown-hints")), ["war"]);
  const broken = { getItem: () => assert.fail("blocked") && null, setItem: () => assert.fail("full") };
  const b = hints("k", broken);
  assert.equal(b.seen("pass"), false);
  assert.doesNotThrow(() => b.mark("pass"));
  assert.equal(b.seen("pass"), true, "still once a visit");
  const none = hints();
  assert.equal(none.seen("chain"), false);
  assert.doesNotThrow(() => none.mark("chain"));
  assert.equal(none.seen("chain"), true);
});

test("argsOf reads data-tip-* and nothing else", () => {
  assert.deepEqual(argsOf({ dataset: { tip: "card", tipId: "12", tipSeat: "1", tipWhere: "hand", seat: "9" } }), { id: "12", seat: "1", where: "hand" });
  assert.deepEqual(argsOf(null), {});
});
