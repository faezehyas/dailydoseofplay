// The seat ring and the hand-off. The ring is a small table seen from above:
// every seat round it with its stack of cards on a lane of chevrons pointing
// this age's way, the age and its six turns in the middle, and gold ties from
// you to your two neighbours. You sit at the bottom and seats run clockwise,
// so your left neighbour is on your left. The hand-off pieces (a stack, the
// slot it rests in, a slide between two places) are for the panels round your
// hand. Only public facts appear: seats, names, the age, the turn and how many
// cards every hand holds.
import { el } from "../engine/shell.js";
import { cardBack } from "./card-art.js";
import { passDir, ROUNDS } from "./rules.js";

const ROMAN = ["", "I", "II", "III"];
const RAD = Math.PI / 180;

// The felt's drawing: a viewBox W × H, the table's centre, the lane the
// stacks travel and the ellipse the seats sit on.
export const RING = { W: 800, H: 470, cx: 400, cy: 226, lane: [214, 112], seat: [340, 200], table: [278, 150] };

const mod = (a, n) => ((a % n) + n) % n;

// Each seat's angle on screen in degrees (0 = right, 90 = bottom, y down):
// you at 90, then clockwise, so seat me + 1 (your left) comes next at the left.
export function seatAngles(players, me) {
  return Array.from({ length: players }, (_, p) => 90 + (360 / players) * mod(p - me, players));
}

// The seat a hand at seat moves to when hands pass dir (1 left, -1 right).
export const passTarget = (players, seat, dir) => mod(seat + dir, players);

// A point on an ellipse round the table's centre.
export const pointAt = (deg, [rx, ry]) => [RING.cx + rx * Math.cos(deg * RAD), RING.cy + ry * Math.sin(deg * RAD)];

// The ring's words for a screen reader and its summary line.
export function ringWords({ players, me, age, round }, nameOf) {
  if (!age) return "Waiting for the first deal.";
  const dir = passDir(age);
  const to = passTarget(players, me, dir);
  const from = passTarget(players, me, -dir);
  const turn = Math.max(1, Math.min(round || 1, ROUNDS));
  return `Age ${ROMAN[age] ?? age}, turn ${turn} of ${ROUNDS}. Hands go ${dir > 0 ? "left" : "right"}: yours to ${nameOf(to)}, and you get ${nameOf(from)}'s.`;
}

// Seat marks past the four art.js draws (seats 4–6 at a bigger table): a
// triangle, a ring and a cross, so no two seats differ by colour alone.
const MORE_MARKS = ['<path d="M12 6.5l5.5 9.5h-11z"/>', '<circle cx="12" cy="12" r="4.4" fill="none" stroke-width="2.4"/>', '<path d="M10.5 6h3v4.5H18v3h-4.5V18h-3v-4.5H6v-3h4.5z"/>'];
function markOf(kit, p) {
  const node = kit.seatMark(p);
  const sign = node.querySelector?.(".sign");
  if (sign && !sign.childElementCount && MORE_MARKS[p - 4]) sign.innerHTML = MORE_MARKS[p - 4];
  return node;
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = () => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim()) || "cubic-bezier(0.22, 1, 0.36, 1)";
// Close to the theme's --ease-out, so the ring keeps time with slide().
const out = (k) => 1 - (1 - k) ** 4;

// ---------- hand-off pieces ----------

// Three fanned backs of an age with the hand's size on a badge; sized by CSS.
export function stackEl(age, count) {
  const node = el("span", { class: "sc-stack", "aria-hidden": "true" });
  setStack(node, age, count);
  return node;
}
function setStack(node, age, count) {
  const a = Math.min(3, Math.max(1, age || 1));
  if (node.dataset.age !== String(a)) {
    node.dataset.age = String(a);
    const back = cardBack(a, { size: "mini" });
    node.replaceChildren(...[0, 1, 2].map(() => el("i", { class: "sc-stack-card" })), el("b", { class: "sc-stack-n" }));
    for (const i of node.querySelectorAll("i")) i.innerHTML = back;
  }
  node.lastChild.textContent = String(count);
  node.dataset.count = String(count);
}

// The dashed place a stack rests in: "sm", "md" or "lg".
export const slotEl = (size = "md") => el("span", { class: `sc-slot ${size}`, "aria-hidden": "true" });

const rectOf = (r) => ({ x: r.x ?? r.left, y: r.y ?? r.top, w: r.w ?? r.width, h: r.h ?? r.height });

