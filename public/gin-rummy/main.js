// Gin Rummy page: mounts the engine shell and renders a CardMatch. The rules
// live in rules.js, the melds in engine/cards/melds.js, and the card table's
// shared pieces (art, seat, hand, stock, spreads, motion) in engine/cards/.
// This file is the view: the piles, your hand grouped into melds (which you
// can rearrange), the knock, both hands laid down at the end of a hand and
// the points adding up. Laying down and laying off are made for you, the
// best way, after a short beat. The match state never waits for the screen:
// every event is queued and played out in order, faster when they pile up,
// and at once with reduced motion or a hidden tab.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { CardMatch } from "../engine/card-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar, thinkingDots } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { cardTable } from "../engine/cards/table.js";
import { humanPause } from "../engine/cards/paced-robot.js";
import { leaveNotice, abortText, verdictText as verdictOf } from "../engine/cards/leave-notice.js";
import { cardWords, cardName } from "../engine/cards/faces.js";
import { makeRules, normalizeConfig, forcedMove, bestKnock } from "./rules.js";
import { AUTO, PACE, KIND, plural, tilt, viewOf, knockable, moveInHand, ginTable } from "./art.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";

// How long robots take before each move (robotPause() scales these in tests).
const ROBOT_PACE = { upcard: 700, draw: 480, discard: 820, option: 50, knock: 1300, forced: 420, next: 650, max: 2000 };
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };

// Robot games: robots wait for the screen to finish replaying. The view sets this.
let screenBusy = () => false;

// A robot's pause: a beat for a forced move or a draw, a real think for a discard or a knock.
function robotDelay(st, me, move, level) {
  return humanPause(screenBusy, () => {
    if (move.melds) return ROBOT_PACE.forced;
    if (move.next) return ROBOT_PACE.next;
    if (move.take || move.pass) return ROBOT_PACE.upcard + Math.random() * 300;
    if (move.draw) return ROBOT_PACE.draw + Math.random() * 260;
    if (move.knock) return ROBOT_PACE.knock + Math.random() * 300;
    return Math.min(ROBOT_PACE.max, ROBOT_PACE.discard + ROBOT_PACE.option * st.hands[me].length + Math.random() * 450 - (level === "easy" ? 150 : 0));
  });
}

