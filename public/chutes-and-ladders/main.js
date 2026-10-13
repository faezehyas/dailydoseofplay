// Chutes and Ladders page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is the board, the spinner, the
// motion and the sounds. The match state never waits for the screen: every
// spin is queued and played out in order (spinner, hops, ladder or chute).
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { makeRules, normalizeConfig, LAST, MAX_PLAYERS } from "./rules.js";
import { chooseMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { PACE, buildBoard, spinnerArt, makeSpinner, pawnMotion } from "./art.js";
import { howToPlay } from "./how-to-play.js";

const ROBOT_DELAY = 700;
const AUTO_SPIN_DELAY = 700; // "Spins by itself": a beat after the board settles
const FINISH_TEXT = { exact: "exact spin to finish", bounce: "bounce back off 100", any: "any spin past 100 wins" };

startGameShell({
  slug: "chutes-and-ladders",
  title: "Chutes and Ladders",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "wide",
  settings,
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,
  createRobot: (session) => startTurnRobot(session, { rules: makeRules(settings.get()), choose: chooseMove, delay: ROBOT_DELAY }),
  // A ladder usually gains you 10 squares or more; a spin alone at most 6.
  banter: { score: (st, p) => st.pos[p], strong: 10, lines: { strongMove: ["What a ladder!"], lead: ["Up I go!"] } },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

// ---------- the game ----------
function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const duel = count === 2;
  const seats = session.players.map((p) => p.seat);
  // You come first in the player list, the others in seat order.
  const order = [me, ...session.others.map((p) => p.seat)];
  // Colours go by seat, so a player has the same colour on every screen: p0 coral, p1 teal, p2 violet, p3 amber.
  const colorOf = (p) => p;
  const oppName = session.opponent.name;
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  const score = { wins: Array(count).fill(0) };
  const spinMode = () => settings.get().spin; // each player's own choice, which can change mid-game
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let gen = 0; // bumps on every new match, so old animations stop
  let destroyed = false;
  let shown = Array(count).fill(0); // where each pawn is drawn, by seat
  let queue = Promise.resolve();
  let pending = 0;
  let current = null; // the spin being animated: { player, phase }
  let log = [];
  let cuedPly = -1;
  let autoTimer = null;

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p${colorOf(p)}` });
  bar.update({ badges: seats.map(() => el("span", { class: "swatch", "aria-hidden": "true" })) });
  const status = el("p", { class: "cl-status", id: "cl-status", role: "status", "aria-live": "polite", dataset: { who: `p${colorOf(me)}` } });
  const board = buildBoard(count);
  const spinnerParts = spinnerArt();
  const spinner = makeSpinner(spinnerParts.arrow, () => !destroyed, play);
  const spinValue = el("div", { class: "cl-spin-value", id: "cl-spin-value", "aria-live": "polite" });
  const dial = el("div", { class: "cl-dial", id: "cl-dial", onclick: () => spinNow() }, spinnerParts.svg, spinValue);
  const spinBtn = el("button", { class: "btn primary big cl-spin-btn", type: "button", id: "cl-spin", onclick: () => spinNow() }, "Spin");
  const logList = el("ol", { class: "cl-log", id: "cl-log", "aria-label": "Recent spins" });
  const configLine = el("p", { class: "cl-config", id: "cl-config" });
  const note = el("p", { class: "cl-note", id: "cl-note" });
  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    onShow: ({ winner, outcome }) => outcome && celebrate({ outcome, flavour: "bell", highlight: [pawnOf(winner).fig], board: board.svg }),
  });

  root.append(
    el(
      "div",
      { class: "chutes-ladders" },
      bar.node,
      status,
      el(
        "div",
        { class: "cl-main" },
        el("div", { class: "cl-board-wrap" }, board.svg),
        el("div", { class: "cl-side" }, el("div", { class: "cl-spin-panel" }, dial, spinBtn), logList),
      ),
      configLine,
      note,
      result.node,
    ),
  );
  // Pawns are coloured by seat: p0 coral, p1 teal, p2 violet, p3 amber.
  const pawnOf = (player) => board.pawns[colorOf(player)];

  // ---------- input ----------
  function spinNow() {
    if (!match || match.phase !== "playing") return;
    if (match.state.turn !== me) return toast(`Wait for ${nameOf(match.state.turn)}`);
    if (pending || spinner.spinning || !match.canMove()) return;
    clearTimeout(autoTimer);
    spinner.start();
    match.play({ type: "spin" });
    render();
  }

  // ---------- motion ----------
  const live = (g) => g === gen && !destroyed;
  const motion = pawnMotion(board, { seats, shown: () => shown, me, live, play, spinner, value: spinValue });

  // Plays one spin out on screen.
  async function animate(ev, g) {
    const p = ev.player;
    const pace = pending > 2 ? 0.55 : 1; // catching up after a hidden tab or a burst of spins
    current = { player: p, phase: "spin" };
    render();
    const landed = await motion.spin(ev, g, pace, (phase) => {
      current.phase = phase;
      render();
    });
    if (!landed) return;
    addLog(ev);
    if (ev.again) toast(p === me ? "A 6! Spin again." : `${nameOf(p)} spun a 6 and goes again`);
    current = null;
    await motion.wait(PACE.between * pace, g);
  }

  function enqueue(ev) {
    const g = gen;
    pending++;
    queue = queue
      .then(() => (live(g) ? animate(ev, g) : null))
      .catch((err) => console.error(err))
      .finally(() => {
        if (!live(g)) return; // a rematch started: its own queue and count took over
        pending--;
        if (!pending) {
          current = null;
          shown = match.state.pos.slice();
          motion.place();
        }
        render();
      });
  }

  // ---------- log ----------
  function describe(ev) {
    const who = nameOf(ev.player);
    let text = `${who} spun ${ev.spin}`;
    if (ev.stay) return `${text} and stays on ${ev.from}: ${LAST - ev.from} to go exactly`;
    if (ev.bounce) text += `, bounced off 100 to ${ev.landed}`;
    else text += ` to ${ev.landed}`;
    if (ev.jump?.kind === "ladder") text += ` and climbed to ${ev.jump.to}!`;
    else if (ev.jump?.kind === "chute") text += ` and slid down to ${ev.jump.to}`;
    if (ev.win) text += ev.jump ? " Home!" : ". Home!";
    return text;
  }

  function addLog(ev) {
    log = [{ ev, text: describe(ev) }, ...log].slice(0, 5);
    logList.replaceChildren(
      ...log.map(({ ev: e, text }, i) =>
        el("li", { class: `p${colorOf(e.player)} ${e.jump?.kind || ""} ${i ? "" : "fresh"}` }, el("span", { class: "dot", "aria-hidden": "true" }, String(e.spin)), el("span", {}, text)),
      ),
    );
  }

  // ---------- render ----------
  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who spins first…" : "Getting ready…";
      case "playing":
      case "over":
        if (current) {
          const mine = current.player === me;
          const who = nameOf(current.player);
          if (current.phase === "spin") return mine ? "Spinning…" : `${who} is spinning…`;
          if (current.phase === "ladder") return mine ? "A ladder! Up you go." : `${who} found a ladder!`;
          if (current.phase === "chute") return mine ? "Whee! Down the chute." : `${who} slides down a chute!`;
          return mine ? "Hop, hop…" : `${who} is moving…`;
        }
        if (match.phase === "over") return st.winner === me ? "You reached 100. You win!" : `${nameOf(st.winner)} reached 100 first.`;
        if (st.turn === me) return spinMode() === "auto" ? "Your turn. The spinner goes by itself…" : "Your turn. Spin!";
        return `${nameOf(st.turn)}'s turn…`;
      default:
        return "Match stopped.";
    }
  }

  function boardLabel() {
    const where = (n) => (n === 0 ? "at the start" : `on square ${n}`);
    const others = order.slice(1).map((p) => `${nameOf(p)} is ${where(shown[p])}`);
    return `Chutes and Ladders board. You are ${where(shown[me])}; ${listOf(others)}.`;
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    shell.setInProgress(phase !== "over" && phase !== "aborted");
    root.querySelector(".chutes-ladders").dataset.phase = phase;
    bar.update({
      turn: phase !== "playing" ? -1 : current ? current.player : st.turn,
      notes: shown.map((n) => (n === 0 ? "start" : `square ${n}`)),
      score,
    });
    status.textContent = statusText();
    const myTurn = phase === "playing" && st.turn === me && !pending;
    status.classList.toggle("mine", myTurn || current?.player === me);
    const canSpin = myTurn && match.canMove() && !spinner.spinning;
    spinBtn.disabled = !canSpin;
    spinBtn.textContent = spinner.spinning ? "Spinning…" : "Spin";
    spinBtn.classList.toggle("attention", canSpin);
    dial.classList.toggle("armed", canSpin);
    dial.dataset.who = current ? `p${colorOf(current.player)}` : st && phase === "playing" ? `p${colorOf(st.turn)}` : "";
    board.svg.setAttribute("aria-label", boardLabel());
    // Whoever is up next bobs on the spot until they spin.
    for (const p of seats) pawnOf(p).g.classList.toggle("waiting", phase === "playing" && !pending && st.turn === p);
    renderOver();
    setTabAlert(myTurn ? "Your turn" : null);
    if (myTurn && cuedPly !== st.ply) {
      cuedPly = st.ply;
      if (st.ply > 0 && st.last?.player !== me) play("turn");
      if (spinMode() === "auto") {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(spinNow, AUTO_SPIN_DELAY);
      }
    }
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the winning pawn finish its trip first.
    if ((phase !== "over" && phase !== "aborted") || (phase === "over" && pending)) return result.hide();
    const st = match.state;
    const winner = phase === "over" ? st.winner : -1;
    let reason;
    if (phase === "aborted") reason = match.abortReason || "The match was stopped.";
    else {
      const w = winner;
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      reason = `${nameOf(w)} reached 100 in ${plural(st.spins[w], "spin")}, with ${plural(st.climbs[w], "ladder")} and ${plural(st.slides[w], "chute")} on the way.`;
      const rest = seats.filter((p) => p !== w);
      if (duel) reason += ` ${nameOf(rest[0])} ${rest[0] === me ? "were" : "was"} on square ${st.pos[rest[0]] || "0"}.`;
      else reason += ` Behind: ${listOf(rest.map((p) => `${p === me ? "you" : nameOf(p)} on square ${st.pos[p] || "0"}`))}.`;
    }
    result.show({ winner, stopped: phase === "aborted", reason });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    gen += 1;
    clearTimeout(autoTimer);
    spinner.stop();
    shown = Array(count).fill(0);
    pending = 0;
    queue = Promise.resolve();
    current = null;
    log = [];
    cuedPly = -1;
    logList.replaceChildren();
    spinValue.textContent = "";
    board.fx.replaceChildren();
    for (const k of order.keys()) motion.mark(0, `last-p${k}`);
    motion.place();
    const rivals = duel ? oppName : listOf(order.slice(1).map(nameOf));
    note.textContent = m === 1 ? `Playing against ${rivals}. Good luck!` : `Rematch #${m - 1}. Back to the start.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => {
      spinner.stop();
      toast(reason);
    });
    match.on("start", () => {
      const first = match.state.first;
      const who = first === me ? "you spin first" : `${nameOf(first)} spins first`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.first === "random" ? `Coin toss (drawn by ${duel ? "both" : "all"} browsers): ${who}.` : `Room setting: ${who}.`);
      toast(first === me ? "You spin first" : `${nameOf(first)} spins first`);
    });
    match.on("events", ({ events }) => {
      for (const ev of events) if (ev.type === "spin") enqueue(ev);
    });
    match.on("over", ({ winner }) => score.wins[winner]++);
    router.start(match);
    render();
  }

  // The room's settings come from whoever created it (the robot uses ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = `${FINISH_TEXT[config.finish]} · ${config.sixAgain ? "a 6 spins again" : "one spin a turn"}`;
    newMatch();
  }
  function onSetup(msg) {
    if (me !== 0) begin(msg.config);
  }

  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const offs = [
    offMsg,
    session.on("rematch-start", () => config && newMatch()),
  ];
  motion.place();
  if (session.mode === "robot") begin(settings.get());
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      gen++;
      clearTimeout(autoTimer);
      spinner.stop();
      setTabAlert(null);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
    },
  };
}
