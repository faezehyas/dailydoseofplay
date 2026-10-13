// Ludo's board in motion, shared by the game (main.js) and the tutorial:
// where tokens stand, how they hop, fly home and land, with their sounds,
// the die's tumble, and the marks and tap targets for a choice of move.
// Motion runs in generations: live(g) says an animation of generation g may
// go on, fast() that motion is skipped (it then lands at once).
import { COLORS, YARD, HOME, LAST_LOOP, TOKENS } from "./rules.js";
import { s, r1, U, spotOf, markPath, starPath, dieFace } from "./art.js";
import { play } from "./sounds.js";

export const PACE = { hop: 185, land: 90, between: 320, roll: 560, pass: 950 };
const PAWN = 1; // a token's size on a square of its own
const FOOT = 0.3 * U; // a token stands this far below its square's centre
const OFFSETS = {
  2: [[-0.22, 0.02], [0.22, -0.02]],
  3: [[-0.24, 0.1], [0.24, 0.1], [0, -0.16]],
  4: [[-0.22, -0.14], [0.22, -0.14], [-0.22, 0.16], [0.22, 0.16]],
};

const delay = (ms, skip) => new Promise((r) => (skip ? r() : setTimeout(r, ms)));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// pawns[p][t] is pawnArt's token t of seat p; tokens() where they stand as
// drawn, by seat. With blocks() on, a pair of one colour gets a plate in blockLayer.
export function boardMotion({ pawns, pawnLayer, fx, blockLayer, blocks = () => false, rot, colorOf, tokens, live, fast }) {
  const cname = (p) => COLORS[colorOf(p)];
  const wait = (ms, g) => delay(ms, fast() || !live(g));

  // ---------- where tokens stand ----------
  // Square key for crowding: tokens sharing a square stand side by side.
  const keyOf = (p, r) => (r === YARD || r === HOME ? null : r > LAST_LOOP ? `h${colorOf(p)}-${r}` : `l${spotOf(colorOf(p), r, 0).x},${spotOf(colorOf(p), r, 0).y}`);
  function spot(p, t, view = tokens()) {
    const r = view[p][t];
    const base = rot(spotOf(colorOf(p), r, t));
    if (r === HOME) return { x: base.x, y: base.y + FOOT * 0.45, scale: 0.5 };
    if (r === YARD) return { x: base.x, y: base.y + FOOT * 0.8, scale: 1.08 };
    const key = keyOf(p, r);
    const crowd = [];
    view.forEach((side, q) => side.forEach((r2, t2) => keyOf(q, r2) === key && crowd.push(`${q}-${t2}`)));
    const n = Math.min(4, crowd.length);
    if (n < 2) return { x: base.x, y: base.y + FOOT, scale: PAWN };
    const [dx, dy] = OFFSETS[n][Math.min(n - 1, crowd.indexOf(`${p}-${t}`))];
    return { x: base.x + dx * U, y: base.y + FOOT + dy * U, scale: n === 2 ? 0.8 : 0.68 };
  }

  function setPawn(p, t, { x, y, scale = PAWN, lift = 0, sx = 1, sy = 1, rot: deg = 0 }) {
    const pw = pawns[p][t];
    pw.g.setAttribute("transform", `translate(${r1(x)} ${r1(y)}) scale(${scale.toFixed(3)})`);
    pw.lift.setAttribute("transform", lift || deg || sx !== 1 || sy !== 1 ? `translate(0 ${r1(-lift)}) rotate(${r1(deg)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})` : "");
    pw.at = { x, y, scale };
  }

  // With the block rule, a pair of one colour on a loop square gets a plate under it.
  function drawBlocks() {
    if (!blockLayer) return;
    blockLayer.replaceChildren();
    if (!blocks()) return;
    tokens().forEach((side, p) => {
      const seen = new Map();
      side.forEach((r, t) => r >= 0 && r <= LAST_LOOP && seen.set(r, [...(seen.get(r) || []), t]));
      for (const [r, list] of seen) {
        if (list.length < 2) continue;
        const c = rot(spotOf(colorOf(p), r, 0));
        blockLayer.append(s("rect", { class: `block c-${cname(p)}`, x: c.x - U * 0.46, y: c.y - U * 0.46, width: U * 0.92, height: U * 0.92, rx: 8 }));
      }
    });
  }

  // Draws every token where tokens() says, lower ones in front.
  function placePawns() {
    drawBlocks();
    const all = [];
    tokens().forEach((side, p) => {
      for (let t = 0; t < TOKENS; t++) all.push({ p, t, at: spot(p, t) });
    });
    all.sort((a, b) => a.at.y - b.at.y);
    for (const { p, t, at } of all) {
      setPawn(p, t, at);
      pawnLayer.append(pawns[p][t].g);
    }
  }

  const raise = (p, t) => pawnLayer.append(pawns[p][t].g);

  // ---------- motion ----------
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

  // One hop: an arc to the next square and a squash on landing.
  async function hop(p, t, to, g, pace, height = 20) {
    const from = pawns[p][t].at;
    await tween(PACE.hop * pace, (u) => {
      const e = ease(u);
      const stretch = 1 + 0.1 * Math.sin(Math.PI * u);
      setPawn(p, t, {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        scale: from.scale + (to.scale - from.scale) * e,
        lift: 4 * height * u * (1 - u),
        sx: 1 / Math.sqrt(stretch),
        sy: stretch,
      });
    }, g);
  }

  async function squash(p, t, g, pace, depth = 0.16) {
    const at = pawns[p][t].at;
    await tween(PACE.land * pace, (u) => {
      const k2 = 1 - depth * Math.sin(Math.PI * u);
      setPawn(p, t, { ...at, sx: 1 / k2, sy: k2 });
    }, g);
  }

  // Slides tokens into their spots when a square becomes shared, or stops being.
  function settle(g) {
    const moves = [];
    tokens().forEach((side, p) => {
      for (let t = 0; t < TOKENS; t++) moves.push({ p, t, from: pawns[p][t].at, to: spot(p, t) });
    });
    return tween(160, (u) => {
      const e = u * (2 - u);
      for (const { p, t, from, to } of moves) setPawn(p, t, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, scale: from.scale + (to.scale - from.scale) * e });
    }, g).then(() => live(g) && placePawns());
  }

  // A captured token flies back to its yard: up, tumbling, and down on its socket.
  async function flyHome(p, t, g, pace) {
    const from = pawns[p][t].at;
    raise(p, t);
    const to = spot(p, t);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const spin = (to.x > from.x ? 1 : -1) * 540;
    await tween(Math.min(900, 380 + dist * 0.9) * pace, (u) => {
      const e = ease(u);
      setPawn(p, t, {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        scale: from.scale + (to.scale - from.scale) * e,
        lift: (60 + dist * 0.25) * Math.sin(Math.PI * u),
        rot: spin * u,
      });
    }, g);
    await squash(p, t, g, pace, 0.22);
  }

  // Particles: sparkles on a safe square, a puff on a capture, confetti home.
  function burst(at, kind, colorName, g) {
    if (fast() || !live(g)) return;
    const n = kind === "confetti" ? 26 : kind === "big" ? 44 : kind === "puff" ? 9 : 8;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const dist = kind === "big" ? 90 + Math.random() * 160 : kind === "confetti" ? 50 + Math.random() * 70 : kind === "puff" ? 22 + Math.random() * 14 : 26 + Math.random() * 12;
      const node =
        kind === "sparkle"
          ? s("path", { class: "fx-star", d: starPath(6, 2.6) })
          : kind === "puff"
            ? s("circle", { class: "fx-puff", r: 4 + Math.random() * 4 })
            : s("rect", { class: `fx-confetti ${i % 3 ? `c-${colorName}` : `c-${COLORS[i % 4]}`}`, x: -3, y: -6, width: 6, height: 12, rx: 2 });
      fx.append(node);
      parts.push({ node, angle, dist, spin: (Math.random() - 0.5) * 720 });
    }
    const ms = kind === "big" ? 1700 : kind === "confetti" ? 1200 : 600;
    tween(ms, (u) => {
      const e = 1 - (1 - u) ** 2;
      for (const p of parts) {
        const fall = kind === "big" || kind === "confetti" ? 140 * u * u : 0;
        const x = at.x + Math.cos(p.angle) * p.dist * e;
        const y = at.y - 18 + Math.sin(p.angle) * p.dist * e * (kind === "puff" ? 0.45 : 1) + fall;
        p.node.setAttribute("transform", `translate(${r1(x)} ${r1(y)}) rotate(${r1(p.spin * u)}) scale(${(kind === "sparkle" ? 1.3 - u : 1).toFixed(2)})`);
        p.node.style.opacity = String(u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
      }
    }, g).then(() => parts.forEach((p) => p.node.remove()));
  }

  // A ring that spreads from a square, in a colour.
  function ripple(at, colorName, g) {
    if (fast() || !live(g)) return;
    const node = s("circle", { class: `fx-ripple c-${colorName}`, cx: r1(at.x), cy: r1(at.y - FOOT * 0.6), r: 10 });
    fx.append(node);
    tween(520, (u) => {
      node.setAttribute("r", String(r1(10 + 26 * u)));
      node.style.opacity = String(1 - u);
    }, g).then(() => node.remove());
  }

  // Plays a move event out on the tokens as drawn: the hops and their sounds,
  // then the capture, home or safe square. me is the seat whose moves are
  // "mine"; phase(name) hears when a capture or a token home starts. False
  // if generation g stopped it on the way.
  async function move(ev, g, pace, me, phase = () => {}) {
    const p = ev.player;
    const t = ev.token;
    const shown = tokens();
    raise(p, t);
    const colorName = cname(p);
    if (ev.enter) {
      shown[p][t] = 0;
      play("out");
      await hop(p, t, spot(p, t), g, pace * 1.6, 46);
      await squash(p, t, g, pace, 0.24);
      ripple(spot(p, t), colorName, g);
    } else {
      for (const [i, r] of ev.path.entries()) {
        if (!live(g)) return false;
        shown[p][t] = r;
        if (r === LAST_LOOP + 1) play("stretch");
        await hop(p, t, spot(p, t), g, pace, r === HOME ? 30 : 18);
        // Applied at once (reduced motion, hidden tab): one tap for the landing, not a burst.
        if (!fast() || i === ev.path.length - 1) play("hop", { k: i, mine: p === me });
        if (i === ev.path.length - 1) await squash(p, t, g, pace);
      }
    }
    if (!live(g)) return false;
    const at = spot(p, t);
    if (ev.captures.length) {
      phase("capture");
      const victims = ev.captures.map((c) => c.player);
      play(victims.includes(me) ? "captured" : "capture");
      burst(at, "puff", colorName, g);
      await Promise.all(
        ev.captures.map((c) => {
          shown[c.player][c.token] = YARD;
          return flyHome(c.player, c.token, g, pace);
        }),
      );
    } else if (ev.home) {
      phase("home");
      play("home");
      burst(rot({ x: 7.5 * U, y: 7.5 * U }), ev.done ? "big" : "confetti", colorName, g);
    } else if (ev.safe && !ev.enter) {
      play("safe");
      burst(at, "sparkle", colorName, g);
    }
    return true;
  }

  return { spot, placePawns, raise, wait, settle, move };
}

