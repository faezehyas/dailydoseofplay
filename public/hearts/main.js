// Hearts page: mounts the engine shell and renders a CardMatch. The rules live
// in rules.js; the card table's shared pieces (art, seats, hand, the trick,
// won tricks, the pass and motion) in engine/cards/. This file is the view:
// four (or three) seats round the trick, the pass, the queen's weight, hearts
// breaking, each hand's points tallying up and the moon. Leading the 2 of
// clubs, an only legal card and the next hand are played for you after a
// short beat. The match state never waits for the screen: every event is
// queued and played out in order, faster when they pile up, and at once with
// reduced motion or a hidden tab.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { CardMatch } from "../engine/card-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { cardTable, DECK_WORK, tokenMs, easing } from "../engine/cards/table.js";
import { humanPause } from "../engine/cards/paced-robot.js";
import { leaveNotice, abortText, verdictText as verdictOf } from "../engine/cards/leave-notice.js";
import { cardWords, cardName, suitOf, SUIT_NAMES } from "../engine/cards/faces.js";
import { makeRules, normalizeConfig, forcedMove, legalPlays, passTo, cardFace, handSize, isPoint, HEARTS, QUEEN_SPADES, MIN_PLAYERS, MAX_PLAYERS, PASS_COUNT } from "./rules.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";

// How long robots take before each move (robotPause() scales these in tests).
const ROBOT_PACE = { pass: 1500, play: 620, option: 60, forced: 360, find: 140, next: 1700, max: 2100 };
// Your browser's own moves nobody chooses, after a short beat.
const AUTO = { find: 260, play: 420, next: 1700 };
const PACE = { deal: 26, dealFly: 260, pass: 520, between: 140, play: 360, look: 520, gather: 440, tally: 45, bubble: 820, moment: 900 };
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const DIR_WORD = { left: "left", right: "right", across: "across" };
const DIR_ARROW = { left: "←", right: "→", across: "↑" };
const MOON_SVG =
  '<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle cx="60" cy="60" r="44" fill="currentColor" opacity=".18"/><path d="M78 20a44 44 0 1 0 22 62A36 36 0 1 1 78 20Z" fill="currentColor"/><circle cx="52" cy="52" r="5" fill="#000" opacity=".12"/><circle cx="44" cy="76" r="7" fill="#000" opacity=".1"/><circle cx="66" cy="88" r="4" fill="#000" opacity=".12"/></svg>';
const HEART_SVG = '<svg viewBox="0 0 24 22" aria-hidden="true" focusable="false"><path d="M12 21 2.6 11.7A5.6 5.6 0 0 1 12 4a5.6 5.6 0 0 1 9.4 7.7Z" fill="currentColor"/></svg>';
const BROKEN_SVG =
  '<svg viewBox="0 0 24 22" aria-hidden="true" focusable="false"><path class="l" d="M12 21 2.6 11.7A5.6 5.6 0 0 1 12 4l-1.6 4.4 2.6 3-2.2 3.4Z" fill="currentColor"/><path class="r" d="M12 21l1.2-6.2 2.2-3.4-2.6-3L12 4a5.6 5.6 0 0 1 9.4 7.7Z" fill="currentColor"/></svg>';

// Robot games: robots wait for the screen to finish replaying. The view sets this.
let screenBusy = () => false;

// A robot's pause: a blink to say it hasn't got the 2 of clubs, a beat for a
// forced card, a real think for the pass or a choice of cards.
function robotDelay(st, me, move, face, level) {
  return humanPause(screenBusy, () => {
    if (move.next) return ROBOT_PACE.next;
    if (move.none || st.phase === "find") return ROBOT_PACE.find;
    if (move.pass) return ROBOT_PACE.pass + Math.random() * 600;
    const legal = legalPlays(st, me, (s) => cardFace(st.players, face(s))).length;
    if (legal <= 1) return ROBOT_PACE.forced;
    return Math.min(ROBOT_PACE.max, ROBOT_PACE.play + ROBOT_PACE.option * legal + Math.random() * 380 - (level === "easy" ? 120 : 0));
  });
}