// Slides a stack from one rect to another inside layer (positioned; rects in
// its coordinates as { x, y, w, h } or a DOMRect-like { left, top, width,
// height }). The stack lands at toRect's size, stays in the layer where it
// landed and the promise resolves with it; with into, it then moves into that
// element instead.
export async function slide(node, fromRect, toRect, { ms = 640, layer, into = null } = {}) {
  const from = rectOf(fromRect);
  const to = rectOf(toRect);
  layer.append(node);
  node.classList.add("sc-sliding");
  Object.assign(node.style, { position: "absolute", left: "0px", top: "0px", width: `${to.w}px` });
  const h = node.offsetHeight || to.h;
  const at = (r, s, lift = 0) => `translate(${(r.x + r.w / 2 - to.w / 2).toFixed(1)}px, ${(r.y + r.h / 2 - h / 2 - lift).toFixed(1)}px) scale(${s.toFixed(3)})`;
  const s0 = from.w / to.w || 1;
  const mid = { x: (from.x + to.x) / 2 + (to.w - from.w) / 4, y: (from.y + to.y) / 2, w: (from.w + to.w) / 2, h: (from.h + to.h) / 2 };
  const lift = Math.min(36, Math.hypot(to.x - from.x, to.y - from.y) * 0.12 + 6);
  if (!reduced() && ms > 0 && node.animate) {
    const motion = node.animate(
      [
        { transform: at(from, s0) },
        { transform: at(mid, ((s0 + 1) / 2) * 1.06, lift), offset: 0.5 },
        { transform: at(to, 1) },
      ],
      { duration: ms, easing: ease(), fill: "forwards" },
    );
    await motion.finished.catch(() => {});
    node.style.transform = at(to, 1);
    motion.cancel();
  } else node.style.transform = at(to, 1);
  node.classList.remove("sc-sliding");
  if (into) {
    for (const k of ["position", "left", "top", "width", "transform"]) node.style.removeProperty(k);
    into.append(node);
  }
  return node;
}

// ---------- the ring ----------

const pct = (v, of) => `${((v / of) * 100).toFixed(2)}%`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A stack's width on the ring, in viewBox units (ring.css sizes it the same).
export const stackSize = (players) => RING.W * (players <= 4 ? 0.095 : players === 5 ? 0.085 : 0.075);

// The box a seat's stack covers at angle deg: { x, y, w, h } in viewBox units.
export function stackBox(deg, players) {
  const s = stackSize(players);
  const [x, y] = pointAt(deg, RING.lane);
  return { x: x - s / 2, y: y - 0.56 * s, w: s, h: s };
}

const PAD = 5;
const hits = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const boxAt = ([x, y], [w, h]) => ({ x: x - w / 2, y: y - h / 2, w, h });

// Where each seat's plate or dot sits (its centre, viewBox units), given their
// sizes [w, h] by seat: on the seats' ellipse, inside the ring's box, and
// moved off any stack it would cover, away from the table's middle line.
export function seatSpots(players, me, sizes) {
  const { W, H } = RING;
  const angles = seatAngles(players, me);
  const boxes = angles.map((deg) => stackBox(deg, players));
  return angles.map((deg, p) => {
    const [w, h] = sizes[p];
    let [x, y] = pointAt(deg, RING.seat);
    x = clamp(x, w / 2 + 2, W - w / 2 - 2);
    y = clamp(y, h / 2 + 2, H - h / 2 - 2);
    const up = Math.sin(deg * RAD) < -0.2;
    for (const b of [...boxes].sort((a, c) => (up ? c.y - a.y : a.y - c.y))) {
      if (hits(boxAt([x, y], [w, h]), b, PAD)) y = up ? b.y - h / 2 - PAD : b.y + b.h + h / 2 + PAD;
    }
    return [x, clamp(y, h / 2 + 2, H - h / 2 - 2)];
  });
}

// The ellipse the ties follow, just outside the table's rim.
export const TIE = [RING.table[0] + 36, RING.table[1] + 36];

// A gold tie from your plate's centre to a neighbour's, running round the
// table just outside its rim (the plates, drawn over it, hide its ends).
export function tiePath(mine, theirs) {
  const [rx, ry] = TIE;
  const angle = ([x, y]) => Math.atan2((y - RING.cy) / ry, (x - RING.cx) / rx) / RAD;
  const a0 = angle(mine);
  let a1 = angle(theirs);
  const side = theirs[0] < mine[0] ? 1 : -1;
  // Left neighbours lie clockwise of you on screen, right ones anticlockwise.
  while (side > 0 && a1 < a0) a1 += 360;
  while (side < 0 && a1 > a0) a1 -= 360;
  const f = (pt) => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
  return `M${f(mine)}L${f(pointAt(a0, TIE))}A${rx} ${ry} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${side > 0 ? 1 : 0} ${f(pointAt(a1, TIE))}L${f(theirs)}`;
}