// The die button: a tumble of random faces with the rattle, then the roll.
export function rollingDie({ die, face, colorOf, live, fast }) {
  const cname = (p) => COLORS[colorOf(p)];
  let tumbleTimer = null;
  let tumbleStart = 0;
  function startTumble(owner) {
    die.dataset.color = cname(owner);
    if (tumbleTimer) return;
    tumbleStart = performance.now();
    die.classList.remove("landed");
    die.classList.add("tumbling");
    play("dice");
    if (fast()) return;
    let last = 0;
    const flick = () => {
      let v = 1 + Math.floor(Math.random() * 6);
      if (v === last) v = (v % 6) + 1;
      last = v;
      dieFace(face, v);
    };
    flick();
    tumbleTimer = setInterval(flick, 75);
  }
  function stopTumble() {
    clearInterval(tumbleTimer);
    tumbleTimer = null;
    die.classList.remove("tumbling");
  }
  async function land(value, owner, g, pace) {
    startTumble(owner);
    const left = PACE.roll * pace - (performance.now() - tumbleStart);
    await delay(Math.max(0, left), fast() || !live(g));
    stopTumble();
    if (!live(g)) return;
    dieFace(face, value);
    die.dataset.color = cname(owner);
    die.classList.remove("landed");
    void die.offsetWidth;
    if (!fast()) die.classList.add("landed");
    die.classList.toggle("six", value === 6);
  }
  return { startTumble, stopTumble, land, tumbling: () => !!tumbleTimer };
}

