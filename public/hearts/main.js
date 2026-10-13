// Hearts page: mounts the engine shell and renders a CardMatch. The rules live
// in rules.js; the card table's shared pieces (art, seats, hand, the trick,
// won tricks, the pass and motion) in engine/cards/. This file is the view:
// four (or three) seats round the trick, the pass, the queen's weight, hearts
// breaking, each hand's points tallying up and the moon (drawn and moved by
// art.js, which the tutorial shares). Leading the 2 of
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
import { cardTable, DECK_WORK } from "../engine/cards/table.js";
import { humanPause } from "../engine/cards/paced-robot.js";
import { leaveNotice, abortText, verdictText as verdictOf } from "../engine/cards/leave-notice.js";
import { cardWords, cardName, suitOf, SUIT_NAMES } from "../engine/cards/faces.js";
import { makeRules, normalizeConfig, forcedMove, legalPlays, passTo, cardFace, handSize, isPoint, QUEEN_SPADES, MIN_PLAYERS, MAX_PLAYERS, PASS_COUNT } from "./rules.js";
import { PACE, DIR_WORD, plural, signed, handOrder, tableView, whyNot, heartsTable } from "./art.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";

// How long robots take before each move (robotPause() scales these in tests).
const ROBOT_PACE = { pass: 1500, play: 620, option: 60, forced: 360, find: 140, next: 1700, max: 2100 };
// Your browser's own moves nobody chooses, after a short beat.
const AUTO = { find: 260, play: 420, next: 1700 };
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
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
      delay: (st, me, move, face) => robotDelay(st, me, move, face, config.level),
    });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const seats = session.players.map((p) => p.seat);
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
  const { miniCard, fly, live, fast, wait } = table;
  const faceOf = (slot) => cardFace(count, match?.face(slot) ?? null);

  // "setup" is for this view (only from the room's creator); the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  bar.update({ badges: seats.map(() => el("span", { class: "dot", "aria-hidden": "true" })) });
  const status = el("p", { class: table.cls("status"), id: "hr-status", role: "status", "aria-live": "polite", tabindex: "-1" });

  // The table's pieces and motion (art.js).
  const parts = heartsTable(table, { me, names: session.players.map((p) => p.name), myName, onPass: () => passNow() });
  const { around, opps, seatOf, trick, deckBox, tally, timer, timerFill, timerText, actionBar, meArea, myWon, myPill, tableBox, tableWrap } = parts;
  const { drawHand, drawSeats, drawCentre, drawActions, seatRect, wonRect, say, heartsBreak, cardToTrick, takeTrick, passCards, tallyUp } = parts;

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
  const viewFromState = () => tableView(match.state, me, faceOf);
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
  const sortKey = (slot) => handOrder(slot, known(slot));

  function renderHand() {
    const slots = view.hands[me].slice().sort((a, b) => sortKey(a) - sortKey(b));
    const choice = myChoice();
    const legal = new Set(choice === "play" ? legalPlays(match.state, me, faceOf) : []);
    const sent = new Set(match?.state?.picks?.[me] ?? []);
    picked = picked.filter((s) => slots.includes(s));
    drawHand(slots, { face: known, arriving: view.arriving, choice, legal, pass: canPick(), sent, picked, received: new Set(view.received) });
  }

  function renderCentre() {
    const st = match?.state;
    const passing = st && st.phase === "pass" && view.dir !== "none" && match.phase === "playing";
    drawCentre(view, { face: known, nameOf, to: passing ? passTo(st, me) : null });
    const dealing = view.stock > 0 || match?.busy === "shuffling";
    deckBox.classList.toggle("away", !dealing);
    if (dealing) table.renderStock(view.stock || count * handSize(count));
    const busy = match?.busy && match.phase !== "over" ? match.busy : null;
    table.renderBusy(busy, { starting: match?.phase === "starting", redraw: () => !destroyed && renderCentre() });
  }

  // ---------- motion ----------
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
      picked = [];
      await passCards(view, ev, { to, from, face: faceOf, g, k, render });
      if (!live(g)) return;
      addLog({ player: me, faces: ev.picks[me].map(faceOf), text: `You passed ${ev.picks[me].map((s) => cardName(faceOf(s))).join(" ")} to ${nameOf(to(me))}` });
      // Named once their envelopes are open (see renderLog).
      addLog({ player: from, slots: ev.picks[from], faces: ev.picks[from].map(faceOf), text: `${nameOf(from)} passed you three cards`, named: (fs) => `${nameOf(from)} passed you ${fs.map(cardName).join(" ")}` });
    } else if (ev.type === "none") {
      say(ev.p, "No 2♣", g);
      await wait(PACE.bubble * 0.35 * k, g);
    } else if (ev.type === "play") {
      await cardToTrick(view, ev, { g, k, render });
      if (!live(g)) return;
      addLog({ player: ev.p, face: ev.face, kind: ev.face === QUEEN_SPADES ? "queen" : "", text: `${nameOf(ev.p)} ${ev.lead ? verb(ev.p, "leads") : verb(ev.p, "plays")} ${cardWords(ev.face)}` });
      if (ev.face === QUEEN_SPADES) await wait(PACE.look * k, g);
    } else if (ev.type === "broken") {
      view.broken = true;
      render();
      heartsBreak(g);
      addLog({ player: ev.p, kind: "broken", text: "Hearts are broken" });
    } else if (ev.type === "trick") {
      const raw = await takeTrick(view, ev, { face: faceOf, g, k, render });
      if (!live(g)) return;
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

  // The hand's points tally up: each seat's hearts and queen, the moon, then the totals.
  async function showTally(ev, g, k) {
    await tallyUp(view, ev, { nameOf, scoreOf, seats, g, k, render });
    if (!live(g)) return;
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
      return toast(whyNot(match.state, me, slot, faceOf));
    }
    match.play({ play: slot });
  });

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
      drawSeats(view, match?.state?.phase === "pass");
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
    const note = !pass ? "" : wantPass ? "when it's your turn" : picked.length === PASS_COUNT ? `to ${nameOf(passTo(st, me))}` : `${picked.length} of 3 picked`;
    drawActions({ dir: pass ? st.dir : null, note, ready: picked.length === PASS_COUNT && !wantPass, choice: myChoice(), wantPass, received: view?.received.length });
    if (hadFocus?.hidden || hadFocus?.disabled) status.focus({ preventScroll: true });
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
