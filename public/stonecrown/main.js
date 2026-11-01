// Stonecrown page: mounts the engine shell and renders a CardMatch. The rules
// live in rules.js, the data in cards.js, the art in card-art.js and
// pieces.js, and the table they make (the neighbours' panels, your wonder
// and city, and their motion) in art.js, which the tutorial shares. This
// file is the view: your hand and what a card in it can do, who has picked,
// the seventh card and the dig, the top bar, the log, the clock, the score
// sheet and the result. The match state never waits for the screen: every
// event is queued and played out in order, faster when they pile up, and at
// once with reduced motion or a hidden tab. Nothing hidden reaches the page:
// another seat's picks, tucked and sold cards show only as backs, even when
// this browser knows a face from holding the card before.
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
import { makeRules, normalizeConfig, forcedMove, legalMoves, designOf, passDir, stagesOf, shields, score, MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";
import { PACE, ROMAN, plural, listOf, cardWords, stageWords, effectWords, costWords, sideCoins, payWords, buyWords, moveFor, pickOptions, WHY, whyWords, warWords, warPairs, pairWords, resultWords, viewOf, turnWords, seatWords, chainsFrom, chainsTo, cardEl, turnCardEl, costEl, effectEl, coinEl, seatMark, cityEl, boardSvg, tableEl, scTable, scoreSheet } from "./art.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";

// How long robots take over each choice (robotPause() scales these in tests).
const ROBOT_PACE = { pick: 1700, last: 1300, dig: 1600, spread: 1400 };
// A dig with nothing to build is made for you, after as long as a person
// would look: an instant one would tell everyone the discards hold nothing for you.
const FORCED_MS = [1400, 3200];
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
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
  // Your choices on the way to a move.
  let sel = null; // { slot, build: purchase index, stage: purchase index }
  let picked = null; // { key, slot, kind, id } once you have chosen this turn
  let revealing = new Set(); // seats whose pick marks stay up while their picks turn over
  let leaving = new Set(); // your hand's slots on their way out
  let arriving = new Set(); // your hand's slots on their way in

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

  const dialog = el("dialog", { class: "card sc-dialog", id: "sc-dialog", "aria-labelledby": "sc-dialog-title" });
  const art = scTable(table, { me, players: count, nameOf, onSeat: (p) => openSeat(p) });
  const { around } = art;

  // The top bar: the age and turn, which way hands go, the discard pile, and with four, the player across.
  const ageBadge = el("span", { class: "sc-age-badge", "aria-hidden": "true" });
  const ageLine = el("b", { class: "sc-age" });
  const turnLine = el("small", { class: "sc-turn-line" });
  const passLine = el("span", { class: "sc-pass" });
  const acrossPill = around.across >= 0 ? el("button", { class: `sc-across-pill p-${around.across}`, type: "button", id: "sc-across", onclick: () => openSeat(around.across) }) : null;
  const top = el("div", { class: "sc-top", id: "sc-top" }, el("div", { class: "sc-top-age", role: "group", "aria-label": "Age and turn" }, ageBadge, el("span", { class: "sc-top-words" }, ageLine, turnLine)), passLine, acrossPill, art.bankBox, art.pile);

  // Your hand, the buttons for the card you pick, and what it would do.
  const handHead = el("span", { class: "sc-hand-title" });
  const handNext = el("span", { class: "sc-hand-next" });
  const hand = el("div", { class: "sc-hand", id: "sc-hand", role: "group", "aria-label": "Your hand" });
  const deck = el("div", { class: "sc-deck", hidden: true, "aria-hidden": "true" }, [0, 1, 2, 3, 4].map(() => el("span", { class: "sc-deck-card" })));
  const picks = el("ul", { class: "sc-picks", id: "sc-picks", "aria-label": "Who has picked" });
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "sc-timer", id: "sc-timer", hidden: true, role: "timer", "aria-label": "Time for the move" }, el("span", { class: "bar" }, timerFill), timerText);
  const buttons = el("div", { class: "sc-buttons", id: "sc-buttons", role: "group", "aria-label": "What to do with the card" });
  const detail = el("div", { class: "sc-detail", id: "sc-detail", "aria-live": "polite" });
  const handArea = el(
    "section",
    { class: "sc-hand-area", "aria-label": "Your move" },
    el("div", { class: "sc-hand-head" }, el("h2", { class: "sc-title" }, handHead), handNext),
    el("div", { class: "sc-hand-wrap" }, hand, deck, table.busyChip),
    el("div", { class: "sc-side" }, timer, buttons, detail, picks),
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

  const left = art.panels.get(around.left);
  const right = art.panels.get(around.right);
  const across = art.panels.get(around.across);
  const rootBox = el(
    "div",
    { class: "stonecrown pc-game", dataset: { seat: me, players: count } },
    tableEl(),
    bar.node,
    top,
    status,
    el("div", { class: "sc-main" }, left?.node, across?.node, art.mine, right?.node, handArea),
    logBox,
    configLine,
    note,
    result.node,
    dialog,
    table.flyLayer,
  );
  root.append(rootBox);

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
      revealing = new Set();
      leaving = new Set();
      arriving = new Set();
      if (match?.state) view = viewOf(match.state);
      for (const robot of window.ddp.robots || []) robot.poke?.();
    }
    render();
  }

  // A step's picks arrive as one batch of events: they turn over and land together.
  function enqueueAll(events) {
    let batch = null;
    for (const ev of events) {
      const isPick = ev.type === "build" || ev.type === "stage" || (ev.type === "discard" && !ev.seventh);
      if (isPick || (ev.type === "gain" && batch)) {
        if (!batch) table.enqueue((batch = { type: "picks", picks: [], gains: [] }));
        (isPick ? batch.picks : batch.gains).push(ev);
        continue;
      }
      batch = null;
      if (ev.type === "discard") {
        const last = enqueueAll.sevenths;
        if (last && !last.done) last.list.push(ev);
        else table.enqueue((enqueueAll.sevenths = { type: "sevenths", list: [ev] }));
        continue;
      }
      enqueueAll.sevenths = null;
      table.enqueue(ev);
    }
    enqueueAll.sevenths = null;
  }

  const rectOf = (p, part, arg) => art.rectsOf(p)?.[part]?.(arg) ?? null;
  const handCard = (slot) => hand.querySelector(`[data-slot="${slot}"]`);
  const handRect = (slot) => {
    const b = handCard(slot);
    return b ? table.rectIn(b) : rectOf(me, "pick");
  };

  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    // The first deal comes before anything is drawn.
    if (!view) view = viewOf(match.state);
    if (ev.type === "picks") await revealPicks(ev, g, k);
    else if (ev.type === "age") await dealAge(ev, g, k);
    else if (ev.type === "pass") await passHands(ev, g, k);
    else if (ev.type === "sevenths") await sevenths(ev, g, k);
    else if (ev.type === "war") await war(ev, g, k);
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

  // Everyone's pick: the builds turn face up together, then each card flies
  // to its place (a city, under a wonder, the discard pile) with the coins it
  // cost, and the coins earned come in after.
  async function revealPicks(ev, g, k) {
    const list = ev.picks;
    revealing = new Set(list.map((x) => x.p).filter((p) => p !== me));
    render();
    const from = new Map(list.map((x) => [x.p, x.p === me ? (x.how === "dig" ? art.pileRect() : handRect(x.slot)) : x.how === "dig" ? art.pileRect() : rectOf(x.p, "pick")]));
    play("reveal");
    const flips = list.filter((x) => x.p !== me && x.type === "build").map((x) => ({ id: x.id, age: view.age, rect: from.get(x.p) }));
    revealing = new Set();
    render();
    await art.flipAll(flips, { g, ms: PACE.flip * k });
    if (!live(g)) return;
    const flights = [];
    for (const x of list) {
      const p = x.p;
      const start = from.get(p);
      if (p === me && x.how !== "dig") leaving.add(x.slot);
      const bought = x.bought ?? { left: 0, right: 0 };
      const paid = (x.coins ?? 0) + bought.left + bought.right;
      view.coins[p] -= paid;
      if (x.coins) flights.push(art.flyCoins(x.coins, rectOf(p, "coins"), art.bankRect(), { g, ms: PACE.coin * k }));
      if (bought.left) flights.push(art.flyCoins(bought.left, rectOf(p, "coins"), rectOf(around.left === p ? (p + 1) % count : (p + 1) % count, "coins") ?? art.bankRect(), { g, ms: PACE.coin * k }));
      if (bought.right) flights.push(art.flyCoins(bought.right, rectOf(p, "coins"), rectOf((p + count - 1) % count, "coins") ?? art.bankRect(), { g, ms: PACE.coin * k }));
      if (bought.left || bought.right) play("trade", { n: bought.left + bought.right });
      if (x.type === "build") {
        const color = CARDS[x.id].color;
        play("build", { color, how: x.how });
        flights.push(art.flyCard(x.id, view.age, start, rectOf(p, "city", color), { g, ms: PACE.fly * k, width: p === me ? null : 40 }).then(() => {
          view.city[p].push({ slot: x.slot, id: x.id });
          if (x.how === "dig") view.discard = view.discard.filter((s) => s !== x.slot);
          render();
        }));
        addLog({ player: p, kind: "build", text: buildWords(x) });
      } else if (x.type === "stage") {
        play("stage", { n: x.n });
        const id = p === me ? idOf(x.slot) : -1;
        flights.push(art.flyCard(id, view.age, start, rectOf(p, "wonder"), { g, ms: PACE.stage * k, turn: p === me && id >= 0 ? "down" : null, width: p === me ? null : 36 }).then(() => {
          view.stages[p].push(x.slot);
          render();
          art.bump(p === me ? art.boardBox : art.panels.get(p)?.node.querySelector(".sc-stage-dots"), p === me ? 1.04 : 1.25);
        }));
        const stage = stagesOf(view, p)[x.n];
        const tucked = p === me && idOf(x.slot) >= 0 ? `, tucking ${CARDS[idOf(x.slot)].name}` : "";
        addLog({ player: p, kind: "stage", text: `${nameOf(p)} ${verb(p, "builds")} wonder stage ${ROMAN[x.n + 1]}${tucked}${stage ? `: ${effectWords(stage)}` : ""}${paidWords(p, 0, bought)}` });
      } else {
        play("sell");
        const id = p === me ? idOf(x.slot) : -1;
        flights.push(art.flyCard(id, view.age, start, art.pileRect(), { g, ms: PACE.fly * k, turn: p === me && id >= 0 ? "down" : null, width: 34 }).then(() => {
          view.discard.push(x.slot);
          render();
        }));
        addLog({ player: p, kind: "sell", text: `${nameOf(p)} ${verb(p, "sells")} ${p === me && id >= 0 ? CARDS[id].name : "a card"} for 3 coins` });
      }
      if (p === me) view.hands[me] = view.hands[me].filter((s) => s !== x.slot);
    }
    render();
    await Promise.all(flights);
    if (!live(g)) return;
    leaving = new Set();
    await gains(ev.gains, g, k);
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

  // Coins coming in: sales and cards from the bank, purchases from the buyer.
  async function gains(list, g, k) {
    if (!list.length) return;
    const flights = list.map((x) => {
      const from = x.why === "trade" ? rectOf(x.from, "coins") : art.bankRect();
      play(x.why === "trade" ? "coins" : "coins", { n: x.coins });
      return art.flyCoins(x.coins, from, rectOf(x.p, "coins"), { g, ms: PACE.coin * k }).then(() => {
        view.coins[x.p] += x.coins;
        render();
      });
    });
    for (const x of list) {
      if (x.why === "sale") continue;
      const why = x.why === "trade" ? ` from ${nameIn(x.from)}` : x.why === "stage" ? " from the wonder" : " from the card";
      addLog({ player: x.p, kind: "coins", text: `${nameOf(x.p)} ${verb(x.p, "gets")} ${plural(x.coins, "coin")}${why}` });
    }
    await Promise.all(flights);
  }

  // A new age: its cards are dealt round the table from the deck.
  async function dealAge(ev, g, k) {
    view.age = ev.age;
    view.round = 1;
    view.phase = "pick";
    const st = match.state;
    if (st.age === ev.age && st.round === 1) view.hands = st.hands.map((h) => h.slice());
    const mineNow = view.hands[me];
    mineNow.forEach((s) => arriving.add(s));
    sel = null;
    play("deal", { age: ev.age });
    addLog({ kind: "age", text: `Age ${ROMAN[ev.age]}: ${HAND} cards each${ev.age === 3 ? ", with guilds" : ""}. Hands pass ${passDir(ev.age) > 0 ? "left" : "right"}.` });
    render();
    if (!fast()) {
      const deckRect = table.rectIn(hand);
      const center = { x: deckRect.x + deckRect.w / 2 - 20, y: deckRect.y - 10, w: 40, h: 56 };
      const jobs = [];
      let i = 0;
      for (let r = 0; r < HAND; r++) {
        for (const p of seats) {
          const slot = view.hands[p][r];
          if (slot === undefined) continue;
          const to = p === me ? handRect(slot) : rectOf(p, "seat");
          jobs.push(wait(i++ * PACE.dealGap * k, g).then(async () => {
            await art.flyCard(null, ev.age, center, to, { g, ms: PACE.deal * k, width: p === me ? null : 30, fade: p !== me });
            if (p === me) {
              arriving.delete(slot);
              render();
            }
          }));
        }
      }
      await Promise.all(jobs);
    }
    arriving = new Set();
    render();
  }

  // Hands slide round: yours to one neighbour, the other's to you.
  async function passHands(ev, g, k) {
    const dir = ev.dir;
    const to = dir > 0 ? around.left : around.right;
    const from = dir > 0 ? around.right : around.left;
    play("pass", { dir });
    const flights = [];
    if (!fast()) {
      view.hands[me].forEach((slot, i) => {
        const id = idOf(slot);
        flights.push(art.flyCard(id, view.age, handRect(slot), rectOf(to, "seat"), { g, ms: PACE.pass * k, delay: i * 40 * k, width: 44, fade: true }));
        leaving.add(slot);
      });
      for (const q of seats) {
        if (q === me || q === from) continue;
        const next = (q + dir + count) % count;
        if (next === me) continue;
        flights.push(art.flyCard(null, view.age, rectOf(q, "seat"), rectOf(next, "seat"), { g, ms: PACE.pass * k, width: 30, fade: true }));
      }
    }
    render();
    await Promise.all(flights);
    if (!live(g)) return;
    view.hands = seats.map((p) => view.hands[(p - dir + count) % count]);
    view.round++;
    sel = null;
    leaving = new Set();
    view.hands[me].forEach((s) => arriving.add(s));
    render();
    if (!fast()) {
      await Promise.all(view.hands[me].map((slot, i) => art.flyCard(null, view.age, rectOf(from, "seat"), handRect(slot), { g, ms: PACE.pass * k, delay: i * 40 * k, width: 44 }).then(() => {
        arriving.delete(slot);
        render();
      })));
    }
    arriving = new Set();
    render();
    addLog({ kind: "pass", text: `Hands pass ${dir > 0 ? "left" : "right"}: you get ${nameIn(from)}'s` });
  }

  // The last card of each hand goes to the discard pile, face down.
  async function sevenths(ev, g, k) {
    play("sell");
    const flights = ev.list.map((x) => {
      const start = x.p === me ? handRect(x.slot) : rectOf(x.p, "seat");
      if (x.p === me) leaving.add(x.slot);
      const id = x.p === me ? idOf(x.slot) : -1;
      return art.flyCard(id, view.age, start, art.pileRect(), { g, ms: PACE.fly * k, turn: id >= 0 ? "down" : null, width: 34 });
    });
    render();
    await Promise.all(flights);
    for (const x of ev.list) {
      view.hands[x.p] = view.hands[x.p].filter((s) => s !== x.slot);
      view.discard.push(x.slot);
    }
    leaving = new Set();
    render();
    const mineGone = ev.list.find((x) => x.p === me);
    addLog({ kind: "sell", text: `Last cards discarded${mineGone && idOf(mineGone.slot) >= 0 ? ` (yours: ${CARDS[idOf(mineGone.slot)].name})` : ""}` });
  }

  async function war(ev, g, k) {
    const strength = seats.map((p) => shields(view, p));
    const pairs = warPairs(ev.results);
    addLog({ kind: "war", text: warWords(ev.results, me, ev.age, nameIn) });
    for (const pair of pairs) if (!pair.includes(me)) addLog({ kind: "war", text: pairWords(pair, ev.age, nameOf) });
    await art.war({
      age: ev.age,
      pairs,
      strength,
      g,
      k,
      sound: play,
      onToken: (p, v) => {
        view.tokens[p].push(v);
        render();
      },
    });
  }

  // The score sheet, a row at a time, then the result.
  let sheet = null;
  async function over(ev, g, k) {
    finalScores = ev.scores;
    const order = seatOrder(ev.scores);
    sheet = scoreSheet(ev.scores, order, { me, nameOf, winners: ev.winners });
    addLog({ kind: "win", text: resultWords(ev.scores, ev.winners, me, nameOf) });
    if (fast() || !live(g)) return;
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
    log.unshift(entry);
    for (const old of log.slice(1)) old.node.classList.remove("fresh");
    log = log.slice(0, 80);
    logList.replaceChildren(...log.map((e) => e.node));
  }

  // ---------- your moves ----------
  const st = () => match.state;
  function send(move, kind) {
    const slot = move.build ?? move.stage ?? move.discard ?? move.dig;
    picked = { key: turnKey(), slot, kind, id: slot >= 0 ? idOf(slot) : -1 };
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

  function select(slot) {
    const choice = myChoice();
    if (!choice) {
      if (picked?.key === turnKey()) return;
      sel = sel?.slot === slot ? null : { slot, build: 0, stage: 0 };
      play("tap");
      return render();
    }
    if (sel?.slot === slot) return;
    sel = { slot, build: 0, stage: 0 };
    play("tap");
    render();
  }

  function optionsFor(slot) {
    const id = idOf(slot);
    if (id < 0) return null;
    return { id, card: CARDS[id], ...pickOptions(st(), me, id) };
  }
  const names = () => ({ left: session.players[around.left].name, right: session.players[around.right].name });

  // What the build and stage buttons would send, and their words.
  function buildPlan(o) {
    const b = o.build;
    if (b.chain) return { ok: true, move: moveFor("build", sel.slot), label: "Build free", sub: `Chain from ${listOf(chainsFrom(o.card))}`, pay: 0 };
    if (!b.ok || !b.purchases.length) return { ok: false, label: WHY[b.why] ?? "Can't build", sub: b.why === "duplicate" ? "" : costWords(o.card.cost), why: whyWords(b.why, o.card) };
    const p = b.purchases[sel.build % b.purchases.length];
    const side = sideCoins(st(), me, p);
    const words = payWords({ bank: b.coins, ...side }, names());
    return { ok: true, move: moveFor("build", sel.slot, p), label: "Build", sub: words || "Free", buy: p, side, pay: b.coins + side.left + side.right, ways: b.purchases.length };
  }
  function stagePlan(o) {
    const s = o.stage;
    if (!s.ok) return { ok: false, label: s.why === "built" ? "Wonder finished" : "Can't afford", sub: s.stage ? `Stage ${ROMAN[s.n + 1]}: ${costWords(s.stage.cost)}` : "", why: whyWords(s.why) };
    const p = s.purchases[sel.stage % s.purchases.length];
    const side = sideCoins(st(), me, p);
    const words = payWords(side, names());
    return { ok: true, move: moveFor("stage", sel.slot, p), label: `Wonder stage ${ROMAN[s.n + 1]}`, sub: words || "Free", buy: p, side, ways: s.purchases.length };
  }

  function act(kind) {
    const choice = myChoice();
    if (!choice || !sel) return;
    if (choice === "dig") {
      if (kind === "nothing") return send({ dig: -1 }, "nothing");
      return send({ dig: sel.slot }, "dig");
    }
    const o = optionsFor(sel.slot);
    if (!o) return;
    if (kind === "build") {
      const plan = buildPlan(o);
      if (!plan.ok) return refuse();
      send(plan.move, "build");
    } else if (kind === "free") {
      if (!o.free) return refuse();
      send(moveFor("build", sel.slot, null, true), "free");
    } else if (kind === "stage") {
      const plan = stagePlan(o);
      if (!plan.ok) return refuse();
      send(plan.move, "stage");
    } else if (kind === "sell") send({ discard: sel.slot }, "sell");
  }
  function refuse() {
    play("nope");
    table.shake(buttons);
  }

  // Esc lets go of the card; B, W and S build, raise a stage or sell it.
  function onKey(e) {
    if (e.target.closest?.("input, textarea, dialog") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "Escape" && sel) {
      const slot = sel.slot;
      sel = null;
      render();
      (handCard(slot) ?? status).focus({ preventScroll: true });
      return;
    }
    if (!sel || !myChoice()) return;
    const key = e.key.toLowerCase();
    const kind = { b: "build", w: "stage", s: "sell" }[key];
    if (kind && myChoice() !== "dig") {
      e.preventDefault();
      act(kind);
    }
  }
  addEventListener("keydown", onKey);

  // Arrows, Home and End move along the hand; Enter and Space pick a card (the button's click).
  hand.addEventListener("keydown", (e) => {
    const btn = e.target.closest(".sc-hcard");
    if (!btn) return;
    const list = [...hand.querySelectorAll(".sc-hcard")];
    const i = list.indexOf(btn);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -i, End: list.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const target = list[Math.max(0, Math.min(list.length - 1, i + step))];
    focusSlot = Number(target.dataset.slot);
    for (const b of list) b.tabIndex = b === target ? 0 : -1;
    target.focus();
  });
  hand.addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-hcard");
    if (!btn) return;
    focusSlot = Number(btn.dataset.slot);
    select(focusSlot);
  });

  // ---------- your hand ----------
  let focusSlot = null;
  const handButtons = new Map();
  function renderHand() {
    const s = match?.state;
    const choice = myChoice();
    const dig = choice === "dig";
    const slots = dig ? choosable() : (view?.hands[me] ?? []);
    const done = picked?.key === turnKey() ? picked : null;
    const legal = dig ? new Set(legalMoves(s, me, faceOf).filter((x) => x.dig >= 0).map((x) => x.dig)) : null;
    if (sel && !slots.includes(sel.slot)) sel = null;
    const hadFocus = hand.contains(document.activeElement) ? Number(document.activeElement.dataset.slot) : null;
    for (const [slot, b] of handButtons) {
      if (!slots.includes(slot) || b.dataset.dig !== String(dig)) {
        b.remove();
        handButtons.delete(slot);
      }
    }
    const age = Math.max(1, view?.age ?? 1);
    slots.forEach((slot, i) => {
      let b = handButtons.get(slot);
      const id = idOf(slot);
      if (!b) {
        b = el("button", { class: "sc-hcard", type: "button", dataset: { slot, dig: String(dig) } }, turnCardEl(id, age, { down: id < 0 }));
        handButtons.set(slot, b);
      }
      const turn = b.firstChild;
      if (turn.dataset.id !== String(id)) {
        const was = turn.dataset.id;
        turn.dataset.id = String(id);
        turn.querySelector(".front").replaceChildren(id >= 0 ? cardEl(id) : cardEl(null, { age }));
        turn.querySelector(".back").replaceChildren(cardEl(null, { age }));
        // A face that has just arrived turns over in place.
        if (was !== undefined && id >= 0 && !fast()) {
          turn.classList.add("down");
          void turn.offsetWidth;
        }
      }
      turn.classList.toggle("down", id < 0);
      const o = !dig && id >= 0 && s && view && !table.pending ? optionsFor(slot) : null;
      const can = dig ? legal?.has(slot) : o ? o.build.ok || o.free : false;
      const isSel = sel?.slot === slot;
      const isPicked = done?.slot === slot;
      b.classList.toggle("sel", isSel);
      b.classList.toggle("picked", !!isPicked);
      b.classList.toggle("dim", !!done && !isPicked);
      b.classList.toggle("can", !!can && !!choice);
      b.classList.toggle("chain", !!o?.build.chain);
      b.style.opacity = leaving.has(slot) || arriving.has(slot) ? "0" : "";
      b.setAttribute("aria-pressed", String(isSel));
      const state = dig ? (can ? "you can build it free" : "you already have it") : !o ? "" : o.build.chain ? "free through a chain" : o.build.ok ? "you can build it" : o.free ? "you can build it with the free build" : WHY[o.build.why]?.toLowerCase() ?? "";
      b.setAttribute("aria-label", id < 0 ? "A card, arriving" : `${cardWords(id)}${state ? ` Now: ${state}.` : ""}${isPicked ? " Picked." : ""}`);
      b.style.setProperty("--i", String(i));
      if (hand.children[i] !== b) hand.insertBefore(b, hand.children[i] ?? null);
    });
    if (focusSlot === null || !handButtons.has(focusSlot)) focusSlot = slots[0] ?? null;
    for (const [slot, b] of handButtons) b.tabIndex = slot === focusSlot ? 0 : -1;
    if (hadFocus !== null && !handButtons.has(hadFocus) && focusSlot !== null) handButtons.get(focusSlot)?.focus({ preventScroll: true });
    hand.dataset.n = String(slots.length);
    hand.classList.toggle("choosing", !!choice);
    hand.classList.toggle("digging", dig);
    hand.setAttribute("aria-label", dig ? "The discards you can dig through" : `Your hand: ${plural(slots.length, "card")}`);
    const n = view?.hands[me]?.length ?? 0;
    handHead.textContent = dig ? "The discards · build one free" : !view?.age ? "Your hand" : choice === "last" ? "Your seventh card" : done ? "Your hand · picked" : choice ? "Your hand · pick one" : "Your hand";
    const to = view && passDir(view.age) > 0 ? around.left : around.right;
    handNext.textContent = view?.age && !dig && n > 1 && view.round < 6 ? `then passes to ${nameIn(to)} ${passDir(view.age) > 0 ? "◂" : "▸"}` : "";
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
    const focused = buttons.contains(document.activeElement) || detail.contains(document.activeElement) ? document.activeElement.id : null;
    const { btns, info } = sideNodes();
    buttons.replaceChildren(...btns);
    buttons.dataset.n = String(btns.length);
    detail.replaceChildren(...info);
    buttons.hidden = !btns.length;
    detail.hidden = !info.length;
    renderPicks();
    if (focused) (document.getElementById(focused) ?? buttons.querySelector("button:not([disabled])") ?? status).focus({ preventScroll: true });
  }

  const btn = (id, label, onclick, { cls = "", disabled = false, sub = null, aria = null, icon = null } = {}) =>
    el("button", { class: `btn sc-act ${cls}`, type: "button", id, disabled, "aria-label": aria, onclick: disabled ? null : onclick }, icon, el("span", { class: "sc-act-words" }, el("span", { class: "lbl" }, label), sub ? el("small", {}, sub) : null));

  function sideNodes() {
    const s = match?.state;
    if (!match || ended || match.phase !== "playing" || !s || !view) return { btns: [], info: [] };
    const choice = myChoice();
    const done = picked?.key === turnKey() ? picked : null;
    if (choice === "dig") return digNodes(s);
    if ((choice === "pick" || choice === "last") && sel) return pickNodes(s);
    if (choice === "pick" || choice === "last") {
      return {
        btns: [btn("sc-build", "Build", null, { cls: "primary", disabled: true }), btn("sc-stage", "Wonder stage", null, { disabled: true }), btn("sc-sell", "Sell for 3", null, { disabled: true, icon: coinEl(3) })],
        info: [el("p", { class: "sc-hint" }, choice === "last" ? "Your wonder lets you play your seventh card: build it, raise a stage with it, or sell it." : "Tap a card to see what you can do with it. When you have to buy from a neighbour, the cheapest way is picked, and you can choose another.")],
      };
    }
    if (done) {
      const what = done.kind === "build" || done.kind === "free" ? `build ${CARDS[done.id]?.name ?? "it"}` : done.kind === "stage" ? `raise a wonder stage with ${CARDS[done.id]?.name ?? "it"}` : done.kind === "sell" ? `sell ${CARDS[done.id]?.name ?? "it"} for 3` : done.kind === "dig" ? `build ${CARDS[done.id]?.name ?? "it"} from the discards` : "build nothing";
      return { btns: [], info: [el("p", { class: "sc-hint sc-done" }, el("strong", {}, "Picked: "), what, ". It happens when everyone has chosen.")] };
    }
    if (s.phase === "dig" && s.digger !== me) return { btns: [], info: [el("p", { class: "sc-hint" }, `${nameOf(s.digger)} is digging through the discards for a card to build free.`)] };
    if (s.phase === "last" && s.lastSeat !== me) return { btns: [], info: [el("p", { class: "sc-hint" }, `${nameOf(s.lastSeat)}'s wonder plays the seventh card of the age.`)] };
    if (sel) return { btns: [], info: detailNodes(s, optionsFor(sel.slot), null, null) };
    return { btns: [], info: [] };
  }

  function pickNodes(s) {
    const o = optionsFor(sel.slot);
    if (!o) return { btns: [], info: [el("p", { class: "sc-hint" }, "That card's face is still on its way…")] };
    const b = buildPlan(o);
    const st2 = stagePlan(o);
    const btns = [
      btn("sc-build", b.label, () => act("build"), { cls: `primary ${o.build.chain ? "chain" : ""}`, disabled: !b.ok, sub: b.sub, aria: b.ok ? `${b.label} ${o.card.name}: ${b.sub} (B)` : `Can't build ${o.card.name}: ${b.why}` }),
      o.free && !o.build.chain ? btn("sc-free", "Build free", () => act("free"), { cls: "primary free", sub: "Your wonder's free build this age", aria: `Build ${o.card.name} free with your wonder's free build` }) : null,
      btn("sc-stage", st2.label, () => act("stage"), { disabled: !st2.ok, sub: st2.sub, aria: st2.ok ? `${st2.label}, tucking ${o.card.name} face down: ${st2.sub} (W)` : `Wonder stage: ${st2.why}` }),
      btn("sc-sell", "Sell for 3", () => act("sell"), { icon: coinEl(3), aria: `Sell ${o.card.name} face down for 3 coins (S)` }),
    ].filter(Boolean);
    return { btns, info: detailNodes(s, o, b, st2) };
  }

  // The card picked: what it does, what it costs and how you'd pay, or why you can't.
  function detailNodes(s, o, b, st2) {
    if (!o) return [];
    const c = o.card;
    const from = chainsFrom(c);
    const lines = [
      el("div", { class: `sc-detail-head c-${c.color}` }, el("strong", { class: "sc-detail-name" }, c.name), effectEl(c), o.build.chain ? el("span", { class: "sc-badge chain" }, "chain") : null, o.free && !o.build.chain ? el("span", { class: "sc-badge free" }, "free build") : null),
      el("p", { class: "sc-detail-fx" }, effectWords(c)),
      el("p", { class: "sc-detail-cost" }, ...(costWords(c.cost) === "free" ? [el("span", { class: "k" }, "Free to build")] : [el("span", { class: "k" }, "Costs"), costEl(c.cost), el("span", {}, costWords(c.cost))]), from.length ? el("small", { class: "sc-chain-from" }, ` · free with ${listOf(from)}`) : null),
      chainsTo(c).length ? el("p", { class: "sc-chain-to" }, `Makes ${listOf(chainsTo(c))} free later.`) : null,
    ];
    if (b) {
      if (o.build.chain) lines.push(el("p", { class: "sc-detail-pay ok" }, `Free: you have ${listOf(from)}.`));
      else if (b.ok) {
        const buy = b.buy && buyWords(b.buy, names());
        lines.push(el("p", { class: "sc-detail-pay ok" }, buy ? `${buy} for ${plural(b.side.left + b.side.right, "coin")}.` : c.cost.coins ? `Pay ${plural(c.cost.coins, "coin")} to the bank.` : "You make everything it needs."), b.ways > 1 ? btn("sc-other", "Other way to pay", () => ((sel.build += 1), render()), { cls: "small link", aria: `Other way to pay for ${c.name} (${b.ways} ways)` }) : null);
      } else lines.push(el("p", { class: "sc-detail-pay no" }, `${whyWords(o.build.why, c)}.${o.free ? " Your wonder's free build can build it." : ""}`));
    }
    if (st2) {
      const stage = o.stage.stage;
      if (stage) {
        const words = st2.ok && st2.buy && buyWords(st2.buy, names());
        lines.push(el("p", { class: "sc-detail-stage" }, el("span", { class: "k" }, `Stage ${ROMAN[o.stage.n + 1]}`), costEl(stage.cost), el("span", { class: "sc-arrow" }, "→"), effectEl(stage), el("small", {}, ` ${effectWords(stage)}.${st2.ok ? (words ? ` ${words} for ${plural(st2.side.left + st2.side.right, "coin")}.` : "") : ` ${whyWords(o.stage.why)}.`}`)));
        if (st2.ok && st2.ways > 1) lines.push(btn("sc-other-stage", "Other way to pay", () => ((sel.stage += 1), render()), { cls: "small link", aria: `Other way to pay for the wonder stage (${st2.ways} ways)` }));
      }
    }
    return lines.filter(Boolean);
  }

  function digNodes(s) {
    const o = sel ? idOf(sel.slot) : -1;
    const legal = sel && legalMoves(s, me, faceOf).some((x) => x.dig === sel.slot);
    const btns = [
      btn("sc-dig", "Build free", () => act("dig"), { cls: "primary", disabled: !legal, sub: o >= 0 ? CARDS[o].name : "Pick a card", aria: o >= 0 ? `Build ${CARDS[o].name} free from the discards` : "Build free: pick a card first" }),
      btn("sc-nothing", "Build nothing", () => send({ dig: -1 }, "nothing")),
    ];
    const info = o >= 0 ? detailNodes(s, { id: o, card: CARDS[o], build: { chain: false, ok: !!legal, why: legal ? null : "duplicate", purchases: [] }, free: false, stage: {} }, null, null) : [el("p", { class: "sc-hint" }, "Your wonder lets you build one card from the discards, free. Tap one to see it.")];
    if (o >= 0 && !legal) info.push(el("p", { class: "sc-detail-pay no" }, `You already have ${CARDS[o].name}.`));
    return { btns, info };
  }

  // Who has chosen this turn: everyone's mark, ticked once they've picked (a commitment, public).
  function renderPicks() {
    const s = match?.state;
    const step = match?.step;
    const show = !!s && !!step && match.phase === "playing" && !table.pending && step.movers.length > 1;
    picks.hidden = !show;
    if (!show) return picks.replaceChildren();
    picks.replaceChildren(
      ...step.movers.map((p) => {
        const done = !!step.commits[p];
        return el("li", { class: `p-${p} ${done ? "done" : ""}` }, seatMark(p), el("span", { class: "nm" }, nameOf(p)), el("span", { class: "sc-pick-state" }, done ? "✓ picked" : "choosing"), !done && p !== me ? thinkingDots() : null);
      }),
    );
  }

  // ---------- a seat's whole city ----------
  let dialogSeat = -1;
  function openSeat(p) {
    if (!view) return;
    dialogSeat = p;
    drawDialog();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".sc-dialog-close")?.focus();
  }
  function drawDialog() {
    if (dialogSeat < 0 || !view) return;
    const p = dialogSeat;
    const w = view.wonders[p];
    const W = WONDERS[w.w];
    const ids = view.city[p].map((x) => x.id);
    const board = el("div", { class: "sc-dialog-board", role: "img", "aria-label": `${W.name}, side ${w.side}: ${view.stages[p].length} of ${stagesOf(view, p).length} stages built. ${stagesOf(view, p).map((x, n) => stageWords(x, n)).join(" ")}` });
    board.innerHTML = boardSvg(w.w, w.side, view.stages[p].length);
    const side = p === around.left ? "your left neighbour" : p === around.right ? "your right neighbour" : "across the table";
    dialog.replaceChildren(
      el("div", { class: `sc-dialog-head p-${p}` }, seatMark(p), el("h2", { id: "sc-dialog-title" }, `${nameOf(p)}'s city`), el("small", {}, side), el("button", { class: "btn small sc-dialog-close", type: "button", onclick: () => dialog.close() }, "Close")),
      el("p", { class: "sc-dialog-facts" }, seatWords(view, p)),
      board,
      ids.length ? cityEl(ids, { cls: "big" }) : el("p", { class: "sc-hint" }, "Nothing built yet."),
      el("ul", { class: "sr-only" }, ids.map((id) => el("li", {}, cardWords(id)))),
    );
  }
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
  dialog.addEventListener("close", () => (dialogSeat = -1));

  // ---------- render ----------
  function describe(ev) {
    if (!ev) return null;
    if (ev.type === "picks") return ev.picks.length > 1 ? "Everyone has picked" : ev.picks[0]?.how === "dig" ? `${nameOf(ev.picks[0].p)} ${verb(ev.picks[0].p, "builds")} from the discards` : null;
    if (ev.type === "pass") return `Hands pass ${ev.dir > 0 ? "left" : "right"}`;
    if (ev.type === "age") return `Age ${ROMAN[ev.age]}: ${HAND} cards each`;
    if (ev.type === "sevenths") return "Last cards discarded";
    if (ev.type === "war") return warWords(ev.results, me, ev.age, nameIn);
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

  function renderTop() {
    const age = view?.age ?? 0;
    ageBadge.textContent = age ? ROMAN[age] : "·";
    ageLine.textContent = age ? `Age ${ROMAN[age]}` : "Stonecrown";
    turnLine.textContent = age ? `Turn ${Math.min(view.round, 6)} of 6` : "Dealing soon";
    top.querySelector(".sc-top-age").setAttribute("aria-label", age ? turnWords(age, view.round) : "Before the first age");
    rootBox.dataset.age = String(age);
    const dir = age ? passDir(age) : 1;
    passLine.replaceChildren(el("span", { class: `sc-pass-arrow ${dir > 0 ? "left" : "right"}`, "aria-hidden": "true" }), el("span", {}, el("span", { class: "sc-pass-word" }, "pass "), age ? (dir > 0 ? "left" : "right") : ""));
    passLine.setAttribute("aria-label", age ? `Hands pass ${dir > 0 ? "left" : "right"}, to ${nameIn(dir > 0 ? around.left : around.right)}` : "");
    if (acrossPill && view) {
      const q = around.across;
      acrossPill.replaceChildren(seatMark(q), el("span", { class: "sc-across-words" }, el("b", {}, nameOf(q)), el("small", {}, "across")), el("span", { class: "sc-across-stats", "aria-hidden": "true" }, coinEl(view.coins[q]), el("span", { class: "sc-sh" }, String(shields(view, q)))));
      acrossPill.setAttribute("aria-label", `${nameOf(q)}, across the table (not a neighbour): ${seatWords(view, q)}. Show their city`);
    }
    if (view) art.drawPile(view);
  }

  function renderTable() {
    if (!view) return;
    const step = match?.step;
    for (const [p, panel] of art.panels) panel.draw(view, { picked: (!!step?.commits[p] && !table.pending) || revealing.has(p) });
    art.drawMine(view);
    if (dialog.open) drawDialog();
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
    if (picked && picked.key !== turnKey()) picked = null;
    const choice = myChoice();
    if (!choice && !picked && sel && match?.state?.phase === "dig") sel = null;
    bar.update({ turn: -1, thinking: current || match?.busy ? -1 : thinkingSeat(), checked: match?.checked ?? [] });
    renderTop();
    renderTable();
    renderDeck();
    renderHand();
    renderSide();
    status.textContent = table.dealtLine(match, statusText());
    status.className = `${table.cls("status")} ${choice ? `mine p-${me}` : ""}`;
    rootBox.classList.toggle("my-turn", !!choice);
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
    timerText.textContent = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
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
      status.textContent = `Waiting for ${listOf(d.movers.map(nameOf))}'s browser…`;
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
    revealing = new Set();
    leaving = new Set();
    arriving = new Set();
    handButtons.forEach((b) => b.remove());
    handButtons.clear();
    if (dialog.open) dialog.close();
    logList.replaceChildren();
    const opponents = listOf(seats.filter((p) => p !== me).map((p) => session.players[p].name));
    note.textContent = m === 1 ? `Playing ${opponents}. Good luck!` : `Rematch #${m - 1}: new wonders, and a fresh deck shuffled by every browser.`;
    const mt = new CardMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    previous = match;
    match = mt;
    window.ddp.match = mt; // browser tests read this
    mt.on("update", () => {
      if (mt !== match) return;
      if (dialog.open && !mt.state) dialog.close();
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
      if (dialog.open) dialog.close();
      for (const off of offs) off();
    },
  };
}