// Markers where each move in list would land, the focused move's path
// (focus, or null), and the landing spots as tap targets; mine are the
// mover's pawns. The tokens' own targets come after (tokenTarget).
export function drawChoices({ marks, hits, mine, color, rot, list, focus }) {
  const colorName = COLORS[color];
  const seen = new Map();
  for (const mv of list) if (!seen.has(mv.from)) seen.set(mv.from, mv);
  for (const mv of seen.values()) {
    const dest = mv.home ? rot(spotOf(color, HOME, mv.token)) : rot(spotOf(color, mv.to, mv.token));
    const focused = focus && focus.from === mv.from;
    if (focused) {
      // The squares on the way.
      for (const r of mv.path.slice(0, -1)) {
        const c = rot(spotOf(color, r, 0));
        marks.append(s("circle", { class: `trail c-${colorName}`, cx: r1(c.x), cy: r1(c.y), r: 4 }));
      }
    }
    marks.append(
      s(
        "g",
        { class: `dest c-${colorName} ${mv.captures.length ? "capture" : ""} ${mv.home ? "home" : ""} ${focused ? "focus" : ""} ${focus && !focused ? "dim" : ""}`, transform: `translate(${r1(dest.x)} ${r1(dest.y)})` },
        s("circle", { class: "dest-disc", r: mv.home ? U * 0.34 : U * 0.42 }),
        mv.captures.length ? s("path", { class: "dest-x", d: "M-7 -7L7 7M7 -7L-7 7" }) : s("path", { class: "dest-mark", d: markPath(color, 9) }),
      ),
    );
    // The landing spot is a tap target too.
    hits.append(s("circle", { class: "hit-dest", "data-token": mv.token, cx: r1(dest.x), cy: r1(dest.y), r: U * 0.5 }));
  }
  for (const mv of list) {
    mine[mv.token].g.classList.add("movable");
    if (focus && mv.token === focus.token) mine[mv.token].g.classList.add("focus");
  }
}