// The felt: a soft shadow, the rim, the cloth, the lane and its chevrons
// between the stacks pointing the way hands go. Id-free.
function feltSvg(players, me, dir) {
  const { W, H, cx, cy, lane, table } = RING;
  const [tx, ty] = table;
  const [lx, ly] = lane;
  const ell = (cls, dy, rx, ry, extra = "") => `<ellipse class="${cls}" cx="${cx}" cy="${cy + dy}" rx="${rx}" ry="${ry}"${extra}/>`;
  let o = ell("sh", 30, tx + 22, ty + 22, ' opacity="0.3"') + ell("sh", 21, tx + 14, ty + 14, ' opacity="0.5"') + ell("sh", 14, tx + 8, ty + 8);
  o += ell("rim-2", 12, tx + 12, ty + 12) + ell("rim", 0, tx + 12, ty + 12) + ell("top", 0, tx, ty) + ell("sheen", -12, tx - 40, ty - 36);
  o += ell("rim-dots", 7, tx + 6, ty + 6);
  o += ell("lane", 0, lx, ly) + ell("lane-edge", 0, lx + 18, ly + 18) + ell("lane-edge", 0, lx - 18, ly - 18);
  const step = 360 / players;
  const per = players <= 3 ? 3 : players <= 5 ? 2 : 1;
  let chev = "";
  let k = 0;
  for (const a of seatAngles(players, me)) {
    for (let i = 1; i <= per; i++) {
      const t = (a + (step * i) / (per + 1)) * RAD;
      const [x, y] = [cx + lx * Math.cos(t), cy + ly * Math.sin(t)];
      const tan = Math.atan2(ly * Math.cos(t), -lx * Math.sin(t)) / RAD + (dir < 0 ? 180 : 0);
      chev += `<path class="chev" style="--k:${k++}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tan.toFixed(1)})" d="M-6 -9L6 0L-6 9"/>`;
    }
  }
  return `<svg class="sc-ring-felt" viewBox="0 0 ${W} ${H}" focusable="false" aria-hidden="true">${o}<g class="chevs">${chev}</g></svg>`;
}

