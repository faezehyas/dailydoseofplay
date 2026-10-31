// Hexlands page: mounts the engine shell and renders a CardMatch. The rules
// live in rules.js, the art in tiles.js, pieces.js and card-art.js, and the
// table they make (the island, the dice, the bank, your hand and their
// motion) in art.js, which the tutorial shares. This file is the view: whose
// decision it is and the controls for it (placing, rolling, building,
// trading, the robber, discards and development cards), the players' bar,
// the log, the clock and the result. The match state never waits for the
// screen: every event is queued and played out in order, faster when they
// pile up, and at once with reduced motion or a hidden tab.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { CardMatch } from "../engine/card-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar, thinkingDots } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { cardTable } from "../engine/cards/table.js";
import { humanPause } from "../engine/cards/paced-robot.js";
import { robotPause } from "../engine/robot-pace.js";
import { leaveNotice, abortText, verdictText as verdictOf } from "../engine/cards/leave-notice.js";
import { HEXES, CORNERS, EDGES, RESOURCES, DESERT } from "./board.js";
import { roadSvg, settlementSvg, citySvg, robberSvg } from "./pieces.js";
import { makeRules, normalizeConfig, forcedMove, COSTS, resourceOf, devKind, counts, payment, legalCorners, legalEdges, legalCities, robberHexes, victims, tradeRate, points, discardCount, playable, MAX_OFFERS, MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";
import { PACE, RES_NAMES, DEV_NAMES, plural, listOf, countWords, hexWords, cornerWords, edgeWords, glyphEl, cardEl, cardsRow, production, hexTable } from "./art.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";

// How long robots take before each move (robotPause() scales these in tests).
const ROBOT_PACE = { settle: 1500, road: 750, roll: 650, discard: 1500, robber: 1300, build: 900, trade: 1300, end: 750, answer: 1200, partner: 1000, give: 420, max: 2600 };
// Your browser's own moves nobody chooses, after a short beat.
const AUTO_MS = 600;
// Turning down an offer you can't pay takes as long as a person's answer: an
// instant one would tell the others about cards they can't see.
const DECLINE_MS = [1200, 3000];
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const BUILD_NAMES = { road: "road", settlement: "settlement", city: "city" };
// Robot games: robots wait for the screen to finish replaying. The view sets this.
let screenBusy = () => false;
const sum = (c) => c.reduce((a, b) => a + b, 0);
const zero = () => [0, 0, 0, 0, 0];

function robotDelay(st, move) {
  return humanPause(screenBusy, () => {
    const think = Math.random() * 500;
    if (move?.give) return ROBOT_PACE.give;
    if (move?.settle !== undefined && st.phase === "setup") return ROBOT_PACE.settle + think;
    if (st.phase === "setup") return ROBOT_PACE.road + think;
    if (move?.roll) return ROBOT_PACE.roll + think;
    if (move?.end) return ROBOT_PACE.end + think;
    if (move?.offer || move?.bank) return ROBOT_PACE.trade + think;
    return Math.min(ROBOT_PACE.max, (ROBOT_PACE[st.phase] ?? ROBOT_PACE.build) + think);
  });
}

startGameShell({
  slug: "hexlands",
  title: "Hexlands",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "wide",
  settings,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createRobot: (session) => {
    const config = settings.get();
    return startRobot(session, {
      rules: makeRules(config, session.players.length),
      choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: config.level }),
      delay: (st, me, move) => robotDelay(st, move),
    });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const seats = session.players.map((p) => p.seat);
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  // "You build", "Bo builds"
  const verb = (p, s) => (p !== me ? s : /(ss|sh|ch|o)es$/.test(s) ? s.slice(0, -2) : s.replace(/s$/, ""));
  const your = (p) => (p === me ? "your" : `${session.players[p].name}'s`);
  const robotGame = session.mode === "robot";
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let destroyed = false;
  let ended = false;
  let current = null; // the event being played out
  let view = null; // the table as drawn
  let log = [];
  let cuedTurn = "";
  let autoKey = "";
  let autoTimer = null;
  let deadline = 0;
  let deadlineKey = "";
  let timedOut = "";
  let lastTick = 0;
  let previous = null; // the match before a rematch, whose verdict may still be on its way
  let lastVerdict = "";
  let finalPoints = null;
  let lastSettlement = seats.map(() => -1);
  // Your choices on the way to a move.
  let mode = null; // in your main phase: null, "road", "settlement", "city", "trade", "plenty" or "monopoly"
  let tradeTab = "bank";
  let robberPick = null; // a hex picked for the robber, while you choose whom to rob
  let pick = { discard: zero(), give: zero(), want: zero(), plenty: zero(), bankGive: -1, bankTake: -1 };
  let devSlot = null; // the development card being played
  let spotInfo = null; // the spot pointed at, for the placement guidance
  let fresh = zero(); // cards you just gained, lit up in your hand
  let robbed = -1; // whom the robber stole from this turn
  let mySnapshot = null; // your hand's counts before a steal, to tell what was taken

  const table = cardTable({ prefix: "hx", play, animate: (ev, g) => animate(ev, g), done: (idle) => replayed(idle) });
  const { live, fast, wait } = table;
  const faceOf = (slot) => match?.face(slot) ?? null;

  // "setup" is for this view (only from the room's creator); the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  const notes = seats.map((p) => el("span", { class: "hx-note" }));
  bar.update({ badges: seats.map(() => el("span", { class: "dot", "aria-hidden": "true" })), notes });
  const pillOf = (p) => bar.node.querySelector(`.pb-who.p-${p}`);
  const status = el("p", { class: table.cls("status"), id: "hx-status", role: "status", "aria-live": "polite", tabindex: "-1" });

  const art = hexTable(table, {
    onSpot: (kind, id) => chooseSpot(kind, id),
    onSpotFocus: (kind, id) => {
      spotInfo = kind ? { kind, id } : null;
      renderActions();
    },
  });
  const rectOf = (node) => (node ? table.rectIn(node) : null);
  const seatRect = (p) => (p === me ? rectOf(art.handBox) : rectOf(pillOf(p)));
  const resRect = (p, r) => (p === me && r >= 0 ? art.pileRect(r) : seatRect(p));
  const devRect = (p) => (p === me ? rectOf(art.handBox.querySelector(".hx-dev-row:not([hidden])") ?? art.handBox) : seatRect(p));
  const bankRect = (r) => art.bankChipRect(r);

  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "hx-timer", id: "hx-timer", hidden: true, role: "timer", "aria-label": "Time for the move" }, el("span", { class: "bar" }, timerFill), timerText);
  const panel = el("div", { class: "hx-panel", id: "hx-panel" });
  const actions = el("section", { class: "hx-actions", id: "hx-actions", "aria-label": "Your move" }, timer, panel);
  const logList = el("ol", { class: table.cls("log"), id: "hx-log", role: "log", "aria-label": "What happened" });
  const logBox = el("section", { class: "hx-log-box", "aria-label": "Game log" }, el("h2", { class: "hx-side-title" }, "What happened"), logList);
  const configLine = el("p", { class: table.cls("config"), id: "hx-config" });
  const note = el("p", { class: table.cls("note"), id: "hx-note" });
  const handBox = el("section", { class: "hx-hand-box", "aria-label": "Your cards" }, art.handBox);

  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    classes: (p) => `p-${p}`,
    // The result moment: the winner's buildings light up one by one; a loss dims the island.
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "wood", highlight: winnerNodes(), board: art.boardWrap }),
  });

  const rootBox = el(
    "div",
    { class: "hexlands pc-game", dataset: { you: me === 0 ? "a" : me === 1 ? "b" : "", seat: me } },
    bar.node,
    status,
    el("div", { class: "hx-main" }, el("div", { class: "hx-board-col" }, art.boardWrap), art.bankBox, actions, handBox, logBox),
    configLine,
    note,
    result.node,
    table.flyLayer,
  );
  root.append(rootBox);

  // ---------- the table as drawn ----------
  const viewFromState = (st) => ({
    buildings: st.buildings.map((b) => b && { ...b }),
    roads: st.roads.slice(),
    robber: st.robber,
    hands: st.hands.map((h) => h.slice()),
    devs: st.devs.map((d) => d.slice()),
    knights: st.knights.slice(),
    shown: st.shown.map((s) => s.slice()),
    longest: { ...st.longest },
    army: { ...st.army },
    bank: st.bank.map((b) => b.length),
    devPile: st.devPile.length,
    dice: st.dice ? st.dice.slice() : null,
  });
  // Points showing on the table: buildings, the two awards and point cards shown.
  function shownPoints(v, p) {
    let n = 0;
    for (const b of v.buildings) if (b?.p === p) n += b.city ? 2 : 1;
    if (v.longest.p === p) n += 2;
    if (v.army.p === p) n += 2;
    return n + v.shown[p].filter((f) => devKind(f) === "vp").length;
  }
  const hiddenPoints = (slots) => slots.filter((s) => devKind(faceOf(s)) === "vp").length;
  const myCounts = (slots = view?.hands[me] ?? []) => counts(slots, faceOf);

  // ---------- whose decision it is ----------
  function decision() {
    if (!match?.state || match.phase !== "playing" || table.pending || ended) return null;
    const st = match.state;
    const movers = match.step ? match.step.movers.filter((p) => !match.step.commits[p]) : [st.turn];
    return { phase: st.phase, movers, step: !!match.step };
  }
  const mine = (d = decision()) => !!d && d.movers.includes(me);
  // Your real choice now (the phase), or null: not yours, or a move made for you.
  function myChoice() {
    const d = decision();
    return mine(d) && match.canMove() && !autoMoveFor() ? d.phase : null;
  }
  // A move nobody chooses: the rules' forced move, showing point cards to win, or calling off an offer nobody took.
  function autoMoveFor() {
    const st = match.state;
    const forced = forcedMove(st, me, faceOf);
    if (forced) return forced;
    if (!match.step && st.turn === me && (st.phase === "main" || st.phase === "roll")) {
      const vp = st.devs[me].filter((s) => devKind(faceOf(s)) === "vp");
      const need = st.target - points(st, me);
      if (vp.length && need > 0 && vp.length >= need) return { claim: vp.slice(0, need) };
    }
    if (st.phase === "partner" && st.turn === me && st.trade && !seats.some((p) => Array.isArray(st.trade.answers[p]))) return { partner: -1 };
    return null;
  }

  // ---------- motion ----------
  const enqueue = (ev) => table.enqueue(ev);
  function replayed(idle) {
    if (idle) {
      current = null;
      if (match?.state) view = viewFromState(match.state);
      for (const robot of window.ddp.robots || []) robot.poke?.();
    }
    render();
  }

  // Cards with faces (open to all) fly; with null faces, backs fly.
  const keysOf = (slots) => slots.map((s) => {
    const r = resourceOf(faceOf(s));
    return r === null || r < 0 ? "back" : r;
  });
  const removeSlots = (p, slots) => (view.hands[p] = view.hands[p].filter((s) => !slots.includes(s)));
  const toBank = (slots) => slots.forEach((s) => {
    const r = resourceOf(faceOf(s));
    if (r >= 0) view.bank[r]++;
  });
  const fromBank = (slots) => slots.forEach((s) => {
    const r = resourceOf(faceOf(s));
    if (r >= 0) view.bank[r] = Math.max(0, view.bank[r] - 1);
  });
  const gainFresh = (p, slots) => {
    if (p !== me) return;
    for (const s of slots) {
      const r = resourceOf(faceOf(s));
      if (r >= 0) fresh[r]++;
    }
  };
  // Cards paid from p's hand go to the bank.
  async function spend(p, slots, g, k) {
    if (!slots?.length) return;
    const keys = keysOf(slots);
    removeSlots(p, slots);
    render();
    await art.flyMany(keys, (i) => resRect(p, keys[i]), (i) => bankRect(keys[i] === "back" ? 0 : keys[i]), { g, k, ms: PACE.fly * 0.8, gap: 50 });
    toBank(slots);
  }
  // Cards from the bank to p.
  async function collect(p, slots, from, g, k) {
    const keys = keysOf(slots);
    await art.flyMany(keys, from ?? ((i) => bankRect(keys[i] === "back" ? 0 : keys[i])), (i) => resRect(p, keys[i]), { g, k });
    if (!live(g)) return;
    fromBank(slots);
    view.hands[p].push(...slots);
    gainFresh(p, slots);
    render();
  }

  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    const st = match.state;
    if (ev.type === "build") {
      const from = ev.kind === "road" ? joinedEnd(ev.at, ev.p) : -1;
      if (!ev.free) await spend(ev.p, ev.pay, g, k);
      if (!live(g)) return;
      if (ev.kind === "road") view.roads[ev.at] = ev.p;
      else view.buildings[ev.at] = { p: ev.p, city: ev.kind === "city" };
      if (ev.kind === "settlement") lastSettlement[ev.p] = ev.at;
      render();
      play(`build-${ev.kind}`);
      if (ev.kind === "road") art.growRoad(ev.at, from, { g, k });
      else art.popBuilding(ev.at, { g, k });
      addLog({ player: ev.p, text: `${nameOf(ev.p)} ${verb(ev.p, "builds")} a ${BUILD_NAMES[ev.kind]}${ev.free && st.phase !== "setup" && ev.kind === "road" ? " (free)" : ""}` });
      await wait((ev.kind === "road" ? PACE.road : PACE.build) * k, g);
    } else if (ev.type === "gain") {
      // The second settlement collects from each land it touches.
      const corner = lastSettlement[ev.p];
      const from = (i) => {
        const r = resourceOf(faceOf(ev.slots[i]));
        const hex = CORNERS[corner]?.hexes.find((h) => st.board.terrain[h] === r);
        return hex === undefined ? art.centreRect() : art.hexRect(hex);
      };
      ev.slots.forEach((s) => play("gain", { r: resourceOf(faceOf(s)) }));
      await collect(ev.p, ev.slots, from, g, k);
      addLog({ player: ev.p, cards: counts(ev.slots, faceOf), text: `${nameOf(ev.p)} ${verb(ev.p, "collects")} ${countWords(counts(ev.slots, faceOf))}` });
    } else if (ev.type === "roll") {
      fresh = zero();
      play("roll");
      await art.rollDice(ev.dice, { g, k });
      if (!live(g)) return;
      view.dice = ev.dice.slice();
      const total = ev.dice[0] + ev.dice[1];
      addLog({ player: ev.p, kind: total === 7 ? "seven" : "", text: `${nameOf(ev.p)} ${verb(ev.p, "rolls")} ${total}${total === 7 ? ": the robber!" : ""}` });
      if (total === 7) art.say(art.boardWrap, ev.p, "Seven!", g);
    } else if (ev.type === "produce") {
      await produce(ev, g, k);
    } else if (ev.type === "discard") {
      play("discard");
      await spend(ev.p, ev.slots, g, k);
      addLog({ player: ev.p, cards: counts(ev.slots, faceOf), text: `${nameOf(ev.p)} ${verb(ev.p, "discards")} ${countWords(counts(ev.slots, faceOf))}` });
    } else if (ev.type === "robber") {
      const from = view.robber;
      view.robber = ev.hex;
      render();
      play("robber");
      await art.hopRobber(from, ev.hex, { g, k });
      addLog({ player: ev.p, kind: "robber", text: `${nameOf(ev.p)} ${verb(ev.p, "moves")} the robber to ${hexWords(st.board, ev.hex)}` });
    } else if (ev.type === "steal") {
      await steal(ev, g, k);
    } else if (ev.type === "buy") {
      await spend(ev.p, ev.pay, g, k);
      if (!live(g)) return;
      play("buy");
      view.devPile = Math.max(0, view.devPile - 1);
      await art.flyCard(ev.p === me && devKind(faceOf(ev.slot)) ? devKind(faceOf(ev.slot)) : "back", bankRect("dev"), devRect(ev.p), { g, ms: PACE.fly * k, fade: ev.p !== me });
      if (!live(g)) return;
      view.devs[ev.p].push(ev.slot);
      render();
      addLog({ player: ev.p, kind: "dev", slot: ev.p === me ? ev.slot : undefined, text: `${nameOf(ev.p)} ${verb(ev.p, "buys")} a development card`, named: ev.p === me ? () => (devKind(faceOf(ev.slot)) ? `You buy a development card: ${DEV_NAMES[devKind(faceOf(ev.slot))].toLowerCase()}` : null) : null });
    } else if (ev.type === "play") {
      view.devs[ev.p] = view.devs[ev.p].filter((s) => s !== ev.slot);
      const face = faceOf(ev.slot);
      if (face !== null) view.shown[ev.p].push(face);
      if (ev.kind === "knight") view.knights[ev.p]++;
      render();
      play(ev.kind === "knight" ? "knight" : "progress");
      addLog({ player: ev.p, kind: "dev", text: `${nameOf(ev.p)} ${verb(ev.p, "plays")} ${ev.kind === "knight" ? "a knight" : DEV_NAMES[ev.kind].toLowerCase()}` });
      await art.moment({ text: DEV_NAMES[ev.kind], p: ev.p, card: ev.kind, from: devRect(ev.p), g, k });
    } else if (ev.type === "claim") {
      // Hidden victory points, shown to win.
      view.devs[ev.p] = view.devs[ev.p].filter((s) => !ev.slots.includes(s));
      view.shown[ev.p].push(...ev.slots.map(faceOf).filter((f) => f !== null));
      render();
      play("progress");
      addLog({ player: ev.p, kind: "dev", text: `${nameOf(ev.p)} ${verb(ev.p, "shows")} ${plural(ev.slots.length, "victory point card")}` });
      await art.moment({ text: ev.slots.length > 1 ? `${ev.slots.length} victory points` : "Victory point", p: ev.p, card: "vp", from: devRect(ev.p), g, k });
    } else if (ev.type === "plenty") {
      ev.slots.forEach((s) => play("gain", { r: resourceOf(faceOf(s)) }));
      await collect(ev.p, ev.slots, null, g, k);
      addLog({ player: ev.p, cards: counts(ev.slots, faceOf), text: `${nameOf(ev.p)} ${verb(ev.p, "takes")} ${countWords(counts(ev.slots, faceOf))} from the bank` });
    } else if (ev.type === "monopoly") {
      await monopoly(ev, g, k);
    } else if (ev.type === "bank") {
      play("trade");
      await spend(ev.p, ev.gave, g, k);
      if (!live(g)) return;
      // One card back (a slot), or a list of them.
      const got = [].concat(ev.got);
      await collect(ev.p, got, null, g, k);
      addLog({ player: ev.p, kind: "trade", text: `${nameOf(ev.p)} ${verb(ev.p, "trades")} ${countWords(counts(ev.gave, faceOf))} for ${countWords(counts(got, faceOf))} with the bank` });
    } else if (ev.type === "offer") {
      play("offer");
      art.say(pillOf(ev.p) ?? art.boardWrap, ev.p, "Trade?", g);
      addLog({ player: ev.p, kind: "trade", text: `${nameOf(ev.p)} ${verb(ev.p, "offers")} ${countWords(counts(ev.give, faceOf))} for ${countWords(ev.want)}` });
      await wait(PACE.between * 2 * k, g);
    } else if (ev.type === "answer") {
      art.say(pillOf(ev.p) ?? art.boardWrap, ev.p, ev.accept ? "Deal!" : "No thanks", g);
      await wait(PACE.between * 2 * k, g);
    } else if (ev.type === "trade") {
      await swap(ev, g, k);
    } else if (ev.type === "nodeal") {
      play("nodeal");
      addLog({ player: ev.p, kind: "trade", text: "No trade this time" });
    } else if (ev.type === "longest" || ev.type === "army") {
      await award(ev, g, k);
    } else if (ev.type === "turn") {
      fresh = zero();
      robbed = -1;
      addLog({ player: ev.p, kind: "turn", text: ev.p === me ? "Your turn" : `${nameOf(ev.p)}'s turn` });
    } else if (ev.type === "over") {
      finalPoints = ev.points;
      addLog({ player: ev.winner, kind: "win", text: `${nameOf(ev.winner)} ${verb(ev.winner, "reaches")} ${plural(ev.points[ev.winner], "point")}!` });
    }
    current = null;
    await wait(PACE.between * k, g);
  }

  // Which end of a new road joins p's own pieces: it draws in from there.
  function joinedEnd(edge, p) {
    const e = EDGES[edge];
    const own = (c) => view.buildings[c]?.p === p || CORNERS[c].edges.some((o) => o !== edge && view.roads[o] === p);
    return own(e.a) ? e.a : e.b;
  }

  // A roll pays out: the numbers' hexes light up (the robber's stays dark),
  // then each building's cards fly from its hex to its owner.
  async function produce(ev, g, k) {
    const st = match.state;
    const flights = production(st.board, view.robber, view.buildings, ev.roll, ev.short);
    const hexes = HEXES.filter((h) => st.board.numbers[h.id] === ev.roll).map((h) => h.id);
    art.glowHexes(hexes.filter((h) => h !== view.robber), { g, k });
    art.glowHexes(hexes.filter((h) => h === view.robber), { g, k, cls: "blocked" });
    await wait(PACE.glow * 0.45 * k, g);
    const jobs = [];
    let i = 0;
    for (const f of flights) {
      for (let n = 0; n < f.n; n++) {
        const delay = i++ * PACE.flyGap * k;
        jobs.push(wait(delay, g).then(() => (play("gain", { r: f.r }), art.flyCard(f.r, art.hexRect(f.hex), resRect(f.p, f.r), { g, ms: PACE.fly * k }))));
      }
    }
    await Promise.all(jobs);
    if (!live(g)) return;
    ev.gains.forEach((slots, p) => {
      fromBank(slots);
      view.hands[p].push(...slots);
      gainFresh(p, slots);
    });
    render();
    const got = seats.filter((p) => ev.gains[p]?.length);
    for (const r of ev.short ?? []) addLog({ kind: "short", text: `The bank is short of ${RES_NAMES[r]}: nobody gets any` });
    if (!got.length) addLog({ text: `${ev.roll}: nobody collects` });
    for (const p of got) addLog({ player: p, cards: counts(ev.gains[p], faceOf), text: `${nameOf(p)} ${verb(p, "gets")} ${countWords(counts(ev.gains[p], faceOf))}` });
  }

  // The robber's steal: a card slides from the victim to the thief, face up
  // only for the two of them, who learn what it was once its face arrives.
  async function steal(ev, g, k) {
    const { thief, victim, slot } = ev;
    const face = thief === me ? faceOf(slot) : null;
    const before = victim === me ? mySnapshot : null;
    if (view.hands[victim].length) view.hands[victim] = view.hands[victim].slice(0, -1);
    robbed = victim;
    render();
    play("steal");
    const r = resourceOf(face);
    await art.flyCard(r >= 0 && r !== null ? r : "back", seatRect(victim), thief === me && r >= 0 ? art.pileRect(r) : seatRect(thief), { g, ms: PACE.steal * k, fade: thief !== me });
    if (!live(g)) return;
    view.hands[thief].push(slot);
    if (thief === me && r >= 0) fresh[r]++;
    render();
    if (thief === me) addLog({ player: thief, kind: "robber", text: `You steal a card from ${nameOf(victim)}`, named: () => (resourceOf(faceOf(slot)) >= 0 ? `You steal ${RES_NAMES[resourceOf(faceOf(slot))]} from ${nameOf(victim)}` : null) });
    else if (victim === me)
      addLog({
        player: thief,
        kind: "robber",
        text: `${nameOf(thief)} steals a card from you`,
        named: () => {
          const now = match.state.hands[me];
          if (!before || now.some((s) => faceOf(s) === null)) return null;
          const after = counts(now, faceOf);
          const lost = before.findIndex((n, r2) => n > after[r2]);
          return lost >= 0 ? `${nameOf(thief)} steals your ${RES_NAMES[lost]}` : `${nameOf(thief)} steals a card from you`;
        },
      });
    else addLog({ player: thief, kind: "robber", text: `${nameOf(thief)} steals a card from ${nameOf(victim)}` });
  }

  async function monopoly(ev, g, k) {
    play("progress");
    const flights = [];
    ev.given.forEach((slots, q) => {
      if (!slots?.length) return;
      removeSlots(q, slots);
      flights.push(art.flyMany(slots.map(() => ev.resource), resRect(q, ev.resource), resRect(ev.p, ev.resource), { g, k }));
    });
    render();
    await Promise.all(flights);
    if (!live(g)) return;
    const all = ev.given.flat();
    view.hands[ev.p].push(...all);
    gainFresh(ev.p, all);
    render();
    const from = seats.filter((q) => ev.given[q]?.length).map((q) => `${ev.given[q].length} from ${q === me ? "you" : nameOf(q)}`);
    addLog({ player: ev.p, kind: "dev", text: `${nameOf(ev.p)} ${verb(ev.p, "takes")} every ${RES_NAMES[ev.resource]}: ${all.length}${from.length ? ` (${listOf(from)})` : ""}` });
  }

  // A trade between players: each side's cards cross to the other.
  async function swap(ev, g, k) {
    const { from, to, gave, got } = ev;
    play("trade");
    const a = keysOf(gave);
    const b = keysOf(got);
    removeSlots(from, gave);
    removeSlots(to, got);
    render();
    await Promise.all([art.flyMany(a, (i) => resRect(from, a[i]), (i) => resRect(to, a[i]), { g, k, ms: PACE.trade }), art.flyMany(b, (i) => resRect(to, b[i]), (i) => resRect(from, b[i]), { g, k, ms: PACE.trade })]);
    if (!live(g)) return;
    view.hands[to].push(...gave);
    view.hands[from].push(...got);
    gainFresh(to, gave);
    gainFresh(from, got);
    render();
    addLog({ player: from, kind: "trade", text: `${nameOf(from)} ${verb(from, "trades")} ${countWords(counts(gave, faceOf))} with ${to === me ? "you" : nameOf(to)} for ${countWords(counts(got, faceOf))}` });
  }

  // Longest road or largest army changes hands: a banner, and the badge moves to its pill.
  async function award(ev, g, k) {
    const longest = ev.type === "longest";
    const was = longest ? view.longest.p : view.army.p;
    view[longest ? "longest" : "army"] = { p: ev.p, size: ev.size };
    if (ev.p < 0) {
      render();
      return addLog({ kind: "award", text: `Nobody holds the ${longest ? "longest road" : "largest army"} now` });
    }
    play(longest ? "longest" : "army");
    const words = longest ? `Longest road (${ev.size})` : `Largest army (${ev.size})`;
    await art.moment({ text: words, p: ev.p, g, k });
    if (!live(g)) return;
    render();
    const badge = notes[ev.p].querySelector(longest ? ".hx-award.road" : ".hx-award.army");
    if (!fast()) badge?.animate([{ transform: "scale(.2) rotate(-30deg)", opacity: 0 }, { transform: "scale(1.5) rotate(8deg)", opacity: 1, offset: 0.6 }, { transform: "scale(1)" }], { duration: PACE.badge * k, easing: "cubic-bezier(.34,1.56,.64,1)" });
    addLog({ player: ev.p, kind: "award", text: `${nameOf(ev.p)} ${verb(ev.p, "takes")} the ${longest ? `longest road (${ev.size} roads)` : `largest army (${ev.size} knights)`}${was >= 0 && was !== ev.p ? ` from ${was === me ? "you" : nameOf(was)}` : ""}: 2 points` });
  }

  // ---------- log ----------
  function logLine(e) {
    return [e.cards ? cardsRow(e.cards, { cls: "hx-log-cards" }) : null, el("span", {}, e.text)];
  }
  function addLog(entry) {
    if (entry.named) {
      const text = entry.named();
      if (text) {
        entry.text = text;
        entry.named = null;
      }
    }
    entry.node = el("li", { class: `${entry.player === undefined ? "" : `p-${entry.player}`} ${entry.kind || ""} fresh` }, logLine(entry));
    log.unshift(entry);
    for (const old of log.slice(1)) old.node.classList.remove("fresh");
    log = log.slice(0, 60);
    logList.replaceChildren(...log.map((e) => e.node));
  }
  // Cards only you saw are named once their faces have arrived.
  function renderLog() {
    for (const e of log) {
      if (!e.named) continue;
      const text = e.named();
      if (!text) continue;
      e.text = text;
      e.named = null;
      e.node.replaceChildren(...logLine(e));
    }
  }

  // ---------- your moves ----------
  const st = () => match.state;
  const slotsOf = (r, n, hand = st().hands[me]) => hand.filter((s) => resourceOf(faceOf(s)) === r).slice(0, n);
  const pickSlots = (c) => c.flatMap((n, r) => slotsOf(r, n));
  const costPay = (kind) => payment(st().hands[me], faceOf, COSTS[kind]);
  function send(move) {
    mode = null;
    robberPick = null;
    devSlot = null;
    spotInfo = null;
    match.play(move);
  }

  function chooseSpot(kind, id) {
    const s = st();
    if (!myChoice()) return;
    if (s.phase === "setup") return send(kind === "corner" ? { settle: id } : { road: id });
    if (s.phase === "robber") {
      const vs = victims(s, id, me);
      if (vs.length > 1) {
        robberPick = id;
        render();
        return panel.querySelector(".hx-victim")?.focus();
      }
      return send({ robber: id, steal: vs[0] ?? -1 });
    }
    if (s.phase !== "main") return;
    if (s.freeRoads > 0) return send({ road: id });
    const build = mode;
    const pay = costPay(build);
    if (!pay) {
      play("nope");
      return toast(`You can't afford a ${BUILD_NAMES[build]}`);
    }
    if (build === "road") send({ road: id, pay });
    else if (build === "settlement") send({ settle: id, pay });
    else if (build === "city") send({ city: id, pay });
  }

  function playDev(slot) {
    const s = st();
    const kind = devKind(faceOf(slot));
    if (!devPlayable(slot)) return;
    if (kind === "plenty" || kind === "monopoly") {
      devSlot = slot;
      mode = kind;
      pick.plenty = zero();
      render();
      return panel.querySelector("button:not([disabled])")?.focus();
    }
    if (kind === "road" && !legalEdges(s, me).length) return toast("There's nowhere to build a road");
    send({ play: slot });
  }
  function devPlayable(slot) {
    const s = match?.state;
    const choice = myChoice();
    if (!s || (choice !== "main" && choice !== "roll") || mode) return false;
    return playable(s, me, faceOf).includes(slot);
  }

  function setMode(next) {
    mode = mode === next ? null : next;
    robberPick = null;
    render();
    if (mode === "road" || mode === "settlement" || mode === "city") art.focusSpots();
  }

  function endTurn() {
    if (myChoice() === "main" && !st().freeRoads) send({ end: true });
  }
  function roll() {
    if (myChoice() === "roll") send({ roll: true });
  }

  // R rolls, E ends your turn, Esc steps back.
  function onKey(e) {
    if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (e.key === "Escape" && (mode || robberPick !== null)) {
      mode = null;
      robberPick = null;
      devSlot = null;
      render();
      status.focus({ preventScroll: true });
    } else if (key === "r" && !e.target.closest?.("button")) roll();
    else if (key === "e" && !e.target.closest?.("button")) endTurn();
  }
  addEventListener("keydown", onKey);

  // ---------- the action panel ----------
  // Rebuilt only when what it shows changes; focus stays on the control with the same id.
  let panelHtml = "";
  function renderActions() {
    const nodes = panelNodes();
    const box = el("div", {}, nodes);
    const html = box.innerHTML;
    actions.hidden = !nodes.length;
    if (html === panelHtml) return;
    panelHtml = html;
    const focused = panel.contains(document.activeElement) ? document.activeElement.id : null;
    panel.replaceChildren(...box.childNodes);
    if (focused) (document.getElementById(focused) ?? panel.querySelector("button:not([disabled])") ?? status).focus({ preventScroll: true });
  }

  const btn = (id, label, onclick, { cls = "", disabled = false, title = null, aria = null, children = null } = {}) =>
    el("button", { class: `btn ${cls}`, type: "button", id, disabled, title, "aria-label": aria, onclick: disabled ? null : onclick }, children ?? label);
  const title = (text, small = "") => el("div", { class: "hx-panel-title" }, el("strong", {}, text), small ? el("small", {}, small) : null);
  const hint = (text) => el("p", { class: "hx-panel-hint" }, text);

  // One stepper per resource: its card, the count picked, and buttons for one less and one more.
  function steppers(name, values, max, onChange, { legend }) {
    return el(
      "fieldset",
      { class: "hx-steppers", id: `hx-${name}-pick` },
      el("legend", {}, `${legend}${sum(values) ? `: ${countWords(values)}` : ""}`),
      RESOURCES.map((r) =>
        el(
          "div",
          { class: `hx-stepper r-${r} ${values[r] ? "on" : ""}` },
          cardEl(r, "mini", { mini: true }),
          el("span", { class: "hx-step-n mono", "aria-hidden": "true" }, String(values[r])),
          el(
            "span",
            { class: "hx-step-btns" },
            btn(`hx-${name}-less-${r}`, "−", () => onChange(r, -1), { cls: "small", disabled: values[r] <= 0, aria: `One less ${RES_NAMES[r]}` }),
            btn(`hx-${name}-more-${r}`, "+", () => onChange(r, 1), { cls: "small", disabled: values[r] >= max[r], aria: `One more ${RES_NAMES[r]}` }),
          ),
        ),
      ),
    );
  }

  // A row of five resource buttons: pick one.
  function resourceButtons(name, { selected = -1, disabled = () => false, note = () => "", onPick, label }) {
    return el(
      "div",
      { class: "hx-res-buttons", role: "group", "aria-label": label },
      RESOURCES.map((r) =>
        btn(`hx-${name}-${r}`, "", () => onPick(r), {
          cls: `hx-res-btn r-${r} ${selected === r ? "on" : ""}`,
          disabled: disabled(r),
          aria: `${RES_NAMES[r]}${note(r) ? `, ${note(r)}` : ""}${selected === r ? ", chosen" : ""}`,
          children: [glyphEl(r), el("span", { class: "hx-res-name" }, RES_NAMES[r]), note(r) ? el("small", { class: "mono" }, note(r)) : null],
        }),
      ),
    );
  }

  // The offer on the table, and everyone's answers as they come in.
  function offerCard(s) {
    const t = s.trade;
    const give = counts(t.give, faceOf);
    const answers = seats.filter((p) => p !== t.from).map((p) => {
      const a = t.answers[p];
      const chose = match.step?.commits?.[p];
      const state = Array.isArray(a) ? "yes" : a === false ? "no" : chose ? "chose" : "waiting";
      const word = { yes: "Deal", no: "No thanks", chose: "Answered", waiting: p === me ? "Your answer?" : "Thinking" }[state];
      return el("li", { class: `p-${p} ${state}` }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "who" }, nameOf(p)), state === "waiting" && p !== me ? thinkingDots() : null, el("span", { class: "ans" }, word));
    });
    return el(
      "div",
      { class: `hx-offer p-${t.from}`, id: "hx-offer" },
      el("p", { class: "hx-offer-line" }, el("strong", {}, `${nameOf(t.from)} ${t.from === me ? "offer" : "offers"}`), cardsRow(give), el("span", { class: "for" }, "for"), cardsRow(t.want)),
      el("ul", { class: "hx-answers", "aria-label": "Answers" }, answers),
    );
  }

  // The four builds: each with its cost (missing cards faded), lit when you can.
  function buildGrid(s, active) {
    const have = myCounts(s.hands[me]);
    const pieces = s.pieces[me];
    const items = [
      { kind: "road", name: "Road", left: pieces.roads, spots: () => legalEdges(s, me).length },
      { kind: "settlement", name: "Settlement", left: pieces.settlements, spots: () => legalCorners(s, me).length },
      { kind: "city", name: "City", left: pieces.cities, spots: () => legalCities(s, me).length },
      { kind: "dev", name: "Development card", left: s.devPile.length, spots: () => 1 },
    ];
    return el(
      "div",
      { class: "hx-builds", role: "group", "aria-label": "Build" },
      items.map((it) => {
        const afford = !!payment(s.hands[me], faceOf, COSTS[it.kind]);
        const why = !active ? "" : !it.left ? (it.kind === "dev" ? "none left" : `no ${it.kind === "city" ? "cities" : `${it.kind}s`} left`) : !afford ? "not enough cards" : !it.spots() ? "nowhere to build" : "";
        const can = active && !why;
        const label = `${it.kind === "dev" ? "Buy a development card" : `Build a ${it.kind}`}: costs ${countWords(COSTS[it.kind])}${why ? `, ${why}` : ""}${it.kind !== "dev" ? `, ${it.left} left` : ""}`;
        return btn(`hx-build-${it.kind}`, "", () => (it.kind === "dev" ? send({ buy: true, pay: costPay("dev") }) : setMode(it.kind)), {
          cls: `hx-build ${can ? "can" : ""} ${mode === it.kind ? "on" : ""}`,
          disabled: !can,
          aria: label,
          title: label,
          children: [el("span", { class: "hx-build-name" }, it.name), cardsRow(COSTS[it.kind], { have }), el("small", { class: "hx-left mono" }, it.kind === "dev" ? `${it.left} in the pile` : `${it.left} left`)],
        });
      }),
    );
  }

  // The words about a spot being pointed at, during placement.
  function spotLine(s) {
    if (!spotInfo || spotInfo.kind !== "corner") return null;
    const c = CORNERS[spotInfo.id];
    if (!c) return null;
    return el(
      "p",
      { class: "hx-spot-info", "aria-hidden": "true" },
      c.hexes.map((h) => {
        const t = s.board.terrain[h];
        return el("span", { class: "hx-spot-hex" }, t === DESERT ? el("span", {}, "desert") : [glyphEl(t), el("b", { class: `mono ${[6, 8].includes(s.board.numbers[h]) ? "hot" : ""}` }, String(s.board.numbers[h]))]);
      }),
    );
  }

  function panelNodes() {
    if (!match || ended) return [];
    const s = match.state;
    if (match.phase !== "playing" || !s || !view) return [];
    const d = decision();
    const choice = myChoice();
    const busy = !d;
    const turnTitle = s.turn === me ? "Your turn" : `${nameOf(s.turn)}'s turn`;
    const out = [];
    // A trade under way is shown to everyone.
    if (s.trade && (s.phase === "answer" || s.phase === "partner")) out.push(offerCard(s));

    if (s.phase === "setup") {
      const first = s.setup.i < count;
      if (choice) {
        if (s.setup.corner === -1) out.push(title(first ? "Place your first settlement" : "Place your second settlement", first ? "Then a road next to it." : "It collects a card from each land it touches."), hint("Tap a glowing corner. More dots under a number means it's rolled more often."), spotLine(s));
        else out.push(title("Place a road", "Next to the settlement you just placed."), hint("Tap a glowing path."));
      } else out.push(title(busy ? turnTitle : `${nameOf(s.turn)} ${s.turn === me ? "are" : "is"} placing`, "Everyone places two settlements and two roads, then the first turn starts."));
    } else if (s.phase === "roll") {
      if (choice) {
        const knights = s.devs[me].filter((x) => devPlayable(x) && devKind(faceOf(x)) === "knight");
        out.push(title("Your turn"), el("div", { class: "hx-row" }, btn("hx-roll", "Roll the dice", roll, { cls: "primary big", aria: "Roll the dice (R)" }), knights.length ? btn("hx-knight-first", "Play a knight first", () => playDev(knights[0])) : null));
      } else out.push(title(busy ? turnTitle : `${nameOf(s.turn)} ${verb(s.turn, "rolls")} next`), buildGrid(s, false));
    } else if (s.phase === "discard") {
      const owe = discardCount(s, me);
      if (choice) {
        const have = myCounts(s.hands[me]);
        const n = sum(pick.discard);
        out.push(
          title(`Discard ${plural(owe, "card")}`, `A seven: everyone holding more than 7 gives back half.`),
          steppers("discard", pick.discard, have.map((h) => Math.min(h, owe)), (r, dlt) => {
            if (dlt > 0 && sum(pick.discard) >= owe) return;
            pick.discard[r] += dlt;
            render();
          }, { legend: "Give back" }),
          el("div", { class: "hx-row" }, btn("hx-discard", n === owe ? `Discard ${owe}` : `${n} of ${owe} chosen`, () => send({ discard: pickSlots(pick.discard) }), { cls: "primary", disabled: n !== owe })),
        );
      }
      const waiting = (d?.movers ?? []).filter((p) => p !== me);
      if (waiting.length) out.push(hint(`Still choosing: ${listOf(waiting.map(nameOf))}.`));
      else if (!choice && match.step?.commits?.[me]) out.push(hint("Discarded. Waiting for the others…"));
    } else if (s.phase === "robber") {
      if (choice && robberPick === null) out.push(title("Move the robber", "Tap a hex: it stops paying until the robber moves on, and you steal a card from someone there."));
      else if (choice) {
        const vs = victims(s, robberPick, me);
        out.push(
          title("Steal from…", hexWords(s.board, robberPick)),
          el("div", { class: "hx-row hx-victims" }, vs.map((p) => btn(`hx-victim-${p}`, "", () => send({ robber: robberPick, steal: p }), { cls: `hx-victim p-${p}`, aria: `Steal from ${nameOf(p)}, ${plural(view.hands[p].length, "card")}`, children: [el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, nameOf(p)), el("small", { class: "mono" }, plural(view.hands[p].length, "card"))] }))),
          btn("hx-robber-back", "Choose another hex", () => ((robberPick = null), render()), { cls: "small" }),
        );
      } else out.push(title(busy ? turnTitle : `${nameOf(s.turn)} ${verb(s.turn, "moves")} the robber`));
    } else if (s.phase === "main") {
      if (!choice) out.push(title(turnTitle), buildGrid(s, false));
      else if (s.freeRoads > 0) out.push(title(`Road building: ${plural(s.freeRoads, "free road")} to place`), hint("Tap a glowing path."));
      else if (mode === "road" || mode === "settlement" || mode === "city") {
        out.push(title(`Build a ${BUILD_NAMES[mode]}`, mode === "city" ? "Tap one of your settlements to make it a city." : `Tap a glowing ${mode === "road" ? "path" : "corner"}.`), cardsRow(COSTS[mode]), mode === "settlement" ? spotLine(s) : null, btn("hx-cancel", "Cancel", () => setMode(null), { cls: "small", aria: "Cancel (Esc)" }));
      } else if (mode === "trade") out.push(...tradeNodes(s));
      else if (mode === "plenty") {
        const n = sum(pick.plenty);
        out.push(
          title("Year of plenty", "Take any two cards from the bank."),
          steppers("plenty", pick.plenty, view.bank.map((b) => Math.min(b, 2)), (r, dlt) => {
            if (dlt > 0 && sum(pick.plenty) >= 2) return;
            pick.plenty[r] += dlt;
            render();
          }, { legend: "Take" }),
          el("div", { class: "hx-row" }, btn("hx-plenty", n === 2 ? "Take them" : `${n} of 2 chosen`, () => send({ play: devSlot, take: pick.plenty.flatMap((c, r) => Array(c).fill(r)) }), { cls: "primary", disabled: n !== 2 }), btn("hx-back", "Back", () => setMode(null))),
        );
      } else if (mode === "monopoly") {
        out.push(title("Monopoly", "Name a resource: everyone else gives you all of theirs."), resourceButtons("mono", { label: "Name a resource", onPick: (r) => send({ play: devSlot, resource: r }) }), btn("hx-back", "Back", () => setMode(null), { cls: "small" }));
      } else {
        out.push(
          title("Your turn", "Build, trade, play a development card, or end your turn."),
          buildGrid(s, true),
          el("div", { class: "hx-row" }, btn("hx-trade", "Trade…", () => ((mode = "trade"), render()), { cls: "", aria: "Trade with the bank or the others" }), btn("hx-end", "End turn", endTurn, { cls: "primary", aria: "End turn (E)" })),
        );
      }
    } else if (s.phase === "answer") {
      const t = s.trade;
      if (choice || (mine(d) && match.canMove())) {
        const pay = payment(s.hands[me], faceOf, t.want);
        out.push(el("div", { class: "hx-row" }, btn("hx-accept", "Accept", () => send({ accept: pay }), { cls: "primary", disabled: !pay, title: pay ? null : "You don't have those cards" }), btn("hx-decline", "No thanks", () => send({ decline: true }))));
        if (!pay) out.push(hint("You don't have the cards they want."));
      } else if (t.from === me) out.push(hint("Waiting for answers…"));
    } else if (s.phase === "partner") {
      const t = s.trade;
      if (choice) {
        const yes = seats.filter((p) => Array.isArray(t.answers[p]));
        out.push(title("Choose who to trade with"), el("div", { class: "hx-row" }, yes.map((p) => btn(`hx-partner-${p}`, `Trade with ${nameOf(p)}`, () => send({ partner: p }), { cls: `primary hx-victim p-${p}` })), btn("hx-calloff", "Call it off", () => send({ partner: -1 }))));
      } else out.push(hint(`${nameOf(t.from)} is choosing who to trade with…`));
    } else if (s.phase === "monopoly") {
      out.push(title(`${nameOf(s.monopoly.p)} ${verb(s.monopoly.p, "names")} ${RES_NAMES[s.monopoly.resource]}`, s.monopoly.p === me ? "Everyone hands theirs over." : "Everyone hands theirs over: yours go for you."));
    }
    return out.filter(Boolean);
  }

  // Trading: with the bank at your rates, or an offer to everyone.
  function tradeNodes(s) {
    const have = myCounts(s.hands[me]);
    const rate = (r) => tradeRate(s, me, r);
    const tabs = el(
      "div",
      { class: "hx-tabs", role: "tablist", "aria-label": "Trade with" },
      [
        ["bank", "Bank"],
        ["players", "Players"],
      ].map(([id, label]) => el("button", { class: `hx-tab ${tradeTab === id ? "on" : ""}`, type: "button", role: "tab", id: `hx-tab-${id}`, "aria-selected": String(tradeTab === id), onclick: () => ((tradeTab = id), render()) }, label)),
    );
    const out = [title("Trade"), tabs];
    if (tradeTab === "bank") {
      const g = pick.bankGive;
      const t = pick.bankTake;
      out.push(
        resourceButtons("bank-give", { label: "Give", selected: g, note: (r) => `${rate(r)}:1`, disabled: (r) => have[r] < rate(r), onPick: (r) => ((pick.bankGive = r), pick.bankTake === r && (pick.bankTake = -1), render()) }),
        el("p", { class: "hx-arrow", "aria-hidden": "true" }, "for"),
        resourceButtons("bank-take", { label: "Get", selected: t, note: (r) => (view.bank[r] ? "" : "none"), disabled: (r) => r === g || !s.bank[r].length, onPick: (r) => ((pick.bankTake = r), render()) }),
        el(
          "div",
          { class: "hx-row" },
          btn("hx-bank-trade", g >= 0 && t >= 0 ? `Trade ${rate(g)} ${RES_NAMES[g]} for 1 ${RES_NAMES[t]}` : "Pick what to give and get", () => send({ bank: slotsOf(g, rate(g)), take: t }), { cls: "primary", disabled: !(g >= 0 && t >= 0 && have[g] >= rate(g)) }),
          btn("hx-back", "Back", () => setMode(null)),
        ),
        hint("Four of a kind for one, or better at your harbours."),
      );
    } else {
      const capped = s.offers >= MAX_OFFERS;
      const ok = !capped && sum(pick.give) > 0 && sum(pick.want) > 0 && pick.give.every((n, r) => !(n && pick.want[r]));
      out.push(
        steppers("give", pick.give, have, (r, dlt) => ((pick.give[r] += dlt), dlt > 0 && (pick.want[r] = 0), render()), { legend: "You give" }),
        steppers("want", pick.want, RESOURCES.map(() => 9), (r, dlt) => ((pick.want[r] += dlt), dlt > 0 && (pick.give[r] = 0), render()), { legend: "You want" }),
        el("div", { class: "hx-row" }, btn("hx-offer-send", "Offer to everyone", () => send({ offer: pickSlots(pick.give), want: pick.want.slice() }), { cls: "primary", disabled: !ok }), btn("hx-back", "Back", () => setMode(null))),
        hint(capped ? `You've made ${MAX_OFFERS} offers this turn: that's the most.` : `Everyone answers at once; then you pick who to trade with. Up to ${MAX_OFFERS} offers a turn.`),
      );
    }
    return out;
  }

  // ---------- spots ----------
  function spotSpec() {
    const choice = myChoice();
    if (!choice) return null;
    const s = st();
    const words = { corner: (id) => cornerWords(s.board, id), edge: (id) => edgeWords(s.board, id), hex: (id) => hexSpotWords(s, id) };
    const edges = (label) => ({ kind: "edge", ids: legalEdges(s, me), ghost: (e) => roadSvg(e, me), words: words.edge, label });
    if (s.phase === "setup") return s.setup.corner === -1 ? { kind: "corner", ids: legalCorners(s, me), ghost: (c) => settlementSvg(c, me), words: words.corner, label: "Corners for a settlement" } : edges("Paths for a road");
    if (s.phase === "robber") return { kind: "hex", ids: robberPick === null ? robberHexes(s) : [robberPick], chosen: robberPick, ghost: robberPick === null ? robberSvg : null, words: words.hex, label: "Hexes for the robber" };
    if (s.phase !== "main") return null;
    if (s.freeRoads > 0 || mode === "road") return edges("Paths for a road");
    if (mode === "settlement") return { kind: "corner", ids: legalCorners(s, me), ghost: (c) => settlementSvg(c, me), words: words.corner, label: "Corners for a settlement" };
    if (mode === "city") return { kind: "corner", ids: legalCities(s, me), ghost: (c) => citySvg(c, me), words: (c) => `your settlement, ${cornerWords(s.board, c)}`, label: "Settlements to make a city" };
    return null;
  }
  function hexSpotWords(s, hex) {
    const who = [...new Set(HEXES[hex].corners.map((c) => s.buildings[c]?.p).filter((p) => p !== undefined))];
    return `${hexWords(s.board, hex)}${who.length ? `, with ${listOf(who.map((p) => (p === me ? "you" : nameOf(p))))}` : ""}`;
  }
  function renderSpots() {
    const spec = spotSpec();
    art.drawSpots(spec?.kind ?? null, spec?.ids ?? [], spec ?? {});
  }

  // ---------- render ----------
  function describe(ev) {
    if (!ev) return null;
    if (ev.type === "roll") return `${nameOf(ev.p)} ${verb(ev.p, "rolls")}…`;
    if (ev.type === "produce") return `${ev.roll}! The bank pays out.`;
    if (ev.type === "robber") return `${nameOf(ev.p)} ${verb(ev.p, "moves")} the robber.`;
    if (ev.type === "steal") return `${nameOf(ev.thief)} ${verb(ev.thief, "steals")} from ${ev.victim === me ? "you" : nameOf(ev.victim)}.`;
    if (ev.type === "trade") return `${nameOf(ev.from)} and ${ev.to === me ? "you" : nameOf(ev.to)} trade.`;
    if (ev.type === "play") return `${nameOf(ev.p)} ${verb(ev.p, "plays")} ${ev.kind === "knight" ? "a knight" : DEV_NAMES[ev.kind].toLowerCase()}!`;
    if ((ev.type === "longest" || ev.type === "army") && ev.p >= 0) return `${nameOf(ev.p)} ${verb(ev.p, "takes")} the ${ev.type === "longest" ? "longest road" : "largest army"}!`;
    return null;
  }

  function statusText() {
    if (ended) return "The game has ended.";
    if (!match) return "Getting the room's settings…";
    const s = match.state;
    if (match.phase === "aborted") return "Match stopped.";
    if (match.phase === "starting") return table.deckLine(match, nameOf);
    const now = describe(current);
    if (now) return now;
    if (table.pending) return status.textContent || "…";
    if (match.phase === "over") return overLine(s);
    const d = decision();
    if (!d) return "…";
    const turn = s.turn;
    const choice = myChoice();
    if (s.phase === "setup") {
      const placing = s.setup.corner === -1 ? "a settlement" : "a road";
      return turn === me ? (choice ? `Place ${placing}.` : "…") : `${nameOf(turn)} is placing ${placing}…`;
    }
    if (s.phase === "roll") return turn === me ? (choice ? "Your turn: roll the dice." : "…") : `${nameOf(turn)}'s turn…`;
    if (s.phase === "discard") {
      if (choice) return `A seven! Discard ${plural(discardCount(s, me), "card")}.`;
      return `Waiting for ${listOf(d.movers.map(nameOf))} to discard…`;
    }
    if (s.phase === "robber") return turn === me ? (robberPick === null ? "Move the robber: tap a hex." : "Choose whom to steal from.") : `${nameOf(turn)} is moving the robber…`;
    if (s.phase === "main") {
      if (turn !== me) return `${nameOf(turn)}'s turn…`;
      if (match.busy) return "…";
      if (s.freeRoads > 0) return `Place a free road (${s.freeRoads} left).`;
      if (mode === "road" || mode === "city" || mode === "settlement") return `Build a ${BUILD_NAMES[mode]}: tap a glowing ${mode === "road" ? "path" : "corner"}.`;
      if (mode === "trade") return "Trade with the bank or the others.";
      return "Build, trade or end your turn.";
    }
    if (s.phase === "answer") return choice || (mine(d) && match.canMove()) ? `${nameOf(s.trade.from)} offers ${countWords(counts(s.trade.give, faceOf))} for ${countWords(s.trade.want)}.` : "Waiting for answers…";
    if (s.phase === "partner") return turn === me ? (choice ? "Choose who to trade with." : "…") : `${nameOf(turn)} is choosing who to trade with…`;
    if (s.phase === "monopoly") return `${nameOf(s.monopoly.p)} ${verb(s.monopoly.p, "takes")} every ${RES_NAMES[s.monopoly.resource]}…`;
    return "…";
  }

  function overLine(s) {
    const w = s.winner;
    if (w < 0) return "The game stopped.";
    return `${w === me ? "You win" : `${nameOf(w)} wins`} with ${plural(finalPoints?.[w] ?? points(s, w), "point")}!`;
  }

  function renderNotes() {
    seats.forEach((p) => {
      const n = view.hands[p].length;
      const devs = view.devs[p].length;
      const parts = [
        ["cards", n, plural(n, "card")],
        ["devs", devs, plural(devs, "development card")],
      ];
      if (view.knights[p]) parts.push(["knights", view.knights[p], plural(view.knights[p], "knight")]);
      const label = [...parts.map((x) => x[2]), view.longest.p === p ? "longest road" : "", view.army.p === p ? "largest army" : "", robbed === p ? "robbed this turn" : ""].filter(Boolean).join(", ");
      const key = `${label}`;
      if (notes[p].dataset.key === key) return;
      notes[p].dataset.key = key;
      notes[p].setAttribute("aria-label", label);
      notes[p].replaceChildren(
        ...parts.map(([kind, v]) => el("span", { class: `hx-n ${kind}`, "aria-hidden": "true" }, el("i", {}), String(v))),
        view.longest.p === p ? el("span", { class: "hx-award road", title: `Longest road (${view.longest.size})`, "aria-hidden": "true" }) : "",
        view.army.p === p ? el("span", { class: "hx-award army", title: `Largest army (${view.army.size})`, "aria-hidden": "true" }) : "",
        robbed === p ? el("span", { class: "hx-robbed", title: "Robbed this turn", "aria-hidden": "true" }) : "",
      );
    });
  }

  function renderBoard() {
    const s = match?.state;
    const starting = match?.phase === "starting";
    if (s && !art.hasBoard()) {
      art.setBoard(s.board);
      if (starting) art.riseIsland(table.gen);
    }
    art.drawDeck(starting && !ended);
    const busy = match?.busy && match.phase !== "over" && !starting ? match.busy : null;
    table.renderBusy(starting ? null : busy, { starting, redraw: () => !destroyed && render() });
    if (starting && match.busy === "shuffling") table.shuffling(true);
    art.bankBox.hidden = !view || starting;
    if (!view) return;
    art.drawPieces(view);
    art.drawDice(view.dice, { dim: !!s && s.phase !== "roll" && s.phase !== "produce" && current?.type !== "roll" && !(s.phase === "main" && !s.rolled) && s.phase !== "main" });
    art.drawBank(view.bank, view.devPile);
  }

  function renderHand() {
    if (!view) return art.drawHand({ counts: zero() });
    const hand = view.hands[me];
    const known = hand.filter((s) => faceOf(s) !== null);
    const c = counts(known, faceOf);
    if (!current || current.type !== "steal") mySnapshot = c;
    const s = match?.state;
    const devs = view.devs[me].map((slot) => ({ slot, kind: devKind(faceOf(slot)), isNew: !!s?.bought?.includes(slot), playable: devPlayable(slot) }));
    const lifted = myChoice() === "discard" ? pick.discard : mode === "trade" && tradeTab === "players" ? pick.give : null;
    art.drawHand({ counts: c, unknown: hand.length - known.length, fresh: fresh.map((n, r) => Math.min(n, c[r])), devs, onDev: (slot) => playDev(slot), lifted });
  }

  function render() {
    if (destroyed) return;
    const s = match?.state;
    const phase = ended ? "ended" : match?.phase || "setup";
    rootBox.dataset.phase = phase;
    shell.setInProgress?.(phase === "starting" || phase === "playing");
    if (s && !view && !table.pending) view = viewFromState(s);
    // A decision that has passed takes its half-made choices with it.
    const choice = myChoice();
    if (choice !== "main") mode = null;
    if (choice !== "robber") robberPick = null;
    if (choice !== "discard") pick.discard = zero();
    if (view) {
      bar.update({
        turn: phase === "playing" && s ? (current?.p ?? s.turn) : -1,
        thinking: current || match?.busy ? -1 : thinkingSeat(),
        score: { wins: seats.map((p) => shownPoints(view, p)) },
        checked: match?.checked ?? [],
      });
      renderNotes();
    } else bar.update({ checked: match?.checked ?? [] });
    renderBoard();
    renderHand();
    renderSpots();
    renderActions();
    status.textContent = table.dealtLine(match, statusText());
    const d = decision();
    status.className = `${table.cls("status")} ${mine(d) ? `mine p-${me}` : d && !d.step ? `p-${s.turn}` : ""}`;
    rootBox.classList.toggle("my-turn", !!choice);
    renderLog();
    renderTimer();
    renderResult();
    setTabAlert(choice ? "Your turn" : null);
    if (choice) {
      // A chime when a decision comes to you; the moves of your own turn after the roll don't need one.
      const key = `${m}:${s.moves}`;
      if (cuedTurn !== key && ["setup", "roll", "discard", "answer", "partner"].includes(s.phase)) play("turn");
      cuedTurn = key;
    }
    autoMove();
  }

  // The robot whose move is awaited: the turn's, or the first in a step that hasn't chosen.
  function thinkingSeat() {
    const d = decision();
    if (!d) return -1;
    const robot = (p) => p !== me && (robotGame || session.players[p]?.robot);
    return d.movers.find(robot) ?? -1;
  }

  // The moves nobody chooses: made for you, after a short beat.
  function autoMove() {
    const d = decision();
    if (!mine(d) || !match.canMove()) return;
    const move = autoMoveFor();
    if (!move) return;
    const key = `${m}:${match.state.moves}:${match.state.phase}`;
    if (autoKey === key) return;
    autoKey = key;
    const g = table.gen;
    clearTimeout(autoTimer);
    const ms = move.decline ? robotPause(DECLINE_MS[0] + Math.random() * (DECLINE_MS[1] - DECLINE_MS[0])) : fast() ? 0 : AUTO_MS;
    autoTimer = setTimeout(() => {
      if (live(g) && mine() && match.canMove() && `${m}:${match.state.moves}:${match.state.phase}` === key) match.play(autoMoveFor() ?? move);
    }, ms);
  }

  // ---------- the clock ----------
  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    const ready = !!d && !match.busy && d.movers.length > 0;
    const key = `${m}:${match?.state?.moves}:${match?.state?.phase}:${ready}`;
    timer.hidden = !secs || !ready || match.phase !== "playing";
    if (timer.hidden) return;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    const who = d.movers.includes(me) ? me : d.movers[0];
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (secs * 1000))).toFixed(3)})`;
    timer.className = `hx-timer p-${who} ${left < 5000 ? "low" : ""}`;
    timerText.textContent = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
    timer.setAttribute("aria-label", who === me ? "Time for your move" : `Time for ${nameOf(who)}'s move`);
    if (who === me && myChoice() && left <= 3000 && left > 0) {
      const sec = Math.ceil(left / 1000);
      if (sec !== lastTick) {
        lastTick = sec;
        play("tick");
      }
    }
  }

  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !config?.moveSeconds) return;
    renderTimer();
    const d = decision();
    if (!d || timer.hidden) return;
    const left = deadline - performance.now();
    if (mine(d) && left <= 0 && timedOut !== deadlineKey && myChoice()) {
      timedOut = deadlineKey;
      // A stalled player would hold up the game: a sensible move is made for them.
      const move = timeoutMove(match.state, me, (slot) => match.face(slot));
      if (!move) return;
      toast(move.end ? "Time's up: your turn ended" : move.roll ? "Time's up: rolled for you" : "Time's up: a move was made for you");
      send(move);
    } else if (!mine(d) && left <= -CLAIM_GRACE_MS) {
      status.textContent = `Waiting for ${listOf(d.movers.map(nameOf))}'s browser…`;
    }
  }
  const ticker = setInterval(tick, 200);

  // ---------- the end ----------
  function winnerNodes() {
    const s = match?.state;
    if (!s || match.phase !== "over" || s.winner < 0) return [];
    return [...art.buildingNodes(s.winner), pillOf(s.winner)];
  }

  const verdictText = (v) => verdictOf(v, nameOf);
  function verdictLine() {
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "hx-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle and roll proved, and the game replayed with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "hx-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    if (match.phase === "aborted") return null;
    return el("p", { class: "verdict", id: "hx-verdict" }, thinkingDots(), "Checking every shuffle and replaying the game…");
  }

  // Where everyone's points came from; hidden point cards show once the audit opens every card.
  function pointsSheet(s) {
    const order = seats.slice().sort((a, b) => total(b) - total(a));
    function total(p) {
      return finalPoints?.[p] ?? points(s, p);
    }
    const hidden = (p) => (match.verdict?.ok || p === me ? s.devs[p].filter((x) => devKind(faceOf(x)) === "vp").length : 0);
    const rows = [
      ["Settlements", (p) => s.buildings.filter((b) => b?.p === p && !b.city).length],
      ["Cities", (p) => 2 * s.buildings.filter((b) => b?.p === p && b.city).length],
      ["Longest road", (p) => (s.longest.p === p ? 2 : 0)],
      ["Largest army", (p) => (s.army.p === p ? 2 : 0)],
      ["Point cards", (p) => s.shown[p].filter((f) => devKind(f) === "vp").length],
    ];
    const head = el("tr", {}, el("th", { scope: "col" }, ""), ...order.map((p) => el("th", { scope: "col", class: `p-${p} ${p === me ? "mine" : ""}` }, el("span", { class: "who" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "nm" }, nameOf(p))))));
    const body = rows.map(([label, fn]) => el("tr", {}, el("th", { scope: "row" }, label), ...order.map((p) => el("td", { class: "mono" }, String(fn(p) || "·")))));
    const unshown = order.some((p) => hidden(p) && p !== s.winner);
    if (unshown) body.push(el("tr", { class: "hidden-row" }, el("th", { scope: "row" }, "Hidden cards"), ...order.map((p) => el("td", { class: "mono" }, p === s.winner || !hidden(p) ? "·" : `(${hidden(p)})`))));
    const totals = el("tr", { class: "totals" }, el("th", { scope: "row" }, "Points"), ...order.map((p) => el("td", { class: `mono ${p === s.winner ? "best" : ""}` }, String(total(p)))));
    const tableNode = el("table", { class: "hx-sheet", id: "hx-sheet" }, el("thead", {}, head), el("tbody", {}, body), el("tfoot", {}, totals));
    return el("div", { class: "hx-over pc-game" }, el("div", { class: "hx-sheet-box", tabindex: "0", role: "region", "aria-label": "Points" }, tableNode), unshown ? el("small", { class: "hx-carried" }, "(Hidden point cards, shown by the audit, didn't count.)") : null, verdictLine());
  }

  let shownFor = null;
  let extra = null;
  function renderResult() {
    const phase = match?.phase;
    if (ended || (phase !== "over" && phase !== "aborted") || (phase === "over" && table.pending)) {
      result.hide();
      shownFor = null;
      return;
    }
    if (phase === "aborted") {
      const key = `${m}:aborted:${!!match.verdict}:${match.disputing}`;
      if (shownFor !== key) {
        shownFor = key;
        extra = match.disputing || match.verdict ? el("div", { class: "hx-over pc-game" }, match.verdict ? verdictLine() : el("p", { class: "verdict" }, thinkingDots(), "Checking who was right about the passed card…")) : null;
      }
      const who = (p) => (p === me && p !== match.abortSeat ? "you" : nameOf(p));
      return result.show({ stopped: true, reason: abortText({ reason: match.abortReason, seat: match.abortSeat, about: match.abortAbout }, who), extra });
    }
    const s = match.state;
    const key = `${m}:${!!match.verdict}`;
    if (shownFor !== key) {
      shownFor = key;
      extra = pointsSheet(s);
    }
    const pts = (p) => finalPoints?.[p] ?? points(s, p);
    const places = seats.slice().sort((a, b) => pts(b) - pts(a)).map((p) => ({ seat: p, note: plural(pts(p), "point") }));
    result.show({ winner: s.winner, reason: `${nameOf(s.winner)} reached ${s.target} points on ${s.winner === me ? "your" : "their"} own turn.`, places, extra });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    table.reset();
    clearTimeout(autoTimer);
    current = null;
    view = null;
    log = [];
    cuedTurn = "";
    autoKey = "";
    deadlineKey = "";
    timedOut = "";
    shownFor = null;
    lastVerdict = "";
    finalPoints = null;
    mode = null;
    robberPick = null;
    devSlot = null;
    fresh = zero();
    robbed = -1;
    lastSettlement = seats.map(() => -1);
    pick = { discard: zero(), give: zero(), want: zero(), plenty: zero(), bankGive: -1, bankTake: -1 };
    art.clearBoard();
    logList.replaceChildren();
    const opponents = listOf(seats.filter((p) => p !== me).map((p) => session.players[p].name));
    note.textContent = m === 1 ? `Playing ${opponents}. Good luck!` : `Rematch #${m - 1}: a new island, and a fresh deck shuffled by every browser.`;
    const mt = new CardMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    previous = match;
    match = mt;
    window.ddp.match = mt; // browser tests read this
    mt.on("update", () => {
      if (mt !== match) return;
      render();
    });
    mt.on("invalid", (reason) => {
      if (mt !== match) return;
      play("nope");
      toast(reason);
    });
    mt.on("start", () => {
      if (mt !== match) return;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = `${again}${nameOf(mt.state.turn)} ${verb(mt.state.turn, "places")} first (drawn by every browser).${lastVerdict && ` ${lastVerdict}.`}`;
    });
    mt.on("events", ({ player, move, events }) => {
      if (mt !== match) return;
      for (const ev of events) enqueue({ ...ev, mover: player, move });
    });
    mt.on("verified", (verdict) => {
      if (mt === match) return render();
      const text = verdict.ok ? "Last game: fair play verified" : `Last game didn't check out: ${verdictText(verdict)}`;
      lastVerdict = text.replace(/\.$/, "");
      note.textContent = text;
      toast(text);
    });
    router.start(mt);
    render();
  }

  function describeConfig(c) {
    const parts = [`Game to ${c.target}`];
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s a move`);
    const robotSeats = robotGame ? count - 1 : session.players.filter((p) => p.robot).length;
    if (robotSeats) parts.push(`${LEVEL_NAME[c.level]} ${robotSeats > 1 ? "robots" : "robot"}`);
    return parts.join(" · ");
  }

  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config, count);
    configLine.textContent = describeConfig(config);
    newMatch();
  }
  function onSetup(msg) {
    if (me !== 0) begin(msg.config);
  }

  function onEnd(reason, seatLeft) {
    if (reason === "self") return;
    ended = true;
    table.stop();
    clearTimeout(autoTimer);
    table.shuffling(false);
    art.drawDeck(false);
    const judged = match?.phase === "starting" && previous ? previous : match;
    leaveNotice({ root, session, seat: seatLeft, match: judged, prefix: "hx", game: "Hexlands", nameOf, facts: (s, p) => plural(points(s, p), "point") });
    render();
  }

  screenBusy = () => table.pending > 0;
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const resize = new ResizeObserver(() => {
    art.svg.classList.toggle("hx-narrow", art.svg.getBoundingClientRect().width < 420);
  });
  resize.observe(art.boardWrap);
  const offs = [offMsg, session.on("end", onEnd), session.on("rematch-start", () => config && newMatch()), settings.onChange(() => render())];
  if (robotGame) begin(settings.get());
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      table.destroy();
      art.drawDeck(false);
      screenBusy = () => false;
      clearInterval(ticker);
      clearTimeout(autoTimer);
      resize.disconnect();
      setTabAlert(null);
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
    },
  };
}