// What a token's tap target says for a move with roll die; victims names whose tokens it captures.
export const moveLabel = (mv, die, victims) =>
  mv.enter
    ? `Token ${mv.token + 1}: bring it out of the yard`
    : `Token ${mv.token + 1}: move ${die} ${mv.home ? "home" : mv.to > LAST_LOOP ? "into the home column" : "squares"}${mv.captures.length ? `, capturing ${victims}` : ""}${mv.safe && !mv.enter ? ", to a safe square" : ""}`;

// A token's tap target, over where it stands now.
export function tokenTarget(pawn, t, label) {
  const at = pawn.at;
  return s("circle", { class: "hit-token", "data-token": t, cx: r1(at.x), cy: r1(at.y - 14 * at.scale), r: U * 0.62, tabindex: 0, role: "button", "aria-label": label });
}

// Taps and keys on the tap targets: pick(t) plays token t, show(t) shows
// where it goes (null: none) on hover or focus. Arrow keys go round the tokens.
export function wireTargets(hits, { pick, show }) {
  hits.addEventListener("click", (e) => {
    const target = e.target.closest("[data-token]");
    if (target) pick(Number(target.dataset.token));
  });
  hits.addEventListener("pointerover", (e) => {
    const target = e.target.closest("[data-token]");
    if (target) show(Number(target.dataset.token));
  });
  hits.addEventListener("pointerout", (e) => {
    if (e.relatedTarget?.closest?.("[data-token]")) return;
    if (!hits.contains(document.activeElement)) show(null);
  });
  // A press on a landing disc focuses the layer itself (it listens for focus): no token there.
  hits.addEventListener("focusin", (e) => e.target.dataset.token !== undefined && show(Number(e.target.dataset.token)));
  hits.addEventListener("keydown", (e) => {
    const target = e.target.closest("[data-token]");
    if (!target) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      return pick(Number(target.dataset.token));
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const list = [...hits.querySelectorAll(".hit-token")];
    const i = list.indexOf(target);
    list[(i + step + list.length) % list.length]?.focus();
  });
}