export function seatRing({ kit, nameOf }) {
  const { W, H } = RING;
  const words = el("p", { class: "sc-ring-words" });
  const felt = el("div", { class: "sc-ring-felt-box" });
  const ties = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ties.setAttribute("class", "sc-ring-ties");
  ties.setAttribute("viewBox", `0 0 ${W} ${H}`);
  ties.setAttribute("aria-hidden", "true");
  const numeral = el("b", { class: "sc-ring-numeral" });
  const medal = el("span", { class: "sc-ring-medal", "data-tip": "turn" }, el("small", {}, "Age"), numeral);
  const pips = el("span", { class: "sc-ring-pips", "data-tip": "turn" }, ...Array.from({ length: ROUNDS }, () => el("i")));
  const dirText = el("span", { class: "sc-ring-dir", "data-tip": "direction" });
  const mid = el("div", { class: "sc-ring-mid", "aria-hidden": "true" }, medal, pips, dirText);
  const seatsBox = el("div", { class: "sc-ring-seats" });
  const stacksBox = el("div", { class: "sc-ring-stacks", "aria-hidden": "true" });
  const node = el("div", { class: "sc-ring", role: "group", "aria-label": "The table" }, words, felt, ties, mid, stacksBox, seatsBox);
  node.style.setProperty("--sc-ring-mid-y", pct(RING.cy - 5, H));

  let st = { players: 0, me: 0, age: 0, round: 0, count: 0 };
  let seats = []; // plate or dot, by seat
  let stacks = []; // by seat
  let angles = [];
  let marked = null;
  let busy = null;
  let built = "";

  const place = (s, deg) => {
    const [x, y] = pointAt(deg, RING.lane);
    s.style.left = pct(x, W);
    s.style.top = pct(y, H);
    // Stacks nearer the bottom are nearer you: drawn over the ones behind.
    s.style.zIndex = String(Math.round(10 + Math.sin(deg * RAD) * 5));
  };

  // Plates and dots are measured, so a long name or a phone's minimum font
  // still keeps them off the stacks.
  function layout() {
    const k = W / (node.clientWidth || 0);
    if (!Number.isFinite(k) || !seats.length) return;
    const sizes = seats.map((s) => [s.offsetWidth * k, s.offsetHeight * k]);
    const spots = seatSpots(st.players, st.me, sizes);
    seats.forEach((s, p) => {
      s.style.left = pct(spots[p][0], W);
      s.style.top = pct(spots[p][1], H);
    });
    const left = passTarget(st.players, st.me, 1);
    const right = passTarget(st.players, st.me, -1);
    ties.innerHTML = [left, right].map((q) => `<path class="tie" d="${tiePath(spots[st.me], spots[q])}"/>`).join("");
  }
  const later = () => globalThis.requestAnimationFrame?.(layout);
  if (typeof ResizeObserver === "function") new ResizeObserver(later).observe(node);
  document.fonts?.ready.then(later);

  function build() {
    const { players, me } = st;
    angles = seatAngles(players, me);
    const left = passTarget(players, me, 1);
    const right = passTarget(players, me, -1);
    node.dataset.players = String(players);
    seats = angles.map((deg, p) => {
      const near = p === me || p === left || p === right;
      const name = p === me ? "You" : nameOf(p);
      const seat = near
        ? el("span", { class: `sc-ring-plate p-${p}${p === me ? " me" : ""}`, "data-tip": "seat", "data-tip-p": String(p) }, markOf(kit, p), el("span", { class: "nm" }, name))
        : el("span", { class: `sc-ring-dot p-${p}`, role: "img", "aria-label": name, tabindex: "0", "data-tip": "seat", "data-tip-p": String(p) }, markOf(kit, p));
      const [x, y] = pointAt(deg, RING.seat);
      seat.style.left = pct(clamp(x, W * 0.12, W * 0.88), W);
      seat.style.top = pct(y, H);
      return seat;
    });
    seatsBox.replaceChildren(...seats);
    stacks = angles.map((deg, p) => {
      const s = el("span", { class: "sc-ring-stack", "data-tip": "back", "data-tip-p": String(p) }, stackEl(st.age, st.count));
      place(s, deg);
      return s;
    });
    stacksBox.replaceChildren(...stacks);
    marked = null;
    layout();
    later();
  }

  function draw() {
    const dir = passDir(st.age || 1);
    felt.innerHTML = feltSvg(st.players, st.me, dir);
    node.dataset.dir = dir > 0 ? "left" : "right";
    numeral.textContent = ROMAN[st.age] ?? "";
    medal.dataset.tipAge = String(st.age);
    medal.dataset.tipRound = pips.dataset.tipRound = String(st.round);
    const turn = clamp(st.round, 0, ROUNDS);
    [...pips.children].forEach((pip, i) => (pip.className = i < turn - 1 ? "done" : i === turn - 1 ? "now" : ""));
    dirText.textContent = `hands go ${dir > 0 ? "left" : "right"}`;
    dirText.dataset.tipDir = String(dir);
    for (const s of stacks) {
      setStack(s.firstChild, st.age, st.count);
      s.hidden = !(st.count > 0);
      s.dataset.tipCount = String(st.count);
    }
    words.textContent = ringWords(st, (p) => (p === st.me ? "you" : nameOf(p)));
  }

  function update(next) {
    st = { ...st, ...next };
    const key = `${st.players} ${st.me} ${Array.from({ length: st.players }, (_, p) => nameOf(p)).join("|")}`;
    if (key !== built) {
      built = key;
      build();
    }
    draw();
  }

  function mark(seat) {
    marked = seat ?? null;
    stacks.forEach((s, p) => s.classList.toggle("coming", p === marked));
  }

  // Every stack moves one seat along the lane; resolves when they have landed.
  function pass(dir, { ms = 900 } = {}) {
    if (busy) return busy;
    const n = st.players;
    const step = (360 / n) * dir;
    const finish = () => {
      // The stack that came to seat q is stacks[q] from now on (a mark rides along).
      const moved = [];
      stacks.forEach((s, p) => (moved[passTarget(n, p, dir)] = s));
      stacks = moved;
      marked = marked === null ? null : passTarget(n, marked, dir);
      stacks.forEach((s, p) => {
        place(s, angles[p]);
        s.dataset.tipP = String(p);
      });
      node.classList.remove("passing");
      busy = null;
    };
    if (reduced() || ms <= 0 || typeof requestAnimationFrame !== "function") {
      finish();
      return Promise.resolve();
    }
    node.classList.add("passing");
    busy = new Promise((done) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = out(t);
        stacks.forEach((s, p) => {
          place(s, angles[p] + step * e);
          s.style.scale = String(1 + Math.sin(Math.PI * t) * 0.08);
        });
        if (t < 1) return requestAnimationFrame(frame);
        stacks.forEach((s) => s.style.removeProperty("scale"));
        finish();
        done();
      };
      requestAnimationFrame(frame);
    });
    return busy;
  }

  return { node, update, pass, mark };
}