startGameShell({
  slug: "hearts",
  title: "Hearts",
  howToPlay,
  layout: "wide",
  settings,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  robots: () => settings.get().robots,
  createRobot: (session) => {
    const config = settings.get();
    return startRobot(session, {
      rules: makeRules(config, session.players.length),
      choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: config.level }),
      delay: (st, me, move, face) => robotDelay(st, me, move, face, config.level),
    });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const seats = session.players.map((p) => p.seat);
  const around = Array.from({ length: count }, (_, i) => (me + i) % count); // me, then clockwise (to my left)
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  // "You pass", "Bo passes"
  const verb = (p, s) => (p !== me ? s : /(ss|sh|ch|o)es$/.test(s) ? s.slice(0, -2) : s.replace(/s$/, ""));
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
  let picked = []; // the cards you picked to pass, in order
  let wantPass = null; // your pass, said before your turn: it goes when your turn comes
  let previous = null; // the match before a rematch, whose verdict may still be on its way
  let lastVerdict = "";
  let carried = seats.map(() => 0); // one hand a game: points from the games before
  const four = () => settings.get().fourColor;
  // The shared table (engine/cards/table.js).
  const table = cardTable({ prefix: "hr", play, animate: (ev, g) => animate(ev, g), done: (idle) => replayed(idle) });
  const { miniCard, fly, live, fast, wait, rectIn, flyLayer, hand, handCards } = table;
  const faceOf = (slot) => cardFace(count, match?.face(slot) ?? null);

  // "setup" is for this view (only from the room's creator); the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  bar.update({ badges: seats.map(() => el("span", { class: "dot", "aria-hidden": "true" })) });
  const status = el("p", { class: table.cls("status"), id: "hr-status", role: "status", "aria-live": "polite", tabindex: "-1" });

  // The others round the table: the next on your left, then across, then on your right.
  const POS = count === 4 ? ["left", "top", "right"] : ["left", "right"];
  const posOf = (p) => (p === me ? "bottom" : POS[around.indexOf(p) - 1]);
  const opps = around.slice(1).map((p, i) => {
    const seat = table.makeSeat({ p, name: session.players[p].name, pos: POS[i] });
    seat.won = table.makeWon(p);
    seat.points = el("span", { class: "hr-points mono", hidden: true });
    seat.mark = el("span", { class: "hr-picked", hidden: true, "aria-hidden": "true" }, "✓");
    seat.node.append(el("span", { class: "hr-seat-row" }, seat.won.node, seat.points));
    seat.pill.append(seat.mark);
    return seat;
  });
  const seatOf = (p) => opps.find((o) => o.p === p);

  // The middle: the trick, the deck while it's shuffled and dealt, the chips under it, a hand's tally.
  const trick = table.makeTrick(around.map((p) => [p, posOf(p)]));
  const stockEl = table.makeStock({ label: (left) => (left ? `The deck: ${plural(left, "card")} to deal` : "The deck") });
  // Out of sight between deals, but still laid out: the hand is sized from the deck's card width.
  const deckBox = el("div", { class: "hr-deck away", "aria-hidden": "true" }, el("div", { class: table.cls("stack") }, stockEl, table.riffle));
  const brokenChip = el("span", { class: "hr-broken", id: "hr-broken", hidden: true }, el("span", { class: "hr-heart" }), "Hearts broken");
  brokenChip.firstChild.innerHTML = BROKEN_SVG;
  const passChip = el("span", { class: "hr-pass-chip", id: "hr-pass-chip", hidden: true });
  trick.info.append(passChip, brokenChip);
  const tallyRows = el("div", { class: "hr-tally-rows" });
  const tallyTitle = el("strong", { class: "hr-tally-title" });
  const tally = el("div", { class: "hr-tally", id: "hr-tally", hidden: true }, tallyTitle, tallyRows);
  const centre = el("div", { class: "hr-centre" }, el("div", { class: "hr-trick-wrap" }, trick.node, deckBox, tally), trick.info, table.busyChip);

  // Your corner: the pass button and timer, your hand, your pill, tricks and points.
  const passLabel = el("span", {});
  const passNote = el("small", {});
  const passBtn = el("button", { class: "btn primary hr-pass", type: "button", id: "hr-pass", hidden: true, onclick: () => passNow() }, passLabel, passNote);
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "hr-timer", id: "hr-timer", hidden: true, role: "timer", "aria-label": "Time for your move" }, el("span", { class: "bar" }, timerFill), timerText);
  const actionBar = el("div", { class: "hr-bar", id: "hr-bar" }, passBtn, timer);
  const myCount = el("span", { class: "count mono" }, "0");
  const myWon = table.makeWon(me);
  const myPoints = el("span", { class: "hr-points mono", id: "hr-points", hidden: true });
  const myPill = el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, myName), myCount);
  const handHint = el("p", { class: table.cls("hand-hint"), id: "hr-hand-hint" });
  const meArea = el("div", { class: table.cls("me", `p-${me}`) }, actionBar, hand, el("div", { class: "hr-me-row" }, myPill, myWon.node, myPoints), handHint);
  const tableBox = el("div", { class: table.cls("table", `four-seats seats-${count}`), id: "hr-table" }, el("div", { class: table.cls("opps") }, opps.map((o) => o.node)), centre, meArea);
  const tableWrap = el("div", { class: table.cls("table-wrap") }, tableBox, flyLayer);

  const hint = el("p", { class: table.cls("hint"), id: "hr-hint" });
  const logList = el("ol", { class: table.cls("log"), id: "hr-log", "aria-label": "Recent moves" });
  const configLine = el("p", { class: table.cls("config"), id: "hr-config" });
  const note = el("p", { class: table.cls("note"), id: "hr-note" });

  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    classes: (p) => `p-${p}`,
    // The result moment: the winner's tricks and pill light up; a loss dims the table.
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "bell", highlight: winnerNodes(), board: tableBox }),
  });

  const rootBox = el(
    "div",
    { class: "hearts pc-game", dataset: { you: me === 0 ? "a" : me === 1 ? "b" : "", seat: me } },
    table.symbolHost,
    bar.node,
    status,
    el("div", { class: table.cls("main") }, tableWrap, el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, hint), logList)),
    configLine,
    note,
    result.node,
  );
  root.append(rootBox);

  // ---------- the table as drawn ----------
  const emptyView = (scores = seats.map(() => 0)) => ({ hands: seats.map(() => []), trick: [], won: seats.map(() => 0), points: seats.map(() => 0), scores: scores.slice(), broken: false, dir: "none", picks: seats.map(() => false), received: [], stock: 0, wins: -1, arriving: new Set(), flipping: new Set() });
  function viewFromState() {
    const st = match.state;
    return {
      hands: st.hands.map((h) => h.slice()),
      trick: st.trick.map((x) => ({ p: x.p, slot: x.slot })),
      won: st.won.map((w) => w.length / count),
      points: rawPoints(st),
      scores: st.scores.slice(),
      broken: st.broken,
      dir: st.dir,
      picks: st.picks.map(Boolean),
      received: st.phase === "pass" ? [] : st.received[me].slice(),
      stock: 0,
      wins: -1,
      arriving: new Set(),
      flipping: new Set(),
    };
  }
  // Hearts and the queen each seat has taken this hand.
  const rawPoints = (st) => st.won.map((slots) => slots.reduce((n, s) => n + (suitOf(faceOf(s)) === HEARTS ? 1 : faceOf(s) === QUEEN_SPADES ? 13 : 0), 0));
  const known = (slot) => (view.arriving.has(slot) || view.flipping.has(slot) ? null : faceOf(slot));
  const scoreOf = (p) => carried[p] + view.scores[p];

  // ---------- whose decision it is ----------
  function decision() {
    if (!match || match.phase !== "playing" || table.pending || ended) return null;
    return { player: match.state.turn, phase: match.state.phase };
  }
  const myDecision = () => {
    const d = decision();
    return d && d.player === me ? d : null;
  };
  // Your real choice now ("pass" or "play"), or null.
  function myChoice() {
    const d = myDecision();
    return d && match.canMove() && !forcedMove(match.state, me, faceOf) ? d.phase : null;
  }
  // The pass is yours to pick: in the pass phase, until you've passed (before your turn too).
  const picking = () => match?.phase === "playing" && match.state.phase === "pass" && !match.state.picks[me] && !ended;
  // ...and your hand has been dealt, so it has stopped sorting itself.
  const canPick = () => picking() && current?.type !== "deal" && view.hands[me].length > 0 && view.hands[me].every((s) => known(s) !== null);

  // ---------- rendering pieces ----------
  // Your hand by suit (clubs, diamonds, spades, hearts, alternating colours), low to high.
  const SUIT_ORDER = [3, 2, 0, 1];
  const sortKey = (slot) => {
    const f = known(slot);
    return f === null ? 1000 + slot : SUIT_ORDER.indexOf(suitOf(f)) * 20 + (f % 13 === 0 ? 14 : f % 13);
  };

  function renderHand() {
    const slots = view.hands[me].slice().sort((a, b) => sortKey(a) - sortKey(b));
    const choice = myChoice();
    const legal = new Set(choice === "play" ? legalPlays(match.state, me, faceOf) : []);
    const pass = canPick();
    const sent = new Set(match?.state?.picks?.[me] ?? []);
    picked = picked.filter((s) => slots.includes(s));
    const received = new Set(view.received);
    table.renderHand(slots, {
      face: known,
      arriving: view.arriving,
      first: legal.size ? slots.find((s) => legal.has(s)) : picked[0],
      look: (slot, face) => {
        const isPicked = picked.includes(slot) || sent.has(slot);
        const playable = legal.has(slot);
        return {
          lift: isPicked,
          classes: { playable, dim: choice === "play" && !playable, picked: isPicked, pickable: pass && !sent.size, received: received.has(slot) },
          label:
            face === null
              ? "A card, still being dealt"
              : `${cardWords(face)}${received.has(slot) ? ", passed to you" : ""}${playable ? ", play it" : choice === "play" ? ", can't be played now" : ""}${isPicked ? ", picked to pass" : ""}`,
        };
      },
    });
    myCount.textContent = String(view.hands[me].length);
  }

  function renderSeats() {
    for (const o of opps) {
      const n = view.hands[o.p].length;
      const pts = view.points[o.p];
      o.render(view.hands[o.p], view.arriving, `${session.players[o.p].name}: ${plural(n, "card")}, ${plural(view.won[o.p], "trick")} won${pts ? `, ${plural(pts, "point")} this hand` : ""}`);
      o.won.render(view.won[o.p]);
      o.points.hidden = !pts && !o.points.dataset.counting;
      if (!o.points.dataset.counting) o.points.textContent = `♥ ${pts}`;
      o.mark.hidden = !(view.dir !== "none" && view.picks[o.p] && match?.state?.phase === "pass");
    }
    myWon.render(view.won[me]);
    myPoints.hidden = !view.points[me];
    myPoints.textContent = `♥ ${view.points[me]}`;
  }

  function renderCentre() {
    const st = match?.state;
    const lead = view.trick.length ? known(view.trick[0].slot) : null;
    const plays = view.trick.filter((x) => !view.arriving.has(x.slot));
    trick.render(view.trick, {
      face: known,
      arriving: view.arriving,
      suit: lead === null ? null : suitOf(lead),
      wins: view.wins,
      label: plays.length ? `The trick: ${plays.map((x) => `${nameOf(x.p)} ${cardName(known(x.slot) ?? 0)}`).join(", ")}${lead !== null ? `. Follow ${SUIT_NAMES[suitOf(lead)].toLowerCase()}` : ""}` : "The trick is empty",
    });
    brokenChip.hidden = !view.broken;
    const passing = st && st.phase === "pass" && view.dir !== "none" && match.phase === "playing";
    passChip.hidden = !passing;
    if (passing) passChip.textContent = `Pass ${DIR_WORD[view.dir]} ${DIR_ARROW[view.dir]} ${nameOf(passTo(st, me))}`;
    const dealing = view.stock > 0 || match?.busy === "shuffling";
    deckBox.classList.toggle("away", !dealing);
    if (dealing) table.renderStock(view.stock || count * handSize(count));
    const busy = match?.busy && match.phase !== "over" ? match.busy : null;
    table.renderBusy(busy, { starting: match?.phase === "starting", redraw: () => !destroyed && renderCentre() });
  }

  // ---------- motion ----------
  function seatRect(p, slot) {
    if (p === me) {
      const btn = slot !== undefined && handCards.get(slot);
      return btn ? rectIn(btn.firstChild) : rectIn(hand);
    }
    return seatOf(p).rect(slot);
  }
  const wonRect = (p) => (p === me ? myWon.rect() : seatOf(p).won.rect());

  // Moves `slot` from the deck to player p's hand.
  async function dealTo(p, slot, g, ms, sound = "deal") {
    const from = table.stockRect();
    view.stock = Math.max(0, view.stock - 1);
    view.hands[p].push(slot);
    view.arriving.add(slot);
    render();
    if (sound) play(sound);
    const face = p === me ? faceOf(slot) : null;
    await fly(face, from, seatRect(p, slot), { ms, turn: face !== null ? "up" : null, g });
    view.arriving.delete(slot);
    if (live(g)) render();
  }

  // A word over a seat: "No 2♣", "Picked".
  function say(p, text, g) {
    table.bubble(p === me ? actionBar : seatOf(p).node, p, text, g, PACE.bubble);
  }

  // A moment over the table, in the player's colour: "Shot the moon!".
  function moment(text, p, kind, g, art = "") {
    if (!live(g) || fast()) return;
    const node = el("div", { class: `hr-moment p-${p} ${kind}`, role: "presentation" }, el("span", { class: "art" }), el("span", { class: "words" }, text));
    node.firstChild.innerHTML = art;
    flyLayer.append(node);
    const end = () => node.remove();
    node.animate(
      [
        { transform: "translate(-50%, -40%) scale(.5)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1.06)", opacity: 1, offset: 0.2 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.32 },
        { transform: "translate(-50%, -52%) scale(1)", opacity: 1, offset: 0.82 },
        { transform: "translate(-50%, -62%) scale(.96)", opacity: 0 },
      ],
      { duration: PACE.moment * 2.6, easing: easing("out") },
    ).finished.then(end, end);
  }

  // The felt takes a weight: the table nudges down and back.
  function thump(g, px = 4) {
    if (fast() || !live(g)) return;
    tableBox.animate([{ transform: "translateY(0)" }, { transform: `translateY(${px}px)`, offset: 0.22 }, { transform: "translateY(-1px)", offset: 0.6 }, { transform: "translateY(0)" }], { duration: tokenMs("slow") * 1.4, easing: easing("out") });
  }

  // The queen of spades lands with weight: she drops onto the trick, a shadow spreads over the felt.
  function queenLands(p, g) {
    play("queen");
    if (fast() || !live(g)) return;
    thump(g, 6);
    const card = trick.node.querySelector(`.pc-trick-spot[data-seat="${p}"] .pc-card`);
    const tilt = card?.style.transform ?? "";
    card?.animate([{ transform: `${tilt} translateY(-18px) scale(1.28)` }, { transform: `${tilt} translateY(2px) scale(.94)`, offset: 0.45 }, { transform: `${tilt} translateY(0) scale(1)` }], { duration: tokenMs("slow") * 2, easing: easing("out") });
    const shade = el("div", { class: "hr-shade", "aria-hidden": "true" });
    const r = rectIn(card ?? trick.node);
    shade.style.transform = `translate(${r.x + r.w / 2}px, ${r.y + r.h / 2}px)`;
    flyLayer.append(shade);
    shade
      .animate([{ transform: `translate(${r.x + r.w / 2}px, ${r.y + r.h / 2}px) scale(.2)`, opacity: 0.85 }, { transform: `translate(${r.x + r.w / 2}px, ${r.y + r.h / 2}px) scale(3.2)`, opacity: 0 }], { duration: tokenMs("slow") * 4, easing: easing("out") })
      .finished.then(() => shade.remove(), () => shade.remove());
  }

  // Hearts break: the chip's heart cracks in two with a heartbeat.
  function heartsBreak(g) {
    play("broken");
    if (fast() || !live(g)) return;
    const [l, r] = brokenChip.querySelectorAll("path");
    const ms = tokenMs("slow") * 2.4;
    brokenChip.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1.18)", opacity: 1, offset: 0.25 }, { transform: "scale(1)", offset: 0.4 }, { transform: "scale(1.1)", offset: 0.6 }, { transform: "scale(1)" }], { duration: ms, easing: easing("out") });
    l?.animate([{ transform: "translate(1px, 0) rotate(0)" }, { transform: "translate(-1.5px, 0) rotate(-8deg)", offset: 0.6 }, { transform: "translate(-1px, 0) rotate(-5deg)" }], { duration: ms, easing: easing("out"), fill: "forwards" });
    r?.animate([{ transform: "translate(-1px, 0) rotate(0)" }, { transform: "translate(1.5px, 0) rotate(8deg)", offset: 0.6 }, { transform: "translate(1px, 0) rotate(5deg)" }], { duration: ms, easing: easing("out"), fill: "forwards" });
    const host = rectIn(trick.node);
    for (let i = 0; i < 7; i++) {
      const node = el("span", { class: "pc-fx hr-mini-heart" });
      node.innerHTML = HEART_SVG;
      flyLayer.append(node);
      const a = (i / 7) * Math.PI * 2;
      const cx = host.x + host.w / 2;
      const cy = host.y + host.h / 2;
      const d = Math.min(host.w, host.h) * 0.55;
      node
        .animate([{ transform: `translate(${cx}px, ${cy}px) scale(.3)`, opacity: 0 }, { transform: `translate(${cx + Math.cos(a) * d * 0.5}px, ${cy + Math.sin(a) * d * 0.5}px) scale(1)`, opacity: 1, offset: 0.3 }, { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d - 20}px) scale(.6)`, opacity: 0 }], { duration: ms * 1.4, easing: easing("out") })
        .finished.then(() => node.remove(), () => node.remove());
    }
  }

  // A number counting up, a tick for each step (it lands at once with reduced motion).
  async function countUp(node, from, to, g, text) {
    node.dataset.counting = "1";
    const steps = fast() ? 0 : Math.min(Math.abs(to - from), 26);
    for (let i = 1; i <= steps && live(g); i++) {
      node.textContent = text(Math.round(from + (to - from) * Math.min(1, i / steps)));
      play("tally", { n: i });
      await wait(PACE.tally * table.pace(), g);
    }
    delete node.dataset.counting;
    if (!live(g)) return;
    if (!steps && to !== from) play("tally");
    node.textContent = text(to);
  }

  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    if (ev.type === "deal") {
      // The deal waits for the deck: every browser shuffles it first.
      while (match.busy === "shuffling" && live(g)) await new Promise((r) => setTimeout(r, 60));
      if (!live(g)) return;
      view = { ...emptyView(view?.scores), dir: ev.dir, stock: count * handSize(count) };
      picked = [];
      wantPass = null;
      render();
      await table.deal(ev.hands, ev.opener, { gap: PACE.deal, ms: PACE.dealFly }, (p, slot, ms, sound) => dealTo(p, slot, g, ms, sound), g);
      if (!live(g)) return;
      view.stock = 0;
      render();
      addLog({ text: `Hand ${ev.hand}: ${ev.dir === "none" ? "no pass this time" : `pass three ${DIR_WORD[ev.dir]}`}` });
    } else if (ev.type === "pick") {
      view.picks[ev.p] = true;
      if (ev.p !== me) say(ev.p, "Picked", g);
      render();
    } else if (ev.type === "passed") {
      const to = (q) => passTo({ dir: ev.dir, players: count }, q);
      const from = around.find((q) => to(q) === me);
      await passCards(ev, to, from, g, k);
      if (!live(g)) return;
      addLog({ player: me, faces: ev.picks[me].map(faceOf), text: `You passed ${ev.picks[me].map((s) => cardName(faceOf(s))).join(" ")} to ${nameOf(to(me))}` });
      // Named once their envelopes are open (see renderLog).
      addLog({ player: from, slots: ev.picks[from], faces: ev.picks[from].map(faceOf), text: `${nameOf(from)} passed you three cards`, named: (fs) => `${nameOf(from)} passed you ${fs.map(cardName).join(" ")}` });
    } else if (ev.type === "none") {
      say(ev.p, "No 2♣", g);
      await wait(PACE.bubble * 0.35 * k, g);
    } else if (ev.type === "play") {
      const from = seatRect(ev.p, ev.slot);
      view.hands[ev.p] = view.hands[ev.p].filter((s) => s !== ev.slot);
      view.received = view.received.filter((s) => s !== ev.slot);
      view.trick.push({ p: ev.p, slot: ev.slot });
      view.arriving.add(ev.slot);
      render();
      play("play");
      await fly(ev.face, from, trick.rect(ev.p), { ms: PACE.play * k, turn: ev.p === me ? null : "up", spin: ((ev.slot * 37) % 9) - 4, g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      render();
      if (ev.face === QUEEN_SPADES) queenLands(ev.p, g);
      addLog({ player: ev.p, face: ev.face, kind: ev.face === QUEEN_SPADES ? "queen" : "", text: `${nameOf(ev.p)} ${ev.lead ? verb(ev.p, "leads") : verb(ev.p, "plays")} ${cardWords(ev.face)}` });
      if (ev.face === QUEEN_SPADES) await wait(PACE.look * k, g);
    } else if (ev.type === "broken") {
      view.broken = true;
      render();
      heartsBreak(g);
      addLog({ player: ev.p, kind: "broken", text: "Hearts are broken" });
    } else if (ev.type === "trick") {
      await wait(PACE.look * k, g);
      if (!live(g)) return;
      view.wins = ev.winner;
      render();
      await wait(PACE.look * 0.6 * k, g);
      if (!live(g)) return;
      play("sweep");
      await trick.gather(ev.plays, ev.winner, wonRect(ev.winner), { face: faceOf, ms: PACE.gather * k, g });
      if (!live(g)) return;
      view.trick = [];
      view.wins = -1;
      view.won[ev.winner]++;
      const raw = ev.plays.reduce((n, x) => n + (suitOf(x.face) === HEARTS ? 1 : x.face === QUEEN_SPADES ? 13 : 0), 0);
      view.points[ev.winner] += raw;
      render();
      addLog({ player: ev.winner, faces: ev.plays.filter((x) => isPoint(x.face)).map((x) => x.face), text: raw ? `${nameOf(ev.winner)} ${verb(ev.winner, "takes")} the trick: ${plural(raw, "point")}` : `${nameOf(ev.winner)} ${verb(ev.winner, "takes")} the trick` });
    } else if (ev.type === "score") {
      await showTally(ev, g, k);
    } else if (ev.type === "lost") {
      addLog({ kind: "broken", text: "Nobody had the 2 of clubs: someone lied, and the audit will say who" });
    } else if (ev.type === "gather") {
      await gather(g, k);
    }
    current = null;
    await wait(PACE.between * k, g);
  }

  // The pass: each seat's three cards leave face down toward their seat; yours arrive and turn up in your hand.
  async function passCards(ev, to, from, g, k) {
    play("pass");
    const flights = [];
    for (let q = 0; q < count; q++) {
      const cards = ev.picks[q].map((s) => ({ face: q === me ? faceOf(s) : null, rect: seatRect(q, s) }));
      flights.push(table.sendCards(cards, seatRect(to(q)), { ms: PACE.pass * k, g }));
    }
    for (let q = 0; q < count; q++) view.hands[q] = view.hands[q].filter((s) => !ev.picks[q].includes(s));
    picked = [];
    // The cards coming to you land face down, then turn up.
    const mine = ev.picks[from];
    for (const s of mine) view.flipping.add(s);
    render();
    await Promise.all(flights);
    if (!live(g)) return;
    for (let q = 0; q < count; q++) view.hands[to(q)].push(...ev.picks[q]);
    view.received = mine.slice();
    view.picks = seats.map(() => false);
    render();
    await wait(tokenMs("med"), g);
    for (const s of mine) view.flipping.delete(s);
    render();
    await wait(tokenMs("slow"), g);
  }

  // The hand's points tally up: each seat's hearts and queen, the moon, then the totals.
  async function showTally(ev, g, k) {
    const rows = around.map((p) => {
      const add = el("span", { class: "add mono" }, "0");
      const total = el("span", { class: "total mono" }, String(scoreOf(p)));
      const row = el("div", { class: `hr-tally-row p-${p} ${p === me ? "mine" : ""}` }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "who" }, p === me ? "You" : session.players[p].name), add, total);
      return { p, add, total, row };
    });
    tallyTitle.textContent = ev.moon >= 0 ? `${nameOf(ev.moon)} shot the moon!` : `Hand ${ev.hand}`;
    tallyRows.replaceChildren(...rows.map((r) => r.row));
    // The moon rises first, then the points.
    if (ev.moon >= 0) {
      play("moon");
      moment(ev.moon === me ? "You shot the moon!" : `${session.players[ev.moon].name} shot the moon!`, ev.moon, "moon", g, MOON_SVG);
      table.confetti(rectIn(trick.node), ev.moon, seats, g);
      await wait(PACE.moment * 2.4 * k, g);
      if (!live(g)) return;
    }
    tally.hidden = false;
    tally.className = `hr-tally ${ev.moon >= 0 ? `moon p-${ev.moon}` : ""}`;
    render();
    if (!fast()) tally.animate([{ transform: "translate(-50%, -50%) scale(.85)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 1 }], { duration: tokenMs("slow"), easing: easing("spring") });
    for (const r of rows) {
      if (!live(g)) return;
      const add = ev.add[r.p];
      r.row.classList.add("on");
      await countUp(r.add, 0, add, g, signed);
      if (add) await countUp(r.total, scoreOf(r.p), scoreOf(r.p) + add, g, String);
      else r.total.textContent = String(scoreOf(r.p));
    }
    if (!live(g)) return;
    view.scores = ev.scores.slice();
    render();
    const best = Math.min(...ev.scores.map((s, p) => carried[p] + s));
    for (const r of rows) r.row.classList.toggle("low", scoreOf(r.p) === best);
    addLog({ player: ev.moon >= 0 ? ev.moon : undefined, kind: ev.moon >= 0 ? "moon" : "", text: ev.moon >= 0 ? `${nameOf(ev.moon)} shot the moon: ${config.moon === "others" ? "26 to everyone else" : "26 off"}` : `Hand ${ev.hand}: ${around.map((p) => `${nameOf(p)} ${signed(ev.add[p])}`).join(", ")}` });
    await wait(PACE.bubble * k, g);
  }

  // The cards go back for the next shuffle: a few fly, face down, from the tricks won to the deck.
  async function gather(g, k) {
    play("gather");
    tally.hidden = true;
    view.stock = 1;
    render();
    const target = table.stockRect();
    const from = around.flatMap((p) => (view.won[p] ? [wonRect(p), wonRect(p)] : []));
    await Promise.all(from.map((r, i) => wait(i * 30 * k, g).then(() => fly(null, r, target, { ms: PACE.gather * k, g }))));
    if (!live(g)) return;
    trick.clear();
    view = { ...emptyView(view.scores) };
    render();
  }

  const enqueue = (ev) => table.enqueue(ev);
  // After each event: once the screen has caught up, it draws the match as it stands.
  function replayed(idle) {
    if (idle) {
      current = null;
      view = viewFromState();
      for (const robot of window.ddp.robots || []) robot.poke?.();
    }
    render();
  }

  // ---------- log ----------
  const logLine = (e) => [e.faces ? el("span", { class: "hr-minis" }, e.faces.map((f) => miniCard(f))) : e.face !== undefined ? miniCard(e.face) : null, el("span", {}, e.text)];
  function addLog(entry) {
    if (entry.named && entry.faces.every((f) => f !== null)) entry.text = entry.named(entry.faces);
    entry.node = el("li", { class: `${entry.player === undefined ? "" : `p-${entry.player}`} ${entry.kind || ""} fresh` }, logLine(entry));
    log = [entry, ...log].slice(0, 7);
    log.slice(1).forEach((e) => e.node.classList.remove("fresh"));
    logList.replaceChildren(...log.map((e) => e.node));
    renderLog();
  }
  // Cards passed to you are named once their faces have arrived.
  function renderLog() {
    for (const e of log) {
      if (!e.named || e.faces.every((f) => f !== null)) continue;
      const faces = e.slots.map(faceOf);
      if (faces.some((f) => f === null)) continue;
      e.faces = faces;
      e.text = e.named(faces);
      e.node.replaceChildren(...logLine(e));
    }
  }

  // ---------- your moves ----------
  table.onPick((slot) => {
    if (canPick()) return togglePick(slot);
    if (myChoice() !== "play") return;
    if (!legalPlays(match.state, me, faceOf).includes(slot)) {
      play("nope");
      return toast(whyNot(slot));
    }
    match.play({ play: slot });
  });

  // Why a card can't be played now, in words.
  function whyNot(slot) {
    const st = match.state;
    const f = faceOf(slot);
    if (st.trick.length) {
      const lead = suitOf(st.trick[0].face);
      const can = match.state.hands[me].some((s) => suitOf(faceOf(s)) === lead);
      if (suitOf(f) !== lead && can) return `Follow suit: play a ${SUIT_NAMES[lead].toLowerCase().replace(/s$/, "")}`;
      if (st.tricks === 0 && isPoint(f)) return "No points on the first trick";
      return "You can't play that one now";
    }
    if (st.tricks === 0) return "The 2 of clubs leads";
    return suitOf(f) === HEARTS ? "Hearts aren't broken yet: lead another suit" : "You can't lead that one now";
  }

  function togglePick(slot) {
    if (wantPass) return;
    if (picked.includes(slot)) picked = picked.filter((s) => s !== slot);
    else if (picked.length < PASS_COUNT) picked = [...picked, slot];
    else {
      play("nope");
      return toast("You've picked three: tap one to put it back");
    }
    play("deal", { offset: -4 });
    render();
  }

  function passNow() {
    if (!picking() || picked.length !== PASS_COUNT) return;
    if (myChoice() === "pass") return match.play({ pass: picked.slice() });
    wantPass = picked.slice();
    render();
  }

  // P passes the three you picked; Escape puts them back.
  function onKey(e) {
    if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "Escape" && picking() && (picked.length || wantPass)) {
      picked = [];
      wantPass = null;
      render();
    } else if (e.key.toLowerCase() === "p") passNow();
  }
  addEventListener("keydown", onKey);

  // ---------- render ----------
  function describe(ev) {
    if (!ev) return null;
    if (ev.type === "deal") return `Dealing hand ${ev.hand}…`;
    if (ev.type === "passed") return `Passing ${DIR_WORD[ev.dir]}…`;
    if (ev.type === "play") return `${nameOf(ev.p)} ${ev.lead ? verb(ev.p, "leads") : verb(ev.p, "plays")} ${cardName(ev.face)}.`;
    if (ev.type === "trick") return `${nameOf(ev.winner)} ${verb(ev.winner, "takes")} the trick.`;
    if (ev.type === "score") return ev.moon >= 0 ? `${nameOf(ev.moon)} shot the moon!` : `Hand ${ev.hand}: the points.`;
    if (ev.type === "gather") return "Shuffling for the next hand…";
    return null;
  }

  function statusText() {
    if (ended) return "The game has ended.";
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    if (match.phase === "aborted") return "Match stopped.";
    if (match.phase === "starting") return DECK_WORK[match.busy]?.[0] ?? "Getting ready…";
    const now = describe(current);
    if (now) return now;
    if (table.pending) return status.textContent || "…";
    if (match.phase === "over") return overLine(st);
    const d = decision();
    if (!d) return "…";
    if (d.phase === "pass") {
      if (st.picks[me]) return `Waiting for ${listOf(seats.filter((p) => !st.picks[p]).map(nameOf))} to pick…`;
      const to = nameOf(passTo(st, me));
      if (wantPass) return `Your three go to ${to} when it's your turn.`;
      return picked.length === PASS_COUNT ? `Pass them ${DIR_WORD[st.dir]} to ${to}.` : `Pick three cards to pass ${DIR_WORD[st.dir]} to ${to} (${picked.length} of 3).`;
    }
    if (d.phase === "find") return d.player === me && legalPlays(st, me, faceOf).length ? "You lead the 2 of clubs." : "Who has the 2 of clubs?";
    if (d.phase === "result") return "On to the next hand…";
    if (d.player !== me) return `${session.players[d.player].name}'s turn…`;
    if (match.busy) return DECK_WORK[match.busy][0];
    if (myChoice() !== "play") return "Playing your only card…";
    if (!st.trick.length) return st.broken ? "Your lead." : "Your lead: hearts aren't broken yet.";
    const lead = suitOf(st.trick[0].face);
    const can = legalPlays(st, me, faceOf).some((s) => suitOf(faceOf(s)) === lead);
    return can ? `Your turn: follow ${SUIT_NAMES[lead].toLowerCase()}.` : `Your turn: no ${SUIT_NAMES[lead].toLowerCase()}, play anything${st.tricks === 0 ? " but points" : ""}.`;
  }

  function overLine(st) {
    if (st.winner === -2 && !st.winners.length) return "The 2 of clubs went missing: the game stopped.";
    // This game's own points decide it; one hand a game carries totals across rematches only for show.
    const low = Math.min(...st.scores);
    if (st.winners.length > 1) return `${listOf(st.winners.map(nameOf))} share the win with ${low}.`;
    return `${st.winner === me ? "You win" : `${nameOf(st.winner)} wins`} with ${plural(low, "point")}.`;
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = ended ? "ended" : match?.phase || "setup";
    rootBox.dataset.phase = phase;
    rootBox.classList.toggle("four-colour", four());
    const d = decision();
    const shownTurn = current?.p ?? (phase === "playing" && st?.phase !== "pass" ? st?.turn : undefined);
    if (view) {
      bar.update({
        turn: phase === "playing" && shownTurn !== undefined ? shownTurn : -1,
        notes: seats.map((p) => (st ? plural(view.hands[p].length, "card") : "")),
        score: { wins: seats.map((p) => scoreOf(p)) },
      });
    }
    for (const o of opps) o.node.classList.toggle("active", shownTurn === o.p && phase === "playing");
    meArea.classList.toggle("active", (shownTurn === me || picking()) && phase === "playing");
    status.textContent = statusText();
    const mine = myDecision() || picking();
    status.className = `${table.cls("status")} ${mine ? `mine p-${me}` : d ? `p-${d.player}` : ""}`;
    if (view) {
      renderSeats();
      renderCentre();
      renderHand();
    }
    renderActions();
    renderLog();
    renderTimer();
    renderResult();
    const choice = myChoice();
    setTabAlert(choice || (picking() && !wantPass && !picked.length) ? "Your turn" : null);
    if (choice === "play" || (choice === "pass" && !wantPass)) {
      const key = `${m}:${st.moves}`;
      if (cuedTurn !== key) {
        cuedTurn = key;
        play("turn");
      }
    }
    if (choice === "pass" && wantPass) {
      const move = { pass: wantPass };
      wantPass = null;
      setTimeout(() => myChoice() === "pass" && match.play(move), 0);
    }
    autoMove();
  }

  function renderActions() {
    const st = match?.state;
    const pass = picking() && view?.hands[me].length;
    const hadFocus = actionBar.contains(document.activeElement) ? document.activeElement : null;
    passBtn.hidden = !pass;
    if (pass) {
      passLabel.textContent = `Pass ${DIR_WORD[st.dir]} ${DIR_ARROW[st.dir]}`;
      passNote.textContent = wantPass ? "when it's your turn" : picked.length === PASS_COUNT ? `to ${nameOf(passTo(st, me))}` : `${picked.length} of 3 picked`;
      passBtn.disabled = picked.length !== PASS_COUNT || !!wantPass;
    }
    if (hadFocus?.hidden || hadFocus?.disabled) status.focus({ preventScroll: true });
    const choice = myChoice();
    tableBox.classList.toggle("my-turn", !!choice || !!pass);
    handHint.textContent = pass ? (wantPass ? "Esc puts them back" : "Tap three cards to pass") : choice === "play" ? "Tap a lit card to play it" : view?.received.length ? "The dots mark the cards passed to you" : "";
    if (!match || match.phase !== "playing") hint.textContent = "";
    else hint.textContent = "Follow suit if you can. Each heart is 1 point and the queen of spades 13; the lowest score wins. Hearts can't be led until a heart or the queen has been played. Keys: arrows and Enter in your hand, P to pass, Esc to clear.";
    hint.parentNode.hidden = !hint.textContent;
  }

  // The moves nobody chooses: made for you, after a short beat.
  function autoMove() {
    const d = myDecision();
    if (!d || !match.canMove()) return;
    const move = forcedMove(match.state, me, faceOf);
    if (!move) return;
    const key = `${m}:${match.state.moves}`;
    if (autoKey === key) return;
    autoKey = key;
    const ms = fast() ? 0 : AUTO[d.phase] ?? AUTO.play;
    const g = table.gen;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (live(g) && myDecision() && match.canMove() && `${m}:${match.state.moves}` === key) match.play(forcedMove(match.state, me, faceOf));
    }, ms);
  }

  // The clock runs for a pass or a card to play (on your side, only when it's a real choice).
  function timedNow(d) {
    if (!d || (d.phase !== "pass" && d.phase !== "play")) return false;
    return d.player !== me || !forcedMove(match.state, me, faceOf);
  }
  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    const ready = !!d && !match.busy;
    const key = `${m}:${match?.state?.moves}:${ready}`;
    timer.hidden = !secs || !ready || !timedNow(d);
    if (timer.hidden) return;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (secs * 1000))).toFixed(3)})`;
    timer.className = `hr-timer p-${d.player} ${left < 5000 ? "low" : ""}`;
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
    if (!d || timer.hidden) return;
    const left = deadline - performance.now();
    if (d.player === me && left <= 0 && timedOut !== deadlineKey && myChoice()) {
      timedOut = deadlineKey;
      // Your own picks go if you made three; else the robot's.
      const move = d.phase === "pass" && picked.length === PASS_COUNT ? { pass: picked.slice() } : timeoutMove(match.state, me, (s) => match.face(s));
      wantPass = null;
      toast(move.pass ? `Time's up: passed ${move.pass.map((s) => cardName(faceOf(s))).join(" ")} for you` : `Time's up: played the ${cardName(faceOf(move.play))} for you`);
      match.play(move);
    } else if (d.player !== me && left <= -CLAIM_GRACE_MS) {
      status.textContent = `Waiting for ${session.players[d.player].name}'s browser…`;
    }
  }
  const ticker = setInterval(tick, 200);

  // ---------- the end ----------
  // The winner's pill and tricks, in the order they light up.
  function winnerNodes() {
    const st = match?.state;
    if (!st || match.phase !== "over") return [];
    return st.winners.flatMap((p) => (p === me ? [myPill, myWon.node] : [seatOf(p).pill, seatOf(p).won.node]));
  }

  const verdictText = (v) => verdictOf(v, nameOf);
  function verdictLine() {
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "hr-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle and pass proved, and every hand replayed with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "hr-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    if (match.phase === "aborted") return null;
    return el("p", { class: "verdict", id: "hr-verdict" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Checking every shuffle and replaying the game…");
  }

  // The score sheet: a row a hand, a column a player, the totals at the foot.
  function scoreSheet(st) {
    const cols = around;
    const head = el("tr", {}, el("th", { scope: "col" }, "Hand"), ...cols.map((p) => el("th", { scope: "col", class: `p-${p} ${p === me ? "mine" : ""}` }, el("span", { class: "who" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "nm" }, p === me ? "You" : session.players[p].name)))));
    const rows = st.history.map((h) =>
      el(
        "tr",
        {},
        el("th", { scope: "row", class: "mono" }, `${h.hand}${h.moon >= 0 ? " ☾" : ""}`),
        ...cols.map((p) => el("td", { class: `mono ${h.moon === p ? "moon" : ""}` }, signed(h.add[p]))),
      ),
    );
    const sum = (p) => carried[p] + st.scores[p];
    const low = Math.min(...cols.map(sum));
    const totals = el("tr", { class: "totals" }, el("th", { scope: "row" }, carried.some(Boolean) ? "Total*" : "Total"), ...cols.map((p) => el("td", { class: `mono ${sum(p) === low ? "best" : ""}` }, String(sum(p)))));
    const tableNode = el("table", { class: "hr-sheet", id: "hr-sheet" }, el("thead", {}, head), el("tbody", {}, rows), el("tfoot", {}, totals));
    const box = el("div", { class: "hr-sheet-box", tabindex: "0", role: "region", "aria-label": "Score sheet" }, tableNode);
    requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
    return el("div", { class: "hr-over pc-game" }, box, carried.some(Boolean) ? el("small", { class: "hr-carried" }, "* with the games before") : null, verdictLine());
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
        extra = match.disputing || match.verdict ? el("div", { class: "hr-over pc-game" }, match.verdict ? verdictLine() : el("p", { class: "verdict" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Checking who was right about the passed card…")) : null;
      }
      // "Al stopped the match: you passed…": you, mid-sentence.
      const who = (p) => (p === me && p !== match.abortSeat ? "you" : nameOf(p));
      return result.show({ stopped: true, reason: abortText({ reason: match.abortReason, seat: match.abortSeat, about: match.abortAbout }, who), extra });
    }
    const st = match.state;
    const key = `${m}:${!!match.verdict}`;
    if (shownFor !== key) {
      shownFor = key;
      extra = scoreSheet(st);
    }
    if (st.winner === -2 && !st.winners.length) return result.show({ stopped: true, reason: "Every player said they hadn't got the 2 of clubs, so someone lied. The audit names them.", extra });
    const places = seats.slice().sort((a, b) => st.scores[a] - st.scores[b]).map((p) => ({ seat: p, note: plural(st.scores[p], "point") }));
    const hands = plural(st.history.length, "hand");
    const top = seats.reduce((a, b) => (st.scores[b] > st.scores[a] ? b : a));
    let reason;
    if (st.winners.length > 1) reason = `${listOf(st.winners.map(nameOf))} share the lowest score${config.target ? ` after ${hands}` : ""}.`;
    else if (config.target) reason = `${nameOf(top)} reached ${config.target} after ${hands}, so the lowest score wins.`;
    else reason = "The lowest score after the hand wins.";
    result.show({ winner: st.winners.length === 1 ? st.winner : -1, reason, places, extra });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    // One hand a game: the scores add up across rematches.
    if (match?.phase === "over" && !config.target) carried = carried.map((c, p) => c + match.state.scores[p]);
    m += 1;
    table.reset();
    trick.clear();
    clearTimeout(autoTimer);
    current = null;
    view = emptyView();
    log = [];
    cuedTurn = "";
    autoKey = "";
    deadlineKey = "";
    timedOut = "";
    picked = [];
    wantPass = null;
    shownFor = null;
    lastVerdict = "";
    tally.hidden = true;
    logList.replaceChildren();
    const opponents = listOf(around.slice(1).map((p) => session.players[p].name));
    note.textContent = m === 1 ? `Playing ${opponents}. Good luck!` : `Rematch #${m - 1}: a fresh deck, shuffled by every browser.`;
    const mt = new CardMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    previous = match;
    match = mt;
    window.ddp.match = mt; // browser tests read this
    let dealt = false;
    const firstDeal = () => {
      if (dealt || !mt.state) return;
      dealt = true;
      enqueue({ type: "deal", hand: 1, dir: mt.state.dir, opener: mt.state.opener, hands: mt.state.hands.map((h) => h.slice()) });
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
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = `${again}${nameOf(mt.state.opener)} ${verb(mt.state.opener, "passes")} first (drawn by every browser).${lastVerdict && ` ${lastVerdict}.`}`;
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
    const parts = [c.target ? `Game to ${c.target}` : "One hand a game", c.passing ? "pass three" : "no passing", c.moon === "others" ? "the moon: everyone else +26" : "the moon: shooter −26"];
    if (c.jack) parts.push("jack of diamonds −10");
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s a move`);
    if (count === 3) parts.push("three players: no 2♦");
    if (robotGame) parts.push(`${LEVEL_NAME[c.level]} robots`);
    return parts.join(" · ");
  }

  // The room's settings come from whoever created it (robots use ours).
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

  // A player left: the engine ends the game for everyone; say so plainly, and whether the game got checked.
  function onEnd(reason, seatLeft) {
    if (reason === "self") return;
    ended = true;
    table.stop();
    clearTimeout(autoTimer);
    table.shuffling(false);
    const judged = match?.phase === "starting" && previous ? previous : match;
    leaveNotice({ root, session, seat: seatLeft, match: judged, prefix: "hr", game: "Hearts", nameOf, facts: (st, p) => plural(carried[p] + st.scores[p], "point") });
    render();
  }

  screenBusy = () => table.pending > 0;
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const resize = new ResizeObserver(() => view && render());
  resize.observe(tableBox);
  const offs = [offMsg, session.on("end", onEnd), session.on("rematch-start", () => config && newMatch())];
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