startGameShell({
  slug: "gin-rummy",
  title: "Gin Rummy",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "wide",
  settings,
  createRobot: (session) => {
    const config = settings.get();
    return startRobot(session, {
      rules: makeRules(config),
      choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: config.level }),
      delay: (st, me, move) => robotDelay(st, me, move, config.level),
    });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

function mountGame(session, root, shell) {
  const me = session.index;
  const them = 1 - me;
  const seats = [0, 1];
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const theirName = session.players[them].name;
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
  let selected = null; // the card picked to discard
  let order = []; // your hand in the order you arranged it
  let sortMode = "rank"; // "rank", "suit", or null once you move cards yourself
  let sortChosen = "rank"; // the last sort you picked: each new hand starts with it
  let wantNext = 0; // the hand you said "Next hand" after, before it was your turn to say so
  let previous = null; // the match before a rematch, whose verdict may still be on its way
  let lastVerdict = ""; // that verdict in words, once it arrives
  let games = ""; // games won so far, in words, for the note
  let carried = [0, 0]; // one hand a game: points from the games before
  let gamesWon = [0, 0];
  let shownHand = { slots: [], melds: [], dead: [], points: 0 };
  const four = () => settings.get().fourColor;
  // The shared table: cards, seat, stock, hand, spreads and motion (engine/cards/table.js).
  const table = cardTable({ prefix: "gr", play, animate: (ev, g) => animate(ev, g), done: (idle) => replayed(idle) });
  const { miniCard, fly, live, fast, wait, rectIn, hand } = table;

  // "setup" is for this view (only from the room's creator); the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  bar.update({ badges: seats.map(() => el("span", { class: "dot", "aria-hidden": "true" })) });
  const status = el("p", { class: table.cls("status"), id: "gr-status", role: "status", "aria-live": "polite", tabindex: "-1" });

  // The table's parts, drawing and motion (art.js).
  const gin = ginTable(table, {
    me,
    names: session.players.map((x) => x.name),
    myName,
    face: (slot) => faceOf(slot),
    view: () => view,
    render: () => render(),
    on: { draw: () => drawFrom("stock"), take: () => takePile(), pass: () => pass(), discard: () => selected !== null && discardNow(selected), knock: () => knockNow(), next: () => nextHand(), sort: (mode) => sortBy(mode) },
  });
  const { seat, oppSpread, oppTally, actionBar, nextBtn, timer, timerFill, timerText, mySpread, deadNum, meArea, tableBox, tableWrap, nameOf, verb } = gin;
  const { handGroups, spreadGroups, drawHand, drawSeat, drawCentre, drawActions, forgetMelds, seatRect, pileRect, spreadOf, dealTo, say, moment, thump, sparkle, countUp, layDown, layOffs, scoreHand } = gin;

  const hint = el("p", { class: table.cls("hint"), id: "gr-hint" });
  const logList = el("ol", { class: table.cls("log"), id: "gr-log", "aria-label": "Last move" });
  const configLine = el("p", { class: table.cls("config"), id: "gr-config" });
  const note = el("p", { class: table.cls("note"), id: "gr-note" });

  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    // The result moment: the winner's melds light up; a loss dims the table.
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "paper", highlight: winnerCards(), board: tableBox }),
  });

  const rootBox = el(
    "div",
    { class: "gin-rummy pc-game", dataset: { you: me === 0 ? "a" : "b", seat: me } },
    table.symbolHost,
    bar.node,
    status,
    el("div", { class: table.cls("main") }, tableWrap, el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, hint), logList)),
    configLine,
    note,
  );
  root.append(rootBox, result.node);

  // ---------- the table as drawn ----------
  const emptyView = (scores = [0, 0]) => ({ hands: [[], []], stock: 52, discard: [], laid: [null, null], layoffs: [], knock: null, result: null, scores: scores.slice(), tally: [null, null], dealer: -1, limit: null, arriving: new Set() });
  const faceOf = (slot) => match?.face(slot) ?? null;

  // ---------- whose decision it is ----------
  function decision() {
    if (!match || match.phase !== "playing" || table.pending || ended) return null;
    return { player: match.state.turn, phase: match.state.phase };
  }
  const myDecision = () => {
    const d = decision();
    return d && d.player === me ? d : null;
  };
  // Your real choice now ("upcard", "draw", "discard", "result"), or null.
  function myChoice() {
    const d = myDecision();
    return d && match.canMove() && !forcedMove(match.state, me, faceOf) ? d.phase : null;
  }

  // ---------- your hand, grouped into its melds ----------

  function sortBy(mode) {
    sortMode = sortChosen = mode;
    play("deal", { offset: -4 });
    render();
  }

  // You moved a card: a meld moves as a whole among the melds; a deadwood card among the deadwood.
  function moveCard(slot, to, by) {
    order = moveInHand(shownHand, slot, to, by);
    sortMode = null;
    render();
  }
  table.onMove((slot, to, by) => moveCard(slot, to, by));

  // ---------- rendering pieces ----------
  function renderHand() {
    if (view.laid[me]) {
      if (hand.contains(document.activeElement)) status.focus({ preventScroll: true });
      return drawHand(null);
    }
    const g = handGroups(order, sortMode);
    order = g.order;
    shownHand = g;
    const choosing = myChoice() === "discard";
    const taken = match?.state?.taken;
    if (selected !== null && (!choosing || !g.slots.includes(selected) || selected === taken)) selected = null;
    drawHand(g, { choosing, taken, selected, after: choosing ? bestKnock(match.state, me, faceOf) : null, sortMode, dealing: current?.type === "deal" });
  }

  function renderCentre() {
    drawCentre({ choice: myChoice(), knockRule: config?.knock });
    const busy = match?.busy && match.phase !== "over" ? match.busy : null;
    table.renderBusy(busy, { starting: match?.phase === "starting", redraw: () => !destroyed && render() });
  }

  // ---------- motion ----------
  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    if (ev.type === "deal") {
      view = { ...emptyView(view?.scores), dealer: ev.dealer };
      order = [];
      sortMode = sortChosen;
      forgetMelds();
      render();
      await table.deal(ev.hands, 1 - ev.dealer, { gap: PACE.deal, ms: PACE.dealFly }, (p, slot, ms, sound) => dealTo(p, slot, g, ms, sound), g);
      current = null;
      forgetMelds();
      if (!live(g)) return;
      render();
      addLog({ text: `Hand ${ev.hand}: ${nameOf(ev.dealer)} ${verb(ev.dealer, "deals")}` });
    } else if (ev.type === "upcard") {
      const from = table.stockRect();
      if (!view.discard.includes(ev.slot)) {
        view.stock = Math.max(0, view.stock - 1);
        view.discard.push(ev.slot);
      }
      view.arriving.add(ev.slot);
      view.limit = ev.limit;
      render();
      play("play");
      await fly(faceOf(ev.slot), from, pileRect(), { ms: PACE.flip * k, turn: "up", spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      render();
      addLog({ face: faceOf(ev.slot), text: `${cardWords(faceOf(ev.slot)).replace(/^\w/, (c) => c.toUpperCase())} is turned up${config.knock === "oklahoma" ? `: knock with ${ev.limit} or less` : ""}` });
    } else if (ev.type === "take") {
      const from = pileRect();
      view.discard = view.discard.filter((s) => s !== ev.slot);
      view.hands[ev.p].push(ev.slot);
      view.arriving.add(ev.slot);
      render();
      play("draw");
      await fly(faceOf(ev.slot), from, seatRect(ev.p, ev.slot), { ms: PACE.take * k, turn: ev.p === me ? null : "down", g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      render();
      addLog({ player: ev.p, face: faceOf(ev.slot), text: `${nameOf(ev.p)} took ${cardWords(faceOf(ev.slot))} ${ev.from === "upcard" ? "(the upcard)" : "from the pile"}` });
    } else if (ev.type === "pass") {
      say(ev.p, "Pass", g);
      addLog({ player: ev.p, text: `${nameOf(ev.p)} ${verb(ev.p, "passes")} on the upcard` });
      await wait(PACE.bubble * 0.6 * k, g);
    } else if (ev.type === "draw") {
      await dealTo(ev.p, ev.slot, g, PACE.draw * k, "draw");
      if (!live(g)) return;
      // Your own card is named once its face has arrived (see renderLog).
      addLog({ player: ev.p, slot: ev.p === me ? ev.slot : undefined, face: null, text: `${nameOf(ev.p)} drew from the stock` });
    } else if (ev.type === "discard") {
      const from = seatRect(ev.p, ev.slot);
      const wasDown = ev.p !== me && seat.cards.get(ev.slot)?.classList.contains("down");
      view.hands[ev.p] = view.hands[ev.p].filter((s) => s !== ev.slot);
      view.discard.push(ev.slot);
      view.arriving.add(ev.slot);
      if (ev.p === me) selected = null;
      render();
      play("play");
      await fly(faceOf(ev.slot), from, pileRect(), { ms: PACE.discard * k, turn: wasDown ? "up" : null, spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      render();
      addLog({ player: ev.p, face: faceOf(ev.slot), text: `${nameOf(ev.p)} ${ev.knock ? "knocked, throwing" : verb(ev.p, "discards")} ${cardWords(faceOf(ev.slot))}` });
    } else if (ev.type === "knock") {
      view.knock = { p: ev.p, gin: ev.gin };
      render();
      play("knock");
      thump(g);
      moment(ev.gin === 2 ? "Big Gin!" : ev.gin ? "Gin!" : "Knock!", ev.p, ev.gin ? "gin" : "knock", g);
      if (ev.gin) {
        play("gin", {}, 0.25);
        sparkle(rectIn(tableBox), ev.p, g, 18);
      }
      if (ev.gin === 2) addLog({ player: ev.p, kind: "gin", text: `${nameOf(ev.p)} ${verb(ev.p, "goes")} out with Big Gin: all eleven cards` });
      else if (ev.gin) addLog({ player: ev.p, kind: "gin", text: `Gin for ${ev.p === me ? "you" : nameOf(ev.p)}!` });
      await wait(PACE.moment * k, g);
    } else if (ev.type === "lay") {
      await layDown(ev.p, ev.melds, ev.deadwood, g, k);
      if (!live(g)) return;
      addLog({ player: ev.p, faces: ev.melds.flat().map(faceOf), text: `${nameOf(ev.p)} laid down ${meldWords(ev.melds)}, ${ev.points} deadwood` });
      await countUp(ev.p === me ? deadNum : oppTally, ev.points, g, (n) => (ev.p === me ? String(n) : `Deadwood ${n}`));
      view.tally[ev.p] = ev.points;
      render();
    } else if (ev.type === "defend") {
      const off = ev.layoffs.map(([s]) => s);
      await layDown(ev.p, ev.melds, [...ev.deadwood, ...off], g, k);
      if (!live(g)) return;
      if (ev.melds.length) addLog({ player: ev.p, faces: ev.melds.flat().map(faceOf), text: `${nameOf(ev.p)} laid down ${meldWords(ev.melds)}` });
      if (!(await layOffs(ev.p, ev.layoffs, g, k))) return;
      if (off.length) addLog({ player: ev.p, faces: off.map(faceOf), text: `${nameOf(ev.p)} laid off ${plural(off.length, "card")}` });
      await countUp(ev.p === me ? deadNum : oppTally, ev.points, g, (n) => (ev.p === me ? String(n) : `Deadwood ${n}`));
      view.tally[ev.p] = ev.points;
      render();
    } else if (ev.type === "score") {
      await showScore(ev, g, k);
    } else if (ev.type === "ready") {
      if (ev.p !== me) {
        say(ev.p, "Ready", g);
        play("ready");
      }
      addLog({ player: ev.p, text: `${nameOf(ev.p)} ${ev.p === me ? "are" : "is"} ready for the next hand` });
    } else if (ev.type === "gather") {
      await gather(g, k);
    }
    current = null;
    await wait(PACE.between * k, g);
  }

  // "7♥ 8♥ 9♥ and K♠ K♦ K♣", for the log.
  const meldWords = (melds) => {
    const words = melds.map((x) => x.map((s) => cardName(faceOf(s))).join(" "));
    return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  };

  // The end of a hand: what it was, the deadwood against each other, and the points into the score.
  async function showScore(ev, g, k) {
    if (!(await scoreHand(ev, g, k, totalsLine))) return;
    addLog({ player: ev.winner >= 0 ? ev.winner : undefined, kind: ev.kind, text: ev.winner >= 0 ? `${KIND[ev.kind].replace("!", "")}: ${plural(ev.points, "point")} for ${ev.winner === me ? "you" : nameOf(ev.winner)}` : "Two cards left and no knock: the hand is a draw" });
    await wait(PACE.bubble * k, g);
  }

  function totalsLine(scores) {
    const mine = carried[me] + scores[me];
    const theirs = carried[them] + scores[them];
    return `You ${mine} · ${theirName} ${theirs}${config.target ? ` · to ${config.target}` : ""}`;
  }

  // The cards go back to the stock for the next shuffle: a few fly, face down, from the pile and both hands.
  async function gather(g, k) {
    play("gather");
    const target = table.stockRect();
    const from = [...view.discard.slice(-2).map(() => pileRect()), ...seats.flatMap((p) => view.hands[p].slice(0, 5).map((s) => seatRect(p, s)))];
    await Promise.all(from.map((r, i) => wait(i * 25 * k, g).then(() => fly(null, r, target, { ms: PACE.gather * k, g }))));
    if (!live(g)) return;
    oppSpread.clear();
    mySpread.clear();
    view = { ...emptyView(view.scores), dealer: view.dealer };
    render();
  }

  const enqueue = (ev) => table.enqueue(ev);
  // After each event: once the screen has caught up, it draws the match as it stands.
  function replayed(idle) {
    if (idle) {
      current = null;
      view = viewOf(match.state);
      for (const robot of window.ddp.robots || []) robot.poke?.();
    }
    render();
  }

  // ---------- log ----------
  const logLine = (e) => [e.faces ? el("span", { class: "gr-minis" }, e.faces.map((f) => miniCard(f))) : e.face !== undefined ? miniCard(e.face) : null, el("span", {}, e.text)];
  function addLog(entry) {
    entry.node = el("li", { class: `${entry.player === undefined ? "" : `p-${entry.player}`} ${entry.kind || ""} fresh` }, logLine(entry));
    // Only the latest move: what came before is yours to remember, as at a real table.
    log = [entry];
    logList.replaceChildren(...log.map((e) => e.node));
    renderLog();
  }
  // A card you drew is named once its face has arrived.
  function renderLog() {
    for (const e of log) {
      if (e.slot === undefined || e.face !== null || faceOf(e.slot) === null) continue;
      e.face = faceOf(e.slot);
      e.text = `You drew ${cardWords(e.face)}`;
      e.node.replaceChildren(...logLine(e));
    }
  }

  // ---------- your moves ----------
  table.onPick((slot) => {
    if (myChoice() !== "discard") return;
    if (slot === match.state.taken) {
      play("nope");
      return toast("You can't throw back the card you just took from the pile");
    }
    if (selected === slot) return discardNow(slot);
    selected = slot;
    play("deal", { offset: -4 });
    render();
  });

  function discardNow(slot) {
    if (myChoice() !== "discard") return;
    selected = null;
    match.play({ discard: slot });
  }

  function knockNow() {
    if (myChoice() !== "discard") return;
    const kn = knockable(match.state, me, faceOf, selected);
    if (!kn) {
      play("nope");
      return toast(`You need ${match.state.limit} points of deadwood or less to knock`);
    }
    selected = null;
    match.play(kn.big ? { knock: true } : { discard: kn.slot, knock: true });
  }

  function drawFrom(which) {
    if (myChoice() === "draw") match.play({ draw: which });
  }

  function takePile() {
    const c = myChoice();
    if (c === "upcard") match.play({ take: true });
    else if (c === "draw") match.play({ draw: "pile" });
  }

  function pass() {
    if (myChoice() === "upcard") match.play({ pass: true });
  }

  function nextHand() {
    if (myChoice() === "result") return match.play({ next: true });
    const st = match?.state;
    // Not again once you have said it: the wish belongs to this hand's score.
    if (match?.phase === "playing" && st.phase === "result" && !(st.ready === 1 && st.turn !== me)) {
      wantNext = st.hand;
      render();
    }
  }

  // D draws, T takes the pile, P passes, K knocks, N starts the next hand; Escape drops the picked card.
  function onKey(e) {
    if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (e.key === "Escape" && selected !== null) {
      selected = null;
      render();
    } else if (key === "d") drawFrom("stock");
    else if (key === "t") takePile();
    else if (key === "p") pass();
    else if (key === "k") knockNow();
    else if (key === "n") nextHand();
  }
  addEventListener("keydown", onKey);

  // ---------- render ----------
  function describe(ev) {
    if (!ev) return null;
    if (ev.type === "deal") return `Dealing hand ${ev.hand}…`;
    if (ev.type === "upcard") return "The upcard is turned…";
    if (ev.type === "take") return `${nameOf(ev.p)} ${verb(ev.p, "takes")} ${cardName(faceOf(ev.slot))}${ev.from === "upcard" ? "" : " from the pile"}.`;
    if (ev.type === "draw") return `${nameOf(ev.p)} ${verb(ev.p, "draws")} from the stock…`;
    if (ev.type === "discard") return ev.knock ? `${nameOf(ev.p)} ${verb(ev.p, "knocks")}!` : `${nameOf(ev.p)} ${verb(ev.p, "discards")} ${cardName(faceOf(ev.slot))}.`;
    if (ev.type === "knock") return ev.gin ? `${ev.gin === 2 ? "Big Gin" : "Gin"} for ${ev.p === me ? "you" : nameOf(ev.p)}!` : `${nameOf(ev.p)} ${verb(ev.p, "knocks")}!`;
    if (ev.type === "lay") return `${nameOf(ev.p)} ${verb(ev.p, "lays")} down ${plural(ev.melds.length, "meld")}…`;
    if (ev.type === "defend") return ev.layoffs.length ? `${nameOf(ev.p)} ${verb(ev.p, "lays")} down and ${verb(ev.p, "lays")} off ${plural(ev.layoffs.length, "card")}…` : `${nameOf(ev.p)} ${verb(ev.p, "lays")} down…`;
    if (ev.type === "gather") return "Shuffling for the next hand…";
    return null;
  }

  function statusText() {
    if (ended) return "The game has ended.";
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    if (match.phase === "aborted") return "Match stopped.";
    if (match.phase === "starting") return table.deckLine(match, (p) => session.players[p].name);
    const now = describe(current);
    if (now) return now;
    if (table.pending) return status.textContent || "…";
    if (match.phase === "over") return overLine(st);
    const d = decision();
    if (!d) return "…";
    const top = st.discard.length ? faceOf(st.discard.at(-1)) : null;
    const topName = top === null ? "upcard" : cardName(top);
    const choice = myChoice();
    if (d.phase === "result") {
      const r = st.result;
      const head = r.winner >= 0 ? `Hand ${st.hand}: ${plural(r.points, "point")} for ${r.winner === me ? "you" : nameOf(r.winner)}.` : `Hand ${st.hand} is a draw.`;
      if (choice) return `${head} Next hand when you're ready.`;
      return wantNext === st.hand || d.player !== me ? `${head} Waiting for ${theirName}…` : head;
    }
    if (d.player !== me) {
      if (d.phase === "upcard") return `${theirName} ${st.passes ? "may take" : "is offered"} the ${topName}…`;
      if (d.phase === "lay" || d.phase === "defend") return `${theirName} ${d.phase === "lay" ? "lays down" : "lays down and lays off"}…`;
      return `${theirName}'s turn…`;
    }
    if (match.busy) return table.deckLine(match, (p) => session.players[p].name);
    if (!choice) return d.phase === "lay" ? "Laying down your melds…" : d.phase === "defend" ? "Laying down your hand and laying off…" : "…";
    if (choice === "upcard") return `Your turn: take the ${topName}, or pass.`;
    if (choice === "draw") return `Your turn: draw from the stock${top !== null ? ` or take the ${cardName(top)}` : ""}.`;
    const kn = knockable(st, me, faceOf, selected);
    if (kn?.big) return "Big Gin! Every card is in a meld.";
    if (kn) return kn.points ? `Discard a card, or knock with ${kn.points}.` : "Gin! Discard a card, or go out.";
    return "Discard a card: tap it twice.";
  }

  function overLine(st) {
    const w = st.winner;
    if (w === 2) return "A drawn hand: no points.";
    const t = st.final.totals;
    if (!config.target) return `${w === me ? "You win" : `${nameOf(w)} wins`} the hand: ${plural(t[w], "point")}.`;
    return `${w === me ? "You win" : `${nameOf(w)} wins`} the game, ${t[w]} to ${t[1 - w]}.`;
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = ended ? "ended" : match?.phase || "setup";
    rootBox.dataset.phase = phase;
    rootBox.classList.toggle("four-colour", four());
    const d = decision();
    const shownTurn = current?.p ?? (phase === "playing" ? st?.turn : undefined);
    if (view) {
      bar.update({
        turn: phase === "playing" && shownTurn !== undefined ? shownTurn : -1,
        thinking: current || match?.busy ? -1 : undefined,
        notes: seats.map((p) => (st ? plural(view.hands[p].length, "card") : "")),
        score: { wins: seats.map((p) => carried[p] + view.scores[p]) },
        checked: match?.checked ?? [],
      });
    }
    seat.node.classList.toggle("active", shownTurn === them && phase === "playing");
    meArea.classList.toggle("active", shownTurn === me && phase === "playing");
    tableBox.classList.toggle("laid", !!view?.laid.some(Boolean));
    status.textContent = table.dealtLine(match, statusText());
    const mine = myDecision();
    status.className = `${table.cls("status")} ${d ? `p-${d.player}` : ""} ${mine ? "mine" : ""}`;
    if (view) {
      drawSeat();
      renderCentre();
      renderHand();
    }
    renderActions();
    renderLog();
    renderTimer();
    renderResult();
    const choice = myChoice();
    setTabAlert(choice && choice !== "result" ? "Your turn" : null);
    if (choice === "upcard" || choice === "draw") {
      const key = `${m}:${st.moves}`;
      if (cuedTurn !== key) {
        cuedTurn = key;
        play("turn");
      }
    }
    if (choice === "result" && wantNext === st.hand) {
      wantNext = 0;
      setTimeout(() => myChoice() === "result" && match.play({ next: true }), 0);
    }
    autoMove();
  }

  function renderActions() {
    const choice = myChoice();
    const st = match?.state;
    const top = st?.discard.length ? faceOf(st.discard.at(-1)) : null;
    const hadFocus = actionBar.contains(document.activeElement) ? document.activeElement : null;
    drawActions(choice, { top, selected, kn: choice === "discard" ? knockable(st, me, faceOf, selected) : null });
    // The next hand: your turn to say so, or say it early and it goes when your turn comes.
    const inResult = match?.phase === "playing" && st.phase === "result" && !table.pending;
    const done = inResult && st.ready === 1 && st.turn !== me;
    nextBtn.hidden = !inResult;
    const wished = inResult && wantNext === st.hand;
    nextBtn.disabled = done || (wished && choice !== "result");
    nextBtn.textContent = done || wished ? `Waiting for ${theirName}…` : "Next hand";
    // A button you used hides: keep focus on the table's status rather than losing it to the page.
    if (hadFocus?.hidden || hadFocus?.disabled) status.focus({ preventScroll: true });
    if (!match || match.phase !== "playing") hint.textContent = "";
    else hint.textContent = `Melds are sets of a rank and runs in a suit. Knock with ${view.limit ?? (config.knock === "oklahoma" ? "the upcard's points" : 10)} or less of deadwood; none is gin. Keys: D draw, T take, P pass, K knock, N next hand; Shift + arrows move a card.`;
    hint.parentNode.hidden = !hint.textContent;
  }

  // Laying down and the defence: made for you, the best way, after a short beat.
  function autoMove() {
    const d = myDecision();
    if (!d || !match.canMove()) return;
    const move = forcedMove(match.state, me, faceOf);
    if (!move) return;
    const key = `${m}:${match.state.moves}`;
    if (autoKey === key) return;
    autoKey = key;
    const ms = fast() ? 0 : d.phase === "lay" ? AUTO.lay : AUTO.defend;
    const g = table.gen;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (live(g) && myDecision() && match.canMove() && `${m}:${match.state.moves}` === key) match.play(forcedMove(match.state, me, faceOf));
    }, ms);
  }

  const timed = (phase) => ["upcard", "draw", "discard", "result"].includes(phase);
  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    // The clock starts once the move can be made: not while the deck is still shuffling or dealing.
    const ready = !!d && !match.busy && match.state.limit !== null;
    const key = `${m}:${match?.state?.moves}:${ready}`;
    timer.hidden = !secs || !ready || !timed(d.phase) || (d.phase === "result" && d.player !== me);
    if (timer.hidden) return;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (secs * 1000))).toFixed(3)})`;
    timer.className = `gr-timer p-${d.player} ${left < 5000 ? "low" : ""}`;
    timerText.textContent = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
    if (d.player === me && left <= 3000 && left > 0) {
      const sec = Math.ceil(left / 1000);
      if (sec !== lastTick) {
        lastTick = sec;
        play("tick");
      }
    }
  }

  // Your time ran out: a sensible move is made for you (a stalled player would hold up the game).
  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !config?.moveSeconds) return;
    renderTimer();
    const d = decision();
    if (!d || !timed(d.phase)) return;
    const left = deadline - performance.now();
    if (d.player === me && !timer.hidden && left <= 0 && timedOut !== deadlineKey && myChoice()) {
      timedOut = deadlineKey;
      selected = null;
      const move = timeoutMove(match.state, me, faceOf);
      toast(`Time's up: ${move.next ? "on to the next hand" : move.take ? "took the upcard" : move.pass ? "passed" : move.draw ? `drew from the ${move.draw === "pile" ? "pile" : "stock"}` : move.knock ? "knocked" : `discarded the ${cardName(faceOf(move.discard))}`} for you`);
      match.play(move);
    } else if (d.player !== me && d.phase !== "result" && !timer.hidden && left <= -CLAIM_GRACE_MS) {
      status.textContent = `Waiting for ${theirName}'s browser…`;
    }
  }
  const ticker = setInterval(tick, 200);

  // ---------- the end ----------
  // The winner's melds on the table, in the order they light up.
  function winnerCards() {
    const st = match?.state;
    if (!st || match.phase !== "over" || st.winner > 1) return [];
    const spread = spreadOf(st.winner);
    const groups = view.laid[st.winner] ? spreadGroups(st.winner).filter((x) => x.kind === "meld") : [];
    return groups.flatMap((x) => x.slots.map((s) => spread.cards.get(s))).filter(Boolean);
  }

  const verdictText = (v) => verdictOf(v, nameOf);
  function verdictLine() {
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "gr-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle proved, and every hand replayed with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "gr-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    return el("p", { class: "verdict", id: "gr-verdict" }, thinkingDots(), "Checking every shuffle and replaying the game…");
  }

  // The game's points, the bonuses and the totals, a row each.
  function standings(st) {
    const f = st.final;
    const order = [st.winner === 2 ? me : st.winner, st.winner === 2 ? them : 1 - st.winner];
    const head = el("tr", {}, el("th", {}, el("span", { class: "sr-only" }, "Player")), el("th", {}, "Points"), ...(f.game ? [el("th", {}, "Hands"), el("th", {}, "Game")] : []), el("th", {}, "Total"));
    const rows = order.map((p) =>
      el(
        "tr",
        { class: `p-${p} ${p === me ? "mine" : ""}` },
        el("th", { scope: "row" }, el("span", { class: "who" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, p === me ? "You" : theirName))),
        el("td", { class: "mono" }, String(st.scores[p])),
        ...(f.game ? [el("td", { class: "mono" }, `${st.wins[p]} × ${f.line}`), el("td", { class: "mono" }, p === st.winner ? `+${f.game}` : "–")] : []),
        el("td", { class: "mono total" }, String(f.totals[p])),
      ),
    );
    return el("table", { class: "gr-standings", id: "gr-standings" }, el("thead", {}, head), el("tbody", {}, rows));
  }

  let shownFor = null;
  let extra = null;
  function renderResult() {
    const phase = match?.phase;
    // Let the last hand land first.
    if (ended || (phase !== "over" && phase !== "aborted") || (phase === "over" && table.pending)) {
      result.hide();
      shownFor = null;
      return;
    }
    if (phase === "aborted") return result.show({ stopped: true, reason: abortText({ reason: match.abortReason, seat: match.abortSeat, about: match.abortAbout }, nameOf) });
    const st = match.state;
    const w = st.winner;
    const t = st.final.totals;
    const r = st.result;
    let reason;
    if (w === 2) reason = "Only two cards were left in the stock and nobody knocked.";
    else if (!config.target) reason = `${KIND[r.kind] === "Knock" ? `${nameOf(st.knock.p)} knocked` : KIND[r.kind].replace("!", "")}: ${plural(r.points, "point")} for ${w === me ? "you" : nameOf(w)}.`;
    else reason = `${w === me ? "You" : nameOf(w)} reached ${config.target} first, after ${plural(st.history.length, "hand")}: ${t[w]} to ${t[1 - w]} with the bonuses.`;
    const key = `${m}:${!!match.verdict}`;
    if (shownFor !== key) {
      shownFor = key;
      extra = el("div", { class: "gr-over pc-game" }, standings(st), verdictLine());
    }
    result.show({ winner: w === 2 ? -1 : w, reason, extra });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    // One hand a game: the scores add up across rematches. To 100: count the games won.
    if (match?.phase === "over") {
      if (!config.target) carried = carried.map((c, p) => c + match.state.scores[p]);
      else if (match.state.winner < 2) gamesWon[match.state.winner]++;
    }
    m += 1;
    table.reset();
    oppSpread.clear();
    mySpread.clear();
    clearTimeout(autoTimer);
    current = null;
    view = emptyView();
    log = [];
    cuedTurn = "";
    autoKey = "";
    deadlineKey = "";
    timedOut = "";
    selected = null;
    order = [];
    wantNext = 0;
    forgetMelds();
    shownFor = null;
    lastVerdict = "";
    logList.replaceChildren();
    games = config.target && gamesWon.some(Boolean) ? ` Games won: you ${gamesWon[me]}, ${theirName} ${gamesWon[them]}.` : "";
    note.textContent = m === 1 ? `Playing ${theirName}. Good luck!` : `Rematch #${m - 1}: a fresh deck, shuffled by both browsers.${games}`;
    const mt = new CardMatch({ send: (msg) => session.send(msg), me, players: 2, rules, m });
    previous = match;
    match = mt;
    window.ddp.match = mt; // browser tests read this
    let dealt = false;
    const firstDeal = () => {
      if (dealt || !mt.state) return;
      dealt = true;
      enqueue({ type: "deal", hand: 1, dealer: mt.state.first, hands: mt.state.hands.map((h) => h.slice()) });
    };
    mt.on("update", () => {
      if (mt !== match) return;
      firstDeal();
      render();
    });
    mt.on("invalid", (reason) => {
      if (mt !== match) return;
      play("nope");
      toast(reason);
    });
    mt.on("start", () => {
      if (mt !== match) return;
      const dealer = mt.state.first;
      const who = dealer === me ? "you deal first" : `${theirName} deals first`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.dealer === "random" ? `Coin toss (drawn by both browsers): ${who}.` : `Room setting: ${who}.`) + games + (lastVerdict && ` ${lastVerdict}.`);
    });
    mt.on("events", ({ events }) => {
      if (mt !== match) return;
      firstDeal();
      for (const ev of events) enqueue(ev);
    });
    // A rematch can start before this verdict arrives; keep listening to the old match.
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
    const parts = [c.target ? `Game to ${c.target}` : "One hand a game", c.knock === "oklahoma" ? "Oklahoma: the upcard sets the knock limit" : "knock with 10 or less"];
    if (c.bigGin) parts.push("Big Gin on");
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s a move`);
    if (robotGame) parts.push(`${LEVEL_NAME[c.level]} robot`);
    return parts.join(" · ");
  }

  // The room's settings come from whoever created it (robots use ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = describeConfig(config);
    newMatch();
  }
  function onSetup(msg) {
    if (me !== 0) begin(msg.config);
  }

  // A player left: the engine ends the game for everyone; say so plainly, and whether the game got checked.
  function onEnd(reason, seatLeft) {
    if (reason === "self") return;
    ended = true;
    table.stop();
    clearTimeout(autoTimer);
    table.shuffling(false);
    // Just after a rematch started, the game to report on is the one before.
    const judged = match?.phase === "starting" && previous ? previous : match;
    leaveNotice({ root, session, seat: seatLeft, match: judged, prefix: "gr", game: "Gin Rummy", nameOf, facts: (st, p) => `${plural(carried[p] + st.scores[p], "point")}` });
    render();
  }

  screenBusy = () => table.pending > 0;
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const resize = new ResizeObserver(() => view && render());
  resize.observe(tableBox);
  const offs = [offMsg, session.on("end", onEnd), session.on("rematch-start", () => config && newMatch()), settings.onChange(() => render())];
  view = emptyView();
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
