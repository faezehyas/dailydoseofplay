// Stonecrown page: mounts the engine shell and renders a CardMatch. The rules
// live in rules.js, the data in cards.js, the art in card-art.js and
// pieces.js, and the table they make (the neighbours' panels with their
// borders, your wonder, the seat ring and your city, the shelf of what you
// make, and their motion: the hand-off, the carts, the war scene) in art.js,
// which the tutorial shares. This file is the view: your hand and what a
// card in it can do, who has picked, the seventh card and the dig, the top
// bar, the tips and first-time hints, the log, the clock, the score sheet
// and the result. The match state never waits for the screen: every event
// is queued and played out in order, faster when they pile up, and at once
// with reduced motion or a hidden tab (but for the war, which waits for
// Continue). Nothing hidden reaches the page: another seat's picks, tucked
// and sold cards show only as backs, even when this browser knows a face
// from holding the card before.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { CardMatch } from "../engine/card-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar, thinkingDots } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { cardTable, tokenMs, easing } from "../engine/cards/table.js";
import { humanPause, startPacedRobot } from "../engine/cards/paced-robot.js";
import { robotPause } from "../engine/robot-pace.js";
import { leaveNotice, abortText, verdictText as verdictOf } from "../engine/cards/leave-notice.js";
import { CARDS, WONDERS, HAND } from "./cards.js";
import { makeRules, normalizeConfig, forcedMove, legalMoves, designOf, passDir, stagesOf, score, ROUNDS, MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";
import { PACE, ROMAN, plural, listOf, effectWords, payWords, moveFor, pickOptions, warWords, warPairs, pairWords, resultWords, viewOf, cardEl, seatMark, cityDialog, scoreDialog, explainer, tableEl, scTable, scMotion, batches, buildPlan, stagePlan, costMatch, detailNodes, handView, handCaption, actButtons, picksList, scoreSheet } from "./art.js";
import { warSummary } from "./war.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";

// How long robots take over each choice (robotPause() scales these in tests).
const ROBOT_PACE = { pick: 1700, last: 1300, dig: 1600, spread: 1400 };
// A dig with nothing to build is made for you, after as long as a person
// would look: an instant one would tell everyone the discards hold nothing for you.
const FORCED_MS = [1400, 3200];
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
// With a move clock the war scene goes on by itself after this long.
const WAR_CLOCK_MS = 4000;
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const SIDE_NAME = { A: "A sides", B: "B sides", random: "Mixed sides" };
// Robot games: robots wait for the screen to finish replaying. The view sets this.
let screenBusy = () => false;

// robot.js, loaded once a robot plays or a clock runs: a guest needs neither.
let brain = null;
const loadBrain = () => import("./robot.js").then((mod) => (brain = mod));

function robotDelay(st) {
  if (!brain) return -1;
  return humanPause(screenBusy, () => (ROBOT_PACE[st.phase] ?? ROBOT_PACE.pick) + Math.random() * ROBOT_PACE.spread);
}

startGameShell({
  slug: "stonecrown",
  title: "Stonecrown",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "wide",
  settings,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createRobot: (session) => {
    const config = settings.get();
    loadBrain();
    // As robot.js's startRobot(), started at once so it hears every message;
    // it waits (and plans again: the key changes) until its brain has loaded.
    return startPacedRobot(session, {
      rules: makeRules(config, session.players.length),
      key: (st) => `${st.age}:${st.round}:${st.phase}:${st.moves}:${!!brain}`,
      choose: (st, me, rng, face) => brain?.chooseMove(st, me, rng, face, { level: config.level }) ?? null,
      fallback: (st, me, face) => brain?.timeoutMove(st, me, face) ?? null,
      delay: (st) => robotDelay(st),
    });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const seats = session.players.map((p) => p.seat);
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  const nameIn = (p) => (p === me ? "you" : session.players[p].name); // within a sentence
  // "You build", "Bo builds"
  const verb = (p, s) => (p !== me ? s : /(ss|sh|ch|x)es$/.test(s) ? s.slice(0, -2) : s.replace(/s$/, ""));
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
  let finalScores = null;
  let warLine = ""; // the war being shown, in words
  // Your choices on the way to a move.
  let sel = null; // { slot, build: purchase index, stage: purchase index }
  let picked = null; // { key, slot, kind, id, buy } once you have chosen this turn
  let light = {}; // the shelf's slots the card you look at lights
  const revealing = new Set(); // seats whose pick marks stay up while their picks turn over
  const leaving = new Set(); // your hand's slots on their way out
  const arriving = new Set(); // your hand's slots on their way in

  const table = cardTable({ prefix: "sc", play, animate: (ev, g) => animate(ev, g), done: (idle) => replayed(idle) });
  const { live, fast, wait } = table;
  const faceOf = (slot) => match?.face(slot) ?? null;
  const idOf = (slot) => designOf(count, faceOf(slot));

  // "setup" is for this view (only from the room's creator); the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  bar.update({ badges: seats.map((p) => seatMark(p)) });
  const status = el("p", { class: table.cls("status"), id: "sc-status", role: "status", "aria-live": "polite", tabindex: "-1" });

  // The age of each card tucked under a wonder, as its stage was built (its back shows it).
  const tuckedAge = new Map();
  const ageOf = (slot) => tuckedAge.get(slot) ?? 1;
  // Each war's results by age, once the screen has shown it: the borders' flags.
  const wars = [];
  const art = scTable(table, { me, players: count, nameOf, ageOf, sound: play, wars: () => wars, onSeat: (p) => openSeat(p), onScore: () => scoreNow.open(view) });
  const { around } = art;
  const whereOf = (p) => (p === me ? "you" : p === around.left ? "your left neighbour" : p === around.right ? "your right neighbour" : p === around.across ? "across the table" : "further round the table");
  const seatDialog = cityDialog({ nameOf, ageOf, me, whereOf });
  const dialog = seatDialog.node;
  const scoreNow = scoreDialog({ me, nameOf });

  // The top bar: the seat ring (every seat, the age, its turns and the way
  // hands go), the status line and Explain mode's bar while it is on, the
  // seats beyond your neighbours, the bank, the discard pile and "?".
  const explainSlot = el("span", { class: "sc-explain-slot" });
  const askBtn = el("button", { class: "btn sc-ask", type: "button", id: "sc-ask", "aria-pressed": "false", "aria-label": "Explain mode: tap anything to hear what it means (?)", onclick: () => explain() }, "?");
  const top = el("div", { class: "sc-top", id: "sc-top" }, art.ringBox, el("div", { class: "sc-top-mid" }, status, explainSlot), el("div", { class: "sc-top-side" }, art.pillBox, art.bankBox, art.pile, askBtn));

  // Your hand with the shelf of what you make above it, the buttons for the card you pick, and what it would do.
  const hand = handView({ onSelect: (slot) => select(slot) });
  const deck = el("div", { class: "sc-deck", hidden: true, "aria-hidden": "true" }, [0, 1, 2, 3, 4].map(() => el("span", { class: "sc-deck-card" })));
  const picks = picksList();
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "sc-timer", id: "sc-timer", hidden: true, role: "timer", "aria-label": "Time for the move" }, el("span", { class: "bar" }, timerFill), timerText);
  const buttons = actButtons({ onAct: (kind) => act(kind) });
  const detail = el("div", { class: "sc-detail", id: "sc-detail", "aria-live": "polite" });
  const handArea = el(
    "section",
    { class: "sc-hand-area", "aria-label": "Your move", dataset: { tipZone: "" } },
    el("div", { class: "sc-hand-head" }, el("div", { class: "sc-hand-words" }, el("h2", { class: "sc-title" }, hand.title), hand.next), picks.node),
    art.shelf,
    el("div", { class: "sc-hand-wrap", dataset: { tip: "hand", tipOn: "hold" } }, hand.node, deck, table.busyChip),
    buttons.node,
    el("div", { class: "sc-side" }, timer, detail),
  );

  const logList = el("ol", { class: table.cls("log"), id: "sc-log", role: "log", "aria-label": "What happened" });
  const logBox = el("section", { class: "sc-log-box", "aria-label": "Game log" }, el("h2", { class: "sc-title" }, "What happened"), logList);
  const configLine = el("p", { class: table.cls("config"), id: "sc-config" });
  const note = el("p", { class: table.cls("note"), id: "sc-note" });

  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    classes: (p) => `p-${p}`,
    // The result moment: the winner's city lights up chip by chip; a loss dims your wonder.
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "paper", highlight: winnerNodes(), board: art.mine }),
  });

  const rootBox = el(
    "div",
    { class: "stonecrown pc-game", dataset: { seat: me, players: count } },
    tableEl(),
    bar.node,
    top,
    el("div", { class: "sc-main" }, art.panels.get(around.left)?.node, art.mine, art.panels.get(around.right)?.node, handArea),
    logBox,
    configLine,
    note,
    result.node,
    dialog,
    scoreNow.node,
    art.war.node,
    table.flyLayer,
  );
  root.append(rootBox);

  // Everything on the table explains itself: hover, focus, press and hold, or a tap in Explain mode.
  const tips = explainer(rootBox, { view: () => view, me, nameOf, bar: explainSlot, focusBack: askBtn, onExplain: () => syncAsk() });
  function syncAsk() {
    askBtn.setAttribute("aria-pressed", String(tips.explaining()));
    rootBox.classList.toggle("sc-explain-on", tips.explaining());
  }
  function explain() {
    tips.explain();
    syncAsk();
  }
  // A first-time hint, once ever, pointing at what it names.
  const coach = (id, target) => !fast() && target?.isConnected && target.getClientRects().length > 0 && tips.coach(id, target);

  // ---------- whose decision it is ----------
  function decision() {
    if (!match?.state || match.phase !== "playing" || table.pending || ended) return null;
    const st = match.state;
    const movers = match.step ? match.step.movers.filter((p) => !match.step.commits[p]) : [];
    return { phase: st.phase, movers };
  }
  const mine = (d = decision()) => !!d && d.movers.includes(me);
  // Your real choice now (the phase), or null: not yours, or a move made for you.
  function myChoice() {
    const d = decision();
    return mine(d) && match.canMove() && !forcedMove(match.state, me, faceOf) ? d.phase : null;
  }
  const turnKey = () => (match?.state ? `${m}:${match.state.age}:${match.state.round}:${match.state.phase}` : "");

  // ---------- motion ----------
  function replayed(idle) {
    if (idle) {
      current = null;
      revealing.clear();
      leaving.clear();
      arriving.clear();
      if (match?.state) view = viewOf(match.state);
      for (const robot of window.ddp.robots || []) robot.poke?.();
    }
    render();
  }

  // A step's picks arrive as one batch of events: they turn over and land together.
  const enqueueAll = (events) => batches(events).forEach((ev) => table.enqueue(ev));

  const motion = scMotion(table, art, {
    me,
    seats,
    view: () => view,
    idOf,
    // A card in your hand, or while the hand is folded, the strip it folded to.
    handRect: (slot) => {
      const r = hand.card(slot) ? table.rectIn(hand.card(slot)) : null;
      return r?.w ? r : r ? table.rectIn(handArea) : art.rectsOf(me).pick();
    },
    handBox: () => (hand.node.getClientRects().length ? hand.node : handArea),
    leaving,
    arriving,
    revealing,
    draw: () => render(),
    sound: play,
    onTuck: (slot, age) => tuckedAge.set(slot, age),
    said,
    buyOf: () => picked?.buy ?? null,
    warWait: () => (config?.moveSeconds ? WAR_CLOCK_MS : 0),
    onWar,
    onPass: (ev) => coach("pass", art.panels.get(ev.dir > 0 ? around.left : around.right)?.slot),
  });

  // The war scene is the war's one announcement: the status line says it too, quietly.
  function onWar(ev, facts, done) {
    if (!done) {
      warLine = warSummary(facts, nameIn);
      status.setAttribute("aria-live", "off");
      const g = table.gen;
      setTimeout(() => live(g) && !art.war.node.hidden && coach("war", art.war.node.querySelector(".ws-stakes")), 700);
      return;
    }
    wars[ev.age - 1] = ev.results;
    render();
    status.setAttribute("aria-live", "polite");
    logList.removeAttribute("aria-live");
  }

  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    // The first deal comes before anything is drawn.
    if (!view) view = viewOf(match.state);
    if (ev.type === "picks") await motion.picks(ev, g, k);
    else if (ev.type === "age") {
      sel = null;
      const st = match.state;
      await motion.deal(ev, st.age === ev.age && st.round === 1 ? st.hands : null, g, k);
    } else if (ev.type === "pass") await motion.pass(ev, g, k);
    else if (ev.type === "sevenths") await motion.sevenths(ev, g, k);
    else if (ev.type === "war") await motion.war(ev, g, k);
    else if (ev.type === "last") {
      view.phase = "last";
      view.lastSeat = ev.p;
      render();
      addLog({ player: ev.p, text: ev.p === me ? "Your wonder lets you play your seventh card" : `${nameOf(ev.p)} plays a seventh card` });
      await wait(PACE.between * 3 * k, g);
    } else if (ev.type === "dig") {
      view.phase = "dig";
      view.digger = ev.p;
      play("dig");
      render();
      addLog({ player: ev.p, kind: "dig", text: ev.p === me ? `Your wonder lets you dig through the discards (${plural(view.discard.length, "card")})` : `${nameOf(ev.p)} digs through the discards` });
      await wait(PACE.between * 4 * k, g);
    } else if (ev.type === "over") await over(ev, g, k);
    current = null;
    await wait(PACE.between * k, g);
  }

  // The log's line for each thing the table shows happening; a neighbour's
  // build says what it means for you.
  function said(kind, x, recap = "") {
    if (kind === "pick") {
      const p = x.p;
      if (x.type === "build") return addLog({ player: p, kind: "build", text: `${buildWords(x)}${recap ? `: ${recap}` : ""}` });
      if (x.type === "stage") {
        const stage = stagesOf(view, p)[x.n];
        const id = p === me ? idOf(x.slot) : -1;
        return addLog({ player: p, kind: "stage", text: `${nameOf(p)} ${verb(p, "builds")} wonder stage ${ROMAN[x.n + 1]}${id >= 0 ? `, tucking ${CARDS[id].name}` : ""}${stage ? `: ${effectWords(stage)}` : ""}${paidWords(p, 0, x.bought)}` });
      }
      const id = p === me ? idOf(x.slot) : -1;
      return addLog({ player: p, kind: "sell", text: `${nameOf(p)} ${verb(p, "sells")} ${id >= 0 ? CARDS[id].name : "a card"} for 3 coins` });
    }
    if (kind === "gains") {
      for (const g of x) {
        if (g.why === "sale") continue;
        const why = g.why === "trade" ? ` from ${nameIn(g.from)}` : g.why === "stage" ? " from the wonder" : " from the card";
        addLog({ player: g.p, kind: "coins", text: `${nameOf(g.p)} ${verb(g.p, "gets")} ${plural(g.coins, "coin")}${why}` });
      }
    }
    if (kind === "age") addLog({ kind: "age", text: `Age ${ROMAN[x.age]}: ${HAND} cards each${x.age === 3 ? ", with guilds" : ""}. Hands pass ${passDir(x.age) > 0 ? "left" : "right"}.` });
    if (kind === "pass") addLog({ kind: "pass", text: `Hands pass ${x.dir > 0 ? "left" : "right"}: you get ${nameIn(x.from)}'s` });
    if (kind === "sevenths") {
      const mineGone = x.list.find((y) => y.p === me);
      addLog({ kind: "sell", text: `Last cards discarded${mineGone && idOf(mineGone.slot) >= 0 ? ` (yours: ${CARDS[idOf(mineGone.slot)].name})` : ""}` });
    }
    if (kind === "war") {
      // The war scene says it (onWar speaks again once it closes).
      logList.setAttribute("aria-live", "off");
      addLog({ kind: "war", text: warWords(x.results, me, x.age, nameIn) });
      for (const pair of warPairs(x.results)) if (!pair.includes(me)) addLog({ kind: "war", text: pairWords(pair, x.age, nameOf) });
    }
  }

  function buildWords(x) {
    const c = CARDS[x.id];
    const how = x.how === "chain" ? " free through a chain" : x.how === "free" ? " free, with the wonder's free build" : x.how === "dig" ? " free from the discards" : paidWords(x.p, x.coins, x.bought);
    return `${nameOf(x.p)} ${verb(x.p, "builds")} ${c.name}${how}`;
  }
  function paidWords(p, coins, bought = { left: 0, right: 0 }) {
    const names = { left: nameIn((p + 1) % count), right: nameIn((p + count - 1) % count) };
    const words = payWords({ bank: coins, left: bought.left, right: bought.right }, names);
    return words ? ` (${words.replace(/^Pay/, p === me ? "paid" : "paying")})` : "";
  }

  // The score sheet, a row at a time, then the result.
  let sheet = null;
  async function over(ev, g, k) {
    finalScores = ev.scores;
    // The borders behind the sheet show all three wars, and no warning.
    view.phase = "over";
    view.winners = ev.winners.slice();
    view.winner = ev.winners.length === 1 ? ev.winners[0] : -2;
    render();
    const order = seatOrder(ev.scores);
    sheet = scoreSheet(ev.scores, order, { me, nameOf, winners: ev.winners });
    addLog({ kind: "win", text: resultWords(ev.scores, ev.winners, me, nameOf) });
    if (!live(g)) return;
    if (fast()) return void play("score", { row: 7 });
    const box = el("div", { class: "sc-final", role: "presentation" }, el("p", { class: "sc-final-title" }, "Final scores"), sheet.node);
    art.centre(box);
    box.animate([{ opacity: 0, transform: "translate(-50%, -46%)" }, { opacity: 1, transform: "translate(-50%, -50%)" }], { duration: 260, easing: easing("out"), fill: "both" });
    await sheet.play({ g, k, wait, live, fast, sound: play });
    await wait(900 * k, g);
    box.remove();
  }
  const seatOrder = (scores) => seats.slice().sort((a, b) => scores[b].total - scores[a].total || match.state.coins[b] - match.state.coins[a] || a - b);

  // ---------- log ----------
  function addLog(entry) {
    entry.node = el("li", { class: `${entry.player === undefined ? "" : `p-${entry.player}`} ${entry.kind || ""} fresh` }, entry.player === undefined ? null : seatMark(entry.player), el("span", {}, entry.text));
    log[0]?.node.classList.remove("fresh");
    log.unshift(entry);
    for (const old of log.splice(80)) old.node.remove();
    // Only the new line is added, so the log announces it alone.
    logList.prepend(entry.node);
  }

  // ---------- your moves ----------
  const st = () => match.state;
  function send(move, kind) {
    const slot = move.build ?? move.stage ?? move.discard ?? move.dig;
    picked = { key: turnKey(), slot, kind, id: slot >= 0 ? idOf(slot) : -1, buy: move.buy ?? null };
    sel = null;
    play("pick");
    match.play(move);
    render();
  }

  // The cards you choose from now: your hand, or the discards while you dig.
  function choosable() {
    const s = match?.state;
    if (!s || !view) return [];
    if (myChoice() === "dig") return s.discard.filter((slot) => faceOf(slot) !== null);
    return view.hands[me];
  }

  // Out of your turn, a card can still be looked at (and let go of).
  function select(slot) {
    if (myChoice()) {
      if (sel?.slot === slot) return;
      sel = { slot, build: 0, stage: 0 };
    } else {
      if (picked?.key === turnKey()) return;
      sel = sel?.slot === slot ? null : { slot, build: 0, stage: 0 };
    }
    play("tap");
    render();
    // On a phone the buttons can sit just under the fold: they come up to meet the card.
    if (myChoice() && !buttons.node.hidden) buttons.node.scrollIntoView({ block: "nearest", behavior: fast() ? "auto" : "smooth" });
  }

  // What a card in your hand offers: now, or out of your turn as the table is drawn.
  function optionsFor(slot, state = st()) {
    const id = idOf(slot);
    if (id < 0) return null;
    return { id, card: CARDS[id], ...pickOptions(state, me, id) };
  }
  const names = () => ({ left: session.players[around.left].name, right: session.players[around.right].name });
  const plans = (o) => [buildPlan(st(), me, o, sel.slot, sel.build, names()), stagePlan(st(), me, o, sel.slot, sel.stage, names())];

  function act(kind) {
    const choice = myChoice();
    if (choice === "dig" && kind === "nothing") return send({ dig: -1 }, "nothing");
    if (!choice || !sel) return;
    if (choice === "dig") {
      if (kind === "dig") send({ dig: sel.slot }, "dig");
      return;
    }
    const o = optionsFor(sel.slot);
    if (!o) return;
    const [b, s] = plans(o);
    if (kind === "build") b.ok ? send(b.move, "build") : refuse(buttons.build);
    else if (kind === "free") o.free ? send(moveFor("build", sel.slot, null, true), "free") : refuse(buttons.free);
    else if (kind === "stage") s.ok ? send(s.move, "stage") : refuse(buttons.stage);
    else if (kind === "sell") send({ discard: sel.slot }, "sell");
  }
  function refuse(node) {
    play("nope");
    table.shake(node);
  }

  // Esc lets go of the card; B, W and S build, raise a stage or sell it; ? turns Explain mode on and off.
  function onKey(e) {
    if (e.target.closest?.("input, textarea, dialog, .ws") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "?") {
      e.preventDefault();
      return explain();
    }
    if (e.key === "Escape" && sel) {
      const slot = sel.slot;
      sel = null;
      render();
      (hand.card(slot) ?? status).focus({ preventScroll: true });
      return;
    }
    if (!sel || !myChoice()) return;
    const kind = { b: "build", w: "stage", s: "sell" }[e.key.toLowerCase()];
    if (kind && myChoice() !== "dig") {
      e.preventDefault();
      act(kind);
    }
  }
  addEventListener("keydown", onKey);

  // ---------- your hand ----------
  function renderHand() {
    const s = match?.state;
    const choice = myChoice();
    const dig = choice === "dig";
    const slots = dig ? choosable() : (view?.hands[me] ?? []);
    const done = picked?.key === turnKey() ? picked : null;
    // Your pick stays marked until it turns over with everyone's.
    const shown = done ?? (picked && table.pending ? picked : null);
    if (sel && !slots.includes(sel.slot)) sel = null;
    hand.draw({
      slots,
      age: Math.max(1, view?.age ?? 1),
      idOf,
      options: (slot) => (s && view && !table.pending ? optionsFor(slot, choice ? s : view) : null),
      choosing: !!choice,
      dig,
      legal: dig ? new Set(legalMoves(s, me, faceOf).filter((x) => x.dig >= 0).map((x) => x.dig)) : null,
      sel: sel?.slot ?? null,
      picked: shown ? shown.slot : null,
      hidden: (slot) => leaving.has(slot) || arriving.has(slot),
      fast: fast(),
      title: dig ? "The discards · build one free" : !view?.age ? "Your hand" : choice === "last" ? "Your seventh card" : done ? `Your hand · picked: ${pickedWords(done)}` : choice ? "Your hand · pick one" : "Your hand",
      next: dig ? "" : handCaption(view, me, nameIn),
    });
  }

  // ---------- the buttons and the detail strip ----------
  let shownKey = "";
  function sideKey() {
    const s = match?.state;
    if (!s || ended || match.phase !== "playing" || !view) return `${ended}:${match?.phase}`;
    return JSON.stringify([m, s.moves, s.phase, s.age, s.round, table.pending > 0, match.step?.commits?.map(Boolean), match.canMove(), myChoice(), sel, picked?.key === turnKey() ? picked : null, s.coins, view.hands[me].map(faceOf), s.discard.map(faceOf)]);
  }
  function renderSide() {
    const key = sideKey();
    if (key === shownKey) return;
    shownKey = key;
    const focused = detail.contains(document.activeElement) ? document.activeElement.id : null;
    light = {};
    detail.replaceChildren(...sideNodes());
    detail.hidden = !detail.childNodes.length;
    renderPicks();
    if (focused) (document.getElementById(focused) ?? buttons.node.querySelector("button:not([hidden]):not([disabled])") ?? status).focus({ preventScroll: true });
    hintFor();
  }

  const hint = (text, cls = "") => el("p", { class: `sc-hint ${cls}` }, text);
  const other = (kind) => {
    sel[kind] += 1;
    render();
  };
  // Sets the buttons and the shelf's lights, and returns the detail strip's lines.
  function sideNodes() {
    const s = match?.state;
    if (!match || ended || match.phase !== "playing" || !s || !view) return (buttons.none(), []);
    const choice = myChoice();
    const done = picked?.key === turnKey() ? picked : null;
    if (choice === "dig") {
      const id = sel ? idOf(sel.slot) : -1;
      const legal = !!sel && legalMoves(s, me, faceOf).some((x) => x.dig === sel.slot);
      buttons.dig(id >= 0 ? CARDS[id].name : null, legal);
      if (id < 0) return [hint("Your wonder lets you build one card from the discards, free. Tap one to see it.")];
      const lines = detailNodes({ id, card: CARDS[id], build: { chain: false, ok: legal, why: legal ? null : "duplicate", purchases: [] }, free: false, stage: {} }, null, null, names());
      if (!legal) lines.push(el("p", { class: "sc-detail-pay no" }, `You already have ${CARDS[id].name}.`));
      return lines;
    }
    if (choice && sel) {
      const o = optionsFor(sel.slot);
      if (!o) return (buttons.none(), [hint("That card's face is still on its way…")]);
      const [b, st2] = plans(o);
      buttons.pick(o, b, st2);
      light = costMatch(s, me, o, b, st2)?.light ?? {};
      return detailNodes(o, b, st2, names(), { onOther: other, state: s, me });
    }
    if (choice) {
      buttons.idle();
      return [hint(choice === "last" ? "Your wonder lets you play your seventh card: build it, raise a stage with it, or sell it." : "Tap a card to see what you can do with it. Its badge says what building it takes; your shelf shows what you make.")];
    }
    buttons.none();
    if (done) return [el("p", { class: "sc-hint sc-done" }, el("strong", {}, "Picked: "), pickedWords(done), ". It happens when everyone has chosen.")];
    if (s.phase === "dig" && s.digger !== me) return [hint(`${nameOf(s.digger)} is digging through the discards for a card to build free.`)];
    if (s.phase === "last" && s.lastSeat !== me) return [hint(`${nameOf(s.lastSeat)}'s wonder plays the seventh card of the age.`)];
    if (sel) {
      const o = optionsFor(sel.slot, view);
      light = costMatch(view, me, o, null, null)?.light ?? {};
      return detailNodes(o, null, null, names(), { state: view, me });
    }
    return [];
  }

  // "build Barracks", "sell Loom for 3": what you picked this turn.
  function pickedWords(done) {
    const name = CARDS[done.id]?.name ?? "it";
    return { build: `build ${name}`, free: `build ${name}`, stage: `raise a wonder stage with ${name}`, sell: `sell ${name} for 3`, dig: `build ${name} from the discards` }[done.kind] ?? "build nothing";
  }

  // The first purchase and the first chain each get a hint, once ever.
  function hintFor() {
    if (!sel || !myChoice() || myChoice() === "dig") return;
    const o = optionsFor(sel.slot);
    if (!o) return;
    if (o.build.chain) return coach("chain", buttons.build);
    const [b] = plans(o);
    // The purchase's hint points at the river your coins will cross, or failing that (scrolled away) the purchase.
    if (!b.ok || !b.buy || ![...b.buy.left, ...b.buy.right].some(Boolean)) return;
    const river = art.borders.get(b.buy.left.some(Boolean) ? "left" : "right")?.node;
    const r = river?.getBoundingClientRect();
    coach("buy", r && r.top >= 0 && r.bottom <= innerHeight ? river : (detail.querySelector(".sc-unit.buy") ?? buttons.build));
  }

  // Who has chosen this turn: everyone's mark, ticked once they've picked (a commitment, public).
  function renderPicks() {
    const step = match?.step;
    const show = !!match?.state && !!step && match.phase === "playing" && !table.pending && step.movers.length > 1;
    picks.draw(show ? step.movers.map((p) => ({ p, name: nameOf(p), done: !!step.commits[p], me: p === me })) : null);
  }

  // ---------- a seat's whole city ----------
  const openSeat = (p) => seatDialog.open(p, view);

  // ---------- render ----------
  function describe(ev) {
    if (!ev) return null;
    if (ev.type === "picks") {
      const x = ev.picks[0];
      if (ev.picks.length > 1 || !x) return "Everyone has picked";
      return x.how === "dig" ? `${nameOf(x.p)} ${verb(x.p, "builds")} from the discards` : `${nameOf(x.p)} ${verb(x.p, "plays")} the seventh card`;
    }
    if (ev.type === "pass") return `Hands pass ${ev.dir > 0 ? "left" : "right"}`;
    if (ev.type === "age") return `Age ${ROMAN[ev.age]}: ${HAND} cards each`;
    if (ev.type === "sevenths") return "Last cards discarded";
    if (ev.type === "war") return warLine || warWords(ev.results, me, ev.age, nameIn);
    if (ev.type === "over") return "Final scores";
    if (ev.type === "last") return ev.p === me ? "Play your seventh card" : `${nameOf(ev.p)} plays a seventh card`;
    if (ev.type === "dig") return ev.p === me ? "Dig through the discards: build one free" : `${nameOf(ev.p)} is digging through the discards`;
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
    if (match.phase === "over") return finalScores ? resultWords(finalScores, s.winners, me, nameOf) : "Final scores";
    const d = decision();
    if (!d) return match.busy === "dealing" ? "Dealing…" : "…";
    const choice = myChoice();
    if (s.phase === "dig") return s.digger === me ? (choice ? "Dig through the discards: build one free" : "…") : `${nameOf(s.digger)} is digging through the discards`;
    if (s.phase === "last") return s.lastSeat === me ? (choice ? "Play your seventh card" : "…") : `${nameOf(s.lastSeat)} plays a seventh card`;
    if (choice) return "Pick a card";
    const waiting = d.movers.filter((p) => p !== me);
    if (match.step?.commits[me]) return waiting.length === 1 ? `Picked. Waiting for ${nameOf(waiting[0])}` : waiting.length ? `Picked. Waiting for ${waiting.length} players` : "Everyone has picked";
    return mine(d) ? "…" : waiting.length ? `Waiting for ${listOf(waiting.map(nameOf))}` : "Everyone has picked";
  }

  let topKey = "";
  function renderTop() {
    const age = view?.age ?? 0;
    const key = `${age}:${view?.round}`;
    if (key !== topKey) {
      topKey = key;
      rootBox.dataset.age = String(age);
    }
    if (view) art.drawPile(view);
    art.pile.classList.toggle("dig", view?.phase === "dig");
  }

  function renderTable() {
    if (!view) return;
    const step = match?.step;
    // Once you have picked, the stack coming to you next is ringed.
    const done = picked?.key === turnKey() && !table.pending;
    const coming = done && view.age && view.round < ROUNDS && view.phase === "pick" ? (passDir(view.age) > 0 ? around.right : around.left) : null;
    art.drawSeats(view, { picked: (p) => (!!step?.commits[p] && !table.pending) || revealing.has(p), coming });
    art.drawMine(view);
    art.drawRing(view);
    seatDialog.draw(view);
    scoreNow.draw(view);
  }

  function renderDeck() {
    const starting = match?.phase === "starting";
    const busy = match?.busy && match.phase !== "over" && !starting ? match.busy : null;
    table.renderBusy(starting ? null : busy, { starting, redraw: () => !destroyed && render() });
    drawDeck((starting && !ended) || match?.busy === "shuffling");
  }
  // The deck riffles where the hand will be while every browser shuffles it: a loading indicator, so it runs only then.
  let deckAnims = [];
  function drawDeck(on) {
    const age = Math.max(1, (view?.age ?? 0) + (match?.busy === "shuffling" && view?.age ? 1 : 0));
    if (deck.dataset.age !== String(age)) {
      deck.dataset.age = String(age);
      [...deck.children].forEach((c) => c.replaceChildren(cardEl(null, { age: Math.min(3, age) })));
    }
    if (on === !deck.hidden) return;
    deck.hidden = !on;
    deckAnims.forEach((a) => a.cancel());
    deckAnims = [];
    if (!on || fast()) return;
    const d = tokenMs("slow") * 3.4;
    deckAnims = [...deck.children].map((c, i) => {
      const side = i % 2 ? 1 : -1;
      const out = `translate(${side * 62}%, ${-6 - i * 2}px) rotate(${side * 12}deg)`;
      return c.animate([{ transform: `translate(0, ${-i * 2}px)` }, { transform: out, offset: 0.3 }, { transform: out, offset: 0.42 + i * 0.03 }, { transform: `translate(0, ${-i * 2}px)` }], { duration: d, iterations: Infinity, easing: easing("out") });
    });
  }

  function render() {
    if (destroyed) return;
    const s = match?.state;
    const phase = ended ? "ended" : match?.phase || "setup";
    rootBox.dataset.phase = phase;
    shell.setInProgress?.(phase === "starting" || phase === "playing");
    if (s && !view && !table.pending) view = viewOf(s);
    if (picked && picked.key !== turnKey() && !table.pending) picked = null;
    const choice = myChoice();
    if (!choice && !picked && sel && match?.state?.phase === "dig") sel = null;
    bar.update({ turn: -1, thinking: current || match?.busy ? -1 : thinkingSeat(), checked: match?.checked ?? [] });
    renderTop();
    renderTable();
    renderDeck();
    renderHand();
    renderSide();
    if (view) art.drawShelf(view, light);
    const text = table.dealtLine(match, statusText());
    if (status.textContent !== text) status.textContent = text;
    status.className = `${table.cls("status")} ${choice ? `mine p-${me}` : ""}`;
    rootBox.classList.toggle("my-turn", !!choice);
    // While you wait for the others, their picks turn over and the hands
    // pass, your hand folds to a strip, so your city and the borders show on
    // a laptop; it opens as the cards passed to you land.
    // A keyboard's focus in the part that folds keeps it open, so focus isn't lost.
    rootBox.classList.toggle("sc-waiting", !choice && !keyboardInHand() && match?.phase === "playing" && !!view?.hands[me]?.length && (!table.pending || current?.type === "picks" || (current?.type === "pass" && !arriving.size)));
    renderTimer();
    renderResult();
    setTabAlert(choice ? "Your pick" : null);
    if (choice) {
      const key = turnKey();
      if (cuedTurn !== key) play("turn");
      cuedTurn = key;
    }
    autoMove();
  }

  function keyboardInHand() {
    const f = document.activeElement;
    if (!f || !handArea.contains(f) || f.closest(".sc-hand-head")) return false;
    try {
      return f.matches(":focus-visible");
    } catch {
      return true;
    }
  }

  // The robot whose pick is awaited: the first in the step that hasn't chosen.
  function thinkingSeat() {
    const d = decision();
    if (!d) return -1;
    const robot = (p) => p !== me && (robotGame || session.players[p]?.robot);
    return d.movers.find(robot) ?? -1;
  }

  // A dig with nothing to build is made for you, after a person's pause.
  function autoMove() {
    const d = decision();
    if (!mine(d) || !match.canMove()) return;
    const move = forcedMove(match.state, me, faceOf);
    if (!move) return;
    const key = turnKey();
    if (autoKey === key) return;
    autoKey = key;
    const g = table.gen;
    clearTimeout(autoTimer);
    const ms = robotPause(FORCED_MS[0] + Math.random() * (FORCED_MS[1] - FORCED_MS[0]));
    autoTimer = setTimeout(() => {
      if (live(g) && mine() && match.canMove() && turnKey() === key) {
        picked = { key, slot: -1, kind: "nothing", id: -1 };
        return match.play(forcedMove(match.state, me, faceOf) ?? move);
      }
      if (autoKey === key) autoKey = "";
    }, ms);
  }

  // ---------- the clock ----------
  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    const ready = !!d && !match.busy && d.movers.length > 0;
    const key = `${turnKey()}:${ready}`;
    timer.hidden = !secs || !ready || match.phase !== "playing";
    if (timer.hidden) return;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    const who = d.movers.includes(me) ? me : d.movers[0];
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (secs * 1000))).toFixed(3)})`;
    timer.className = `sc-timer p-${who} ${left < 5000 ? "low" : ""}`;
    const secsText = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
    if (timerText.textContent !== secsText) timerText.textContent = secsText;
    timer.setAttribute("aria-label", who === me ? "Time for your pick" : d.movers.length > 1 ? "Time for everyone's pick" : `Time for ${nameOf(who)}'s pick`);
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
    if (mine(d) && left <= 0 && timedOut !== deadlineKey && brain && myChoice()) {
      timedOut = deadlineKey;
      // A stalled player would hold everyone up: a card is picked for them.
      const move = brain.timeoutMove(match.state, me, (slot) => match.face(slot));
      if (!move) return;
      toast("Time's up: a card was picked for you");
      send(move, move.build !== undefined ? "build" : move.stage !== undefined ? "stage" : move.discard !== undefined ? "sell" : move.dig >= 0 ? "dig" : "nothing");
    } else if (!mine(d) && left <= -CLAIM_GRACE_MS) {
      const quiet = `Waiting for ${listOf(d.movers.map(nameOf))}'s browser…`;
      if (status.textContent !== quiet) status.textContent = quiet;
    }
  }
  const ticker = setInterval(tick, 200);

  // ---------- the end ----------
  function winnerNodes() {
    const s = match?.state;
    if (!s || match.phase !== "over") return [];
    return s.winners.flatMap((p) => (p === me ? [...art.mine.querySelectorAll(".sc-chip:not(.ghost)")] : [art.panels.get(p)?.node]));
  }

  const verdictText = (v) => verdictOf(v, nameOf);
  function verdictLine() {
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "sc-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle and pass proved, and the game replayed with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "sc-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    if (match.phase === "aborted") return null;
    return el("p", { class: "verdict", id: "sc-verdict" }, thinkingDots(), "Checking every shuffle and replaying the game…");
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
        extra = match.disputing || match.verdict ? el("div", { class: "sc-over pc-game" }, match.verdict ? verdictLine() : el("p", { class: "verdict" }, thinkingDots(), "Checking who was right about the passed card…")) : null;
      }
      const who = (p) => (p === me && p !== match.abortSeat ? "you" : nameOf(p));
      return result.show({ stopped: true, reason: abortText({ reason: match.abortReason, seat: match.abortSeat, about: match.abortAbout }, who), extra });
    }
    const s = match.state;
    const scores = finalScores ?? seats.map((p) => score(s, p));
    const key = `${m}:${!!match.verdict}`;
    if (shownFor !== key) {
      shownFor = key;
      const order = seatOrder(scores);
      const node = sheet?.node ?? scoreSheet(scores, order, { me, nameOf, winners: s.winners }).node;
      extra = el("div", { class: "sc-over pc-game" }, el("div", { class: "sc-sheet-box", tabindex: "0", role: "region", "aria-label": "Final scores" }, node), verdictLine());
    }
    const places = seatOrder(scores).map((p) => ({ seat: p, note: plural(scores[p].total, "point") }));
    const winner = s.winners.length === 1 ? s.winners[0] : -1;
    const best = Math.max(...scores.map((x) => x.total));
    result.show({ winner, reason: `${resultWords(scores, s.winners, me, nameOf).replace(/!$/, "")} with ${plural(best, "point")}${s.winners.length > 1 ? " each" : ""}.`, places, extra });
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
    shownKey = "";
    lastVerdict = "";
    finalScores = null;
    sheet = null;
    sel = null;
    picked = null;
    light = {};
    warLine = "";
    wars.length = 0;
    revealing.clear();
    leaving.clear();
    arriving.clear();
    hand.clear();
    seatDialog.close();
    scoreNow.close();
    art.war.close();
    tips.hide();
    status.setAttribute("aria-live", "polite");
    logList.removeAttribute("aria-live");
    tuckedAge.clear();
    logList.replaceChildren();
    const opponents = listOf(seats.filter((p) => p !== me).map((p) => session.players[p].name));
    note.textContent = m === 1 ? `Playing ${opponents}. Good luck!` : `Rematch #${m - 1}: new wonders, and a fresh deck shuffled by every browser.`;
    const mt = new CardMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    previous = match;
    match = mt;
    window.ddp.match = mt; // browser tests read this
    mt.on("update", () => {
      if (mt !== match) return;
      if (!mt.state) seatDialog.close();
      render();
    });
    mt.on("invalid", (reason) => {
      if (mt !== match) return;
      picked = null;
      play("nope");
      toast(reason);
      render();
    });
    mt.on("start", () => {
      if (mt !== match) return;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      const w = mt.state.wonders[me];
      note.textContent = `${again}Your wonder: ${WONDERS[w.w].name}, side ${w.side} (dealt by every browser).${lastVerdict && ` ${lastVerdict}.`}`;
    });
    mt.on("events", ({ events }) => {
      if (mt !== match) return;
      enqueueAll(events);
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
    const parts = [SIDE_NAME[c.side]];
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s a move`);
    const robotSeats = robotGame ? count - 1 : session.players.filter((p) => p.robot).length;
    if (robotSeats) parts.push(`${LEVEL_NAME[c.level]} ${robotSeats > 1 ? "robots" : "robot"}`);
    return parts.join(" · ");
  }

  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config, count);
    if (config.moveSeconds) loadBrain();
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
    drawDeck(false);
    art.war.close();
    const judged = match?.phase === "starting" && previous ? previous : match;
    leaveNotice({ root, session, seat: seatLeft, match: judged, prefix: "sc", game: "Stonecrown", nameOf, facts: (s, p) => (s.age ? `${plural(score(s, p).total, "point")} so far` : "the game hadn't started") });
    render();
  }

  screenBusy = () => table.pending > 0;
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
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
      drawDeck(false);
      screenBusy = () => false;
      clearInterval(ticker);
      clearTimeout(autoTimer);
      setTabAlert(null);
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      seatDialog.close();
      scoreNow.close();
      art.war.close();
      art.war.node.remove();
      tips.destroy();
      for (const off of offs) off();
    },
  };
}
