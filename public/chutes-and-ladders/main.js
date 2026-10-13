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
import { makeRules, normalizeConfig, LAST, SPINNER, MAX_PLAYERS } from "./rules.js";
import { chooseMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { s, r1, U, FOOT, PAWN_SCALE, WEDGE, center, spot, chuteCurve, bezier, buildBoard, spinnerArt } from "./art.js";
import { howToPlay } from "./how-to-play.js";

const ROBOT_DELAY = 700;
const AUTO_SPIN_DELAY = 700; // "Spins by itself": a beat after the board settles
const SPIN_SPEED = 1100; // degrees per second at full spin
const PACE = { hop: 230, rung: 120, between: 380 };
const FINISH_TEXT = { exact: "exact spin to finish", bounce: "bounce back off 100", any: "any spin past 100 wins" };

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const still = () => reduced.matches;

startGameShell({
  slug: "chutes-and-ladders",
  title: "Chutes and Ladders",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "wide",
  settings,
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,
  robots: () => settings.get().robots,
  createRobot: (session) => startTurnRobot(session, { rules: makeRules(settings.get()), choose: chooseMove, delay: ROBOT_DELAY }),
  // A ladder usually gains you 10 squares or more; a spin alone at most 6.
  banter: { score: (st, p) => st.pos[p], strong: 10, lines: { strongMove: ["What a ladder!"], lead: ["Up I go!"] } },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

// Samples a curve evenly by length, so a pawn slides at a steady pace.
function sampleCurve(curve, n = 120) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(bezier(curve, i / n));
  const lens = [0];
  for (let i = 1; i <= n; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[n];
  return {
    total,
    at(f) {
      const target = f * total;
      let i = 1;
      while (i < n && lens[i] < target) i++;
      const k = (target - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      const p = pts[i - 1];
      const q = pts[i];
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, angle: q.angle };
    },
  };
}

// Spins the arrow. start() flicks it into a free spin while the result is
// drawn; land(v) eases it to rest on v from whatever speed it has.
function makeSpinner(arrow, isLive) {
  let angle = 0;
  let speed = 0;
  let raf = 0;
  let free = false;
  const set = (a) => {
    const crossed = Math.floor((a + WEDGE / 2) / WEDGE) - Math.floor((angle + WEDGE / 2) / WEDGE);
    angle = a;
    arrow.setAttribute("transform", `rotate(${r1(angle % 360)})`);
    if (crossed > 0) play("tick", { pitch: 0.9 + Math.random() * 0.2 });
  };
  const valueAt = (a) => (Math.floor((((a % 360) + 360 + WEDGE / 2) % 360) / WEDGE) % SPINNER) + 1;
  function start() {
    if (free) return;
    free = true;
    speed = SPIN_SPEED;
    play("flick");
    if (still()) return;
    let last = performance.now();
    cancelAnimationFrame(raf);
    const step = (now) => {
      if (!free || !isLive()) return;
      set(angle + (speed * Math.max(0, now - last)) / 1000);
      last = Math.max(last, now);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    free = false;
    cancelAnimationFrame(raf);
  }
  function land(v) {
    if (!free) start();
    free = false;
    cancelAnimationFrame(raf);
    const jitter = (Math.random() - 0.5) * WEDGE * 0.6;
    const base = (v - 1) * WEDGE + jitter;
    let target = angle - (angle % 360) + base;
    while (target < angle + 300) target += 360;
    if (still() || document.hidden) {
      set(target);
      return Promise.resolve(valueAt(target));
    }
    // Cubic ease-out: starting speed 3·dist/duration matches the free spin.
    const from = angle;
    const dist = target - from;
    const ms = Math.min(2600, Math.max(900, (3 * dist * 1000) / speed));
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        if (!isLive()) return resolve(v);
        const t = Math.min(1, Math.max(0, (now - t0) / ms));
        set(from + dist * (1 - (1 - t) ** 3));
        if (t < 1) raf = requestAnimationFrame(step);
        else {
          play("settle");
          resolve(valueAt(target));
        }
      };
      raf = requestAnimationFrame(step);
    });
  }
  return { start, stop, land, get spinning() { return free; } };
}

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
  const spinner = makeSpinner(spinnerParts.arrow, () => !destroyed);
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
  // The seats whose pawns stand on square n once `player` is there too.
  const crowd = (n, player) => seats.filter((p) => p === player || shown[p] === n);

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
  const fast = () => still() || document.hidden;
  const wait = (ms, g) => new Promise((r) => (fast() || !live(g) ? r() : setTimeout(r, ms)));

  function tween(ms, step, g) {
    return new Promise((resolve) => {
      if (fast() || !live(g)) {
        step(1);
        return resolve();
      }
      const t0 = performance.now();
      const frame = (now) => {
        if (!live(g)) return resolve();
        // A frame's timestamp can be a little before t0.
        const t = Math.min(1, Math.max(0, (now - t0) / ms));
        step(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // Draws a pawn at (x, y), lifted `lift` units, squashed and tilted.
  function setPawn(player, { x, y, lift = 0, sx = 1, sy = 1, rot = 0 }) {
    const { g, fig } = pawnOf(player);
    g.setAttribute("transform", `translate(${r1(x)} ${r1(y)})`);
    fig.setAttribute("transform", `translate(0 ${r1(-lift)}) rotate(${r1(rot)}) scale(${(sx * PAWN_SCALE).toFixed(3)} ${(sy * PAWN_SCALE).toFixed(3)})`);
    g.dataset.x = x;
    g.dataset.y = y;
  }
  const pawnAt = (player) => ({ x: Number(pawnOf(player).g.dataset.x), y: Number(pawnOf(player).g.dataset.y) });

  // Puts every pawn where `shown` says; the one that moves last is drawn on top.
  function placePawns() {
    for (const p of seats) setPawn(p, spot(shown[p], p, crowd(shown[p], p)));
  }

  function raise(player) {
    board.layer.append(pawnOf(player).g);
  }

  // Slides the pawns into their spots when a square becomes shared, or stops being.
  function settle(g) {
    const moves = seats.map((p) => ({ p, from: pawnAt(p), to: spot(shown[p], p, crowd(shown[p], p)) }));
    return tween(170, (t) => {
      const k = t * (2 - t);
      for (const { p, from, to } of moves) setPawn(p, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
    }, g);
  }

  // One hop to square n: an arc, a squash on landing and a note.
  async function hop(player, n, k, g, pace) {
    const from = pawnAt(player);
    const to = spot(n, player, crowd(n, player));
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const height = 22 + Math.min(18, dist * 0.08);
    await tween(PACE.hop * pace, (t) => {
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const lift = 4 * height * t * (1 - t);
      const stretch = 1 + 0.12 * Math.sin(Math.PI * t);
      setPawn(player, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, lift, sx: 1 / Math.sqrt(stretch), sy: stretch });
    }, g);
    shown[player] = n;
    play("hop", { k, mine: player === me });
    if (n === LAST) play("boing");
    await tween(110 * pace, (t) => {
      const squash = 1 - 0.18 * Math.sin(Math.PI * t);
      setPawn(player, { ...to, sx: 1 / squash, sy: squash });
    }, g);
  }

  // Up a ladder rung by rung, a note per rung, and a sparkle at the top.
  async function climb(player, from, to, g, pace) {
    const a = center(from);
    const b = center(to);
    const rungs = Math.max(3, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 36));
    const start = pawnAt(player);
    const end = spot(to, player, crowd(to, player));
    // Long ladders climb faster, so no climb takes much over a second and a half.
    const rungMs = Math.max(70, Math.min(PACE.rung, 1500 / rungs)) * pace;
    for (let k = 1; k <= rungs; k++) {
      const p0 = { x: start.x + (end.x - start.x) * ((k - 1) / rungs), y: start.y + (end.y - start.y) * ((k - 1) / rungs) };
      const p1 = { x: start.x + (end.x - start.x) * (k / rungs), y: start.y + (end.y - start.y) * (k / rungs) };
      await tween(rungMs, (t) => {
        const e = t * (2 - t);
        setPawn(player, { x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e, lift: 7 * Math.sin(Math.PI * t), rot: (k % 2 ? 6 : -6) * Math.sin(Math.PI * t) });
      }, g);
      play("rung", { k: k - 1, n: rungs });
    }
    shown[player] = to;
    play("sparkle");
    burst(end, "stars", g);
    await tween(260 * pace, (t) => setPawn(player, { ...end, lift: 16 * Math.sin(Math.PI * t), sy: 1 + 0.1 * Math.sin(Math.PI * t) }), g);
  }

  // Down a chute: speeding up along the curve, tilting with it, then a bump.
  async function slide(player, from, to, g, pace) {
    const curve = sampleCurve(chuteCurve(from, to));
    const end = spot(to, player, crowd(to, player));
    const ms = Math.min(2000, 700 + curve.total * 0.85) * pace;
    play("slide", { dur: ms / 1000 });
    await tween(ms, (t) => {
      const e = t < 0.8 ? (t / 0.8) ** 1.7 * 0.86 : 0.86 + 0.14 * (1 - (1 - (t - 0.8) / 0.2) ** 2);
      const p = curve.at(e);
      const tilt = Math.max(-35, Math.min(35, ((p.angle * 180) / Math.PI - 90) * -0.35));
      const blend = Math.max(0, (t - 0.85) / 0.15);
      setPawn(player, {
        x: p.x + (end.x - curve.at(1).x) * blend,
        y: p.y + FOOT * 0.6 + (end.y - curve.at(1).y - FOOT * 0.6) * blend,
        rot: tilt * (1 - blend),
      });
    }, g);
    shown[player] = to;
    play("bump");
    burst(end, "dust", g);
    await tween(240 * pace, (t) => {
      const squash = 1 - 0.25 * Math.sin(Math.PI * t);
      setPawn(player, { ...end, sx: 1 / squash, sy: squash, rot: 8 * Math.sin(Math.PI * t * 2) * (1 - t) });
    }, g);
  }

  // Overshooting with the exact-spin rule: a shake on the spot.
  async function refuse(player, g, pace) {
    const at = pawnAt(player);
    play("stay");
    await tween(420 * pace, (t) => setPawn(player, { ...at, rot: 12 * Math.sin(t * Math.PI * 4) * (1 - t) }), g);
  }

  // Little particles: stars at a ladder's top, dust at a chute's foot, confetti at 100.
  function burst(at, kind, g) {
    if (fast() || !live(g)) return;
    const count = kind === "confetti" ? 28 : kind === "stars" ? 9 : 8;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const angle = kind === "dust" ? Math.PI + (i / (count - 1)) * Math.PI : (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = kind === "confetti" ? 70 + Math.random() * 90 : kind === "stars" ? 40 + Math.random() * 25 : 26 + Math.random() * 18;
      const node =
        kind === "stars"
          ? s("path", { class: `fx-star s${i % 3}`, d: "M0 -7 l2 5 5 .5 -4 3.5 1.2 5 -4.2 -2.6 -4.2 2.6 1.2 -5 -4 -3.5 5 -.5 Z" })
          : kind === "dust"
            ? s("circle", { class: "fx-dust", r: 5 + Math.random() * 4 })
            : s("rect", { class: `fx-confetti c${i % 5}`, x: -4, y: -7, width: 8, height: 14, rx: 2 });
      board.fx.append(node);
      parts.push({ node, angle, dist, spin: (Math.random() - 0.5) * 720 });
    }
    const y0 = kind === "dust" ? at.y - 4 : at.y - 30;
    const ms = kind === "confetti" ? 1400 : 650;
    tween(ms, (t) => {
      const e = 1 - (1 - t) ** 2;
      for (const p of parts) {
        const fall = kind === "confetti" ? 160 * t * t : kind === "dust" ? -10 * t : 0;
        const x = at.x + Math.cos(p.angle) * p.dist * e;
        const y = y0 + Math.sin(p.angle) * p.dist * e * (kind === "dust" ? 0.4 : 1) + fall;
        p.node.setAttribute("transform", `translate(${r1(x)} ${r1(y)}) rotate(${r1(p.spin * t)}) scale(${(kind === "stars" ? 1.4 - t : 1).toFixed(2)})`);
        p.node.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      }
    }, g).then(() => parts.forEach((p) => p.node.remove()));
  }

  // A soft glow on a square: where a pawn landed, or a ladder or chute it took.
  function mark(n, cls) {
    for (const old of board.marks.querySelectorAll(`.${cls}`)) old.remove();
    if (!n) return;
    const c = center(n);
    board.marks.append(s("rect", { class: `mark ${cls}`, x: c.x - U / 2 + 4, y: c.y - U / 2 + 4, width: U - 8, height: U - 8, rx: 12 }));
  }

  // Plays one spin out on screen.
  async function animate(ev, g) {
    const p = ev.player;
    const pace = pending > 2 ? 0.55 : 1; // catching up after a hidden tab or a burst of spins
    current = { player: p, phase: "spin" };
    render();
    await spinner.land(ev.spin);
    if (!live(g)) return;
    current.phase = "move";
    spinValue.textContent = String(ev.spin);
    spinValue.dataset.who = `p${colorOf(p)}`;
    spinValue.classList.remove("pop");
    void spinValue.offsetWidth;
    spinValue.classList.add("pop");
    render();
    await wait(260 * pace, g);
    raise(p);
    if (ev.stay) await refuse(p, g, pace);
    else {
      // Notes climb with each hop, and walk back down after bouncing off 100.
      const top = ev.path.indexOf(LAST);
      for (const [i, n] of ev.path.entries()) await hop(p, n, ev.bounce && i > top ? 2 * top - i : i, g, pace);
    }
    if (ev.jump && live(g)) {
      current.phase = ev.jump.kind;
      render();
      await wait(160 * pace, g);
      if (ev.jump.kind === "ladder") await climb(p, ev.jump.from, ev.jump.to, g, pace);
      else await slide(p, ev.jump.from, ev.jump.to, g, pace);
    }
    if (!live(g)) return;
    shown[p] = ev.to;
    await settle(g);
    mark(ev.to, `last-p${colorOf(p)}`);
    addLog(ev);
    if (ev.win) burst({ ...center(LAST), y: center(LAST).y + FOOT }, "confetti", g);
    else if (ev.again) toast(p === me ? "A 6! Spin again." : `${nameOf(p)} spun a 6 and goes again`);
    current = null;
    await wait(PACE.between * pace, g);
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
          placePawns();
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
    for (const k of order.keys()) mark(0, `last-p${k}`);
    placePawns();
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
  placePawns();
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
