// The war at the end of an age, from your seat: your army in the middle, each
// neighbour's across a river, the shields counted in on both sides of a
// border, a stamp with the token on it, then the age's sum, your war so far
// and how the other borders went. warFacts and the words are pure; warScene
// is the overlay that plays it and waits for Continue.
import { el } from "../engine/shell.js";
import { CARDS, VICTORY, DEFEAT } from "./cards.js";
import { shields, builtStages, leftOf, rightOf } from "./rules.js";

const ROMAN = ["", "I", "II", "III"];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);
const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Where a seat's shields come from: its red cards in the order built, then its wonder stages. [{ name, shields }]
export function shieldSources(state, p) {
  const cards = state.city[p].map((c) => CARDS[c.id]).filter((c) => c.shields).map((c) => ({ name: c.name, shields: c.shields }));
  const stages = builtStages(state, p).flatMap((s, i) => (s.shields ? [{ name: `Wonder stage ${ROMAN[i + 1]}`, shields: s.shields }] : []));
  return [...cards, ...stages];
}

// The war as you see it. state: after the age's tokens were added; results:
// as in the rules' war event, by seat [vs left, vs right], each 1, 0 or −1.
// Each army's result is yours at that border (1: you won it).
export function warFacts(state, results, me, age) {
  const win = VICTORY[age - 1];
  const army = (p) => {
    const parts = shieldSources(state, p);
    return { p, shields: shields(state, p), from: parts.map((x) => x.name), parts };
  };
  const [a, b] = results[me];
  const n = results.length;
  const elsewhere = results.flatMap((r, p) => {
    const q = (p + 1) % n;
    return p === me || q === me ? [] : [[p, q, r[0]]];
  });
  return {
    age,
    stakes: { win, loss: DEFEAT },
    left: { ...army(leftOf(state, me)), result: a },
    mine: army(me),
    right: { ...army(rightOf(state, me)), result: b },
    gained: [a, b].filter(Boolean).map((r) => (r > 0 ? win : DEFEAT)),
    total: { tokens: state.tokens[me].slice(), points: sum(state.tokens[me]) },
    elsewhere,
  };
}

// "War: you lost to Robot 1 (−1) and beat Robot 3 (+3)", for the status line and screen readers.
export function warSummary(facts, nameOf) {
  const { left, right, stakes } = facts;
  const won = signed(stakes.win);
  if (left.result === right.result) {
    const both = `${nameOf(left.p)} and ${nameOf(right.p)}`;
    return `War: you ${left.result > 0 ? `beat ${both} (${won} each)` : left.result < 0 ? `lost to ${both} (−1 each)` : `drew with ${both}`}`;
  }
  const one = ({ p, result }) => (result > 0 ? `beat ${nameOf(p)} (${won})` : result < 0 ? `lost to ${nameOf(p)} (−1)` : `drew with ${nameOf(p)}`);
  return `War: you ${one(left)} and ${one(right)}`;
}

// The other borders, a winner's wins together: "Robot 2 beat Robot 1 and Robot 3; Ana and Ben drew".
export function elsewhereWords(elsewhere, nameOf) {
  const beat = new Map();
  const drew = [];
  for (const [p, q, r] of elsewhere) {
    if (!r) drew.push(`${nameOf(p)} and ${nameOf(q)} drew`);
    else {
      const [a, b] = r > 0 ? [p, q] : [q, p];
      beat.set(a, [...(beat.get(a) ?? []), b]);
    }
  }
  return [...[...beat].map(([a, bs]) => `${nameOf(a)} beat ${listOf(bs.map(nameOf))}`), ...drew].join("; ");
}

const points = (n) => `${signed(n)} point${Math.abs(n) === 1 ? "" : "s"}`;
// "−1 + 3 = +2 points", "+3 points" or "no tokens".
export function sumWords(tokens) {
  if (tokens.length < 2) return tokens.length ? points(tokens[0]) : "no tokens";
  const terms = tokens.map((v, i) => (i ? (v < 0 ? `− ${-v}` : `+ ${v}`) : v < 0 ? `−${-v}` : String(v))).join(" ");
  return `${terms} = ${points(sum(tokens))}`;
}

// ---------- art ----------
// A slice of river running down a border, in cut paper: a bank each side,
// the current, wave marks and reeds; at night lantern light on the water.
function riverSvg(flip) {
  const H = 300, W = 80;
  const bank = (x0, dir) => {
    let d = `M${x0} -10`;
    for (let y = -10, i = 0; y < H + 10; y += 30, i++) d += `Q${x0 + dir * (i % 2 ? 9 : 4)} ${y + 15} ${x0 + dir * (i % 2 ? 6 : 8)} ${y + 30}`;
    return `${d}L${x0} ${H + 20}Z`;
  };
  const left = bank(0, 1).replace(/^M0/, "M-2");
  const right = bank(W, -1);
  const shade = (d) => `<path d="${d}" class="ws-f-shade" transform="translate(${flip ? -1.4 : 1.4} 1.6)" opacity=".25"/>`;
  const waves = [[30, 40], [50, 78], [26, 120], [54, 158], [34, 200], [48, 238], [28, 272]]
    .map(([x, y]) => `<path d="M${x - 6} ${y}q3 -3 6 0t6 0" class="ws-s-wave"/>`).join("");
  const current = `<path d="M40 -10C30 60 52 120 38 180S46 260 40 310" class="ws-s-current"/>`;
  const reeds = [[6, 22], [W - 7, 96], [7, 184], [W - 6, 262]]
    .map(([x, y]) => `<path d="M${x} ${y}v-12M${x - 3} ${y}l-2 -9M${x + 3} ${y}l2 -9" class="ws-s-reed"/>`).join("");
  const glints = [[38, 60], [44, 150], [36, 232]]
    .map(([x, y]) => `<rect x="${x - 1}" y="${y}" width="3" height="10" rx="1.5" class="ws-f-glint"/><rect x="${x + 3}" y="${y + 13}" width="2" height="5" rx="1" class="ws-f-glint"/>`).join("");
  return `<svg class="ws-river" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
    `<rect x="-5" y="-10" width="${W + 10}" height="${H + 20}" class="ws-f-water"/>` +
    `<path d="M14 -10H${W - 14}V${H + 10}H14Z" class="ws-f-deep" opacity=".55"/>` +
    current + waves + `<g class="ws-night">${glints}</g>` +
    shade(left) + shade(right) + `<path d="${left}" class="ws-f-bank"/><path d="${right}" class="ws-f-bank"/>` + reeds +
    "</svg>";
}

// ---------- the scene ----------
// kit: the game's icon makers; nameOf(p); sound(name, opts, at); reduced:
// play without movement (defaults to the reduced-motion preference).
export function warScene({ kit, nameOf, sound = () => {}, reduced = null } = {}) {
  const still = () => reduced ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const title = el("h2", { class: "ws-title", id: "ws-title" });
  const stakes = el("p", { class: "ws-stakes" });
  const front = el("div", { class: "ws-front" });
  const sumAge = el("div", { class: "ws-sum ws-step" });
  const sumAll = el("div", { class: "ws-sum ws-step" });
  const elsewhere = el("p", { class: "ws-else ws-step" });
  const live = el("p", { class: "sr-only", id: "ws-live" });
  const bar = el("span", { class: "ws-count", "aria-hidden": "true" });
  const label = el("span", {}, "Continue");
  const button = el("button", { class: "btn primary ws-go", type: "button" }, label, bar);
  const card = el(
    "div",
    { class: "ws-card" },
    el("header", { class: "ws-banner" }, el("div", { class: "ws-ribbon" }, title), stakes),
    front,
    el("div", { class: "ws-sums" }, sumAge, sumAll),
    elsewhere,
    el("div", { class: "ws-foot" }, button),
    live,
  );
  const node = el("div", { class: "ws", role: "dialog", "aria-modal": "true", "aria-labelledby": "ws-title", "aria-describedby": "ws-live", hidden: true }, card);

  let run = 0;
  let done = null;
  let timer = 0;
  let tick = 0;
  let back = null;

  const sleep = (ms, r) => new Promise((ok) => setTimeout(() => ok(r === run), ms));

  function finish() {
    if (node.hidden) return;
    run++;
    clearTimeout(timer);
    clearInterval(tick);
    document.removeEventListener("keydown", onKey, true);
    node.removeEventListener("focusout", onFocusOut);
    node.hidden = true;
    node.classList.remove("on");
    if (back?.isConnected) back.focus({ preventScroll: true });
    const ok = done;
    done = null;
    ok?.();
  }
  button.addEventListener("click", finish);

  function onKey(e) {
    if (e.key === "Escape" || ((e.key === "Enter" || e.key === " ") && (e.target === button || !node.contains(e.target) || e.target === node))) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) finish();
      return;
    }
    if (e.key === "Tab") {
      const stops = [...node.querySelectorAll('button, [tabindex="0"]')].filter((x) => !x.closest("[hidden], .ws-off"));
      const i = stops.indexOf(document.activeElement);
      const next = stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length] ?? button;
      e.preventDefault();
      next.focus();
    }
  }
  function onFocusOut(e) {
    if (!node.hidden && e.relatedTarget && !node.contains(e.relatedTarget)) button.focus({ preventScroll: true });
  }

  // One army: who, the big number, the shields, where they come from.
  function armyEl(a, side, me) {
    const num = el("b", { class: "ws-num" }, "0");
    const shelf = el("div", { class: `ws-shields${a.shields >= 10 ? " many" : ""}`, "data-tip": "shields", "data-tip-seat": a.p, tabindex: "0", "aria-label": plural(a.shields, "shield") });
    const pieces = Array.from({ length: a.shields }, () => {
      const s = kit.shieldEl();
      s.classList.add("ws-off");
      return s;
    });
    for (let i = 0; i < pieces.length; i += 5) shelf.append(el("span", { class: "ws-five" }, pieces.slice(i, i + 5)));
    if (!a.shields) shelf.append(el("span", { class: "ws-none" }, "no shields"));
    const from = el(
      "ul",
      { class: "ws-from", "aria-label": a.parts.length ? `Shields from ${listOf(a.parts.map((x) => `${x.name} (${x.shields})`))}` : "No red cards or shield stages" },
      a.parts.length ? a.parts.map((x) => el("li", {}, x.name, el("i", { "aria-hidden": "true" }, ` ${x.shields}`))) : el("li", { class: "ws-nothing" }, "no red cards"),
    );
    const who = el("span", { class: "ws-who", "data-tip": "seat", "data-tip-seat": a.p }, kit.seatMark(a.p), el("span", { class: "ws-name" }, me ? "You" : nameOf(a.p)));
    const node = el("section", { class: `ws-army p-${a.p} ws-${side} ws-wait`, "aria-label": `${me ? "You" : nameOf(a.p)}: ${plural(a.shields, "shield")}` }, who, num, shelf, from);
    return { node, num, pieces, total: a.shields };
  }

  // A border: the river and, once it is decided, the stamp.
  function gateEl(result, win, side) {
    const kind = result > 0 ? "win" : result < 0 ? "loss" : "draw";
    const token = result ? kit.tokenEl(result > 0 ? win : DEFEAT) : el("span", { class: "ws-even", "aria-hidden": "true" }, "=");
    const words = result > 0 ? ["You won", signed(win)] : result < 0 ? ["You lost", "−1"] : ["Draw", "no token"];
    const stamp = el(
      "div",
      { class: `ws-stamp ${kind} ws-off`, ...(result ? { "data-tip": "tokens" } : {}) },
      token,
      el("b", {}, words[0]),
      el("span", {}, words[1]),
    );
    const gate = el("div", { class: `ws-gate ${side}` }, stamp);
    gate.insertAdjacentHTML("afterbegin", riverSvg(side === "right"));
    return { gate, stamp };
  }

  const tokensRow = (tokens, seat) =>
    el("span", { class: "ws-toks", "data-tip": "tokens", "data-tip-seat": seat }, tokens.flatMap((v, i) => [i ? el("span", { class: "ws-op", "aria-hidden": "true" }, "+") : null, kit.tokenEl(v)]));

  async function count(armies, r, k, fast) {
    for (const a of armies) a.node.classList.remove("ws-wait");
    const most = Math.max(0, ...armies.map((a) => a.total));
    if (fast) {
      for (const a of armies) {
        a.pieces.forEach((s) => s.classList.remove("ws-off"));
        a.num.textContent = String(a.total);
      }
      if (most) sound("shield", { i: 0 });
      return sleep(450 * k, r);
    }
    const step = Math.max(70, Math.min(230, 1500 / Math.max(most, 1))) * k;
    for (let i = 0; i < most; i++) {
      for (const a of armies) {
        if (i >= a.total) continue;
        a.pieces[i].classList.remove("ws-off");
        a.num.textContent = String(i + 1);
        a.num.classList.remove("tick");
        void a.num.offsetWidth;
        a.num.classList.add("tick");
      }
      sound("shield", { i });
      if (!(await sleep(step, r))) return false;
    }
    return sleep(380 * k, r);
  }

  async function land(g, result, win, loser, mine, side, r, k, fast) {
    g.stamp.classList.remove("ws-off");
    if (!fast) front.animate([{ transform: "none" }, { transform: "translateY(3px)", offset: 0.3 }, { transform: "none" }], { duration: 260, delay: 140, easing: "ease-out" });
    sound("stamp", { result });
    if (result > 0) sound("victory", { value: win }, 0.12);
    else if (result < 0) sound("defeat", {}, 0.12);
    if (result > 0) loser.node.classList.add("ws-lost");
    else if (result < 0) mine.node.classList.add(`ws-lost-${side}`);
    return sleep(1100 * k, r);
  }

  // Plays the war; resolves when Continue is pressed, or `wait` ms after it
  // has played out (0: only the press). k scales the pace.
  async function play(facts, { wait = 0, k = 1 } = {}) {
    if (!node.hidden) finish();
    const r = ++run;
    const fast = still();
    const { age, left, right, mine } = facts;
    const win = facts.stakes.win;
    title.textContent = `War · end of Age ${ROMAN[age] ?? age}`;
    stakes.replaceChildren("A win is worth ", kit.tokenEl(win), el("span", { class: "ws-dot", "aria-hidden": "true" }, "·"), "a loss ", kit.tokenEl(DEFEAT), el("span", { class: "ws-dot", "aria-hidden": "true" }, "·"), "a draw nothing");
    stakes.setAttribute("aria-label", `A win is worth ${plural(win, "point")}, a loss costs 1 point, a draw nothing`);
    const L = armyEl(left, "left", false);
    const M = armyEl(mine, "mid", true);
    const R = armyEl(right, "right", false);
    const gl = gateEl(left.result, win, "left");
    const gr = gateEl(right.result, win, "right");
    front.replaceChildren(L.node, gl.gate, M.node, gr.gate, R.node);
    sumAge.replaceChildren(el("small", {}, "This age"), facts.gained.length ? el("b", {}, tokensRow(facts.gained, mine.p), el("span", { class: "ws-eq" }, `= ${points(sum(facts.gained))}`)) : el("b", { class: "ws-quiet" }, left.result === 0 && right.result === 0 ? "Two draws: no tokens" : "No tokens"));
    sumAll.replaceChildren(el("small", {}, "Your war so far"), facts.total.tokens.length ? el("b", {}, tokensRow(facts.total.tokens, mine.p), el("span", { class: "ws-eq" }, `= ${points(facts.total.points)}`)) : el("b", { class: "ws-quiet" }, "No tokens yet"));
    sumAge.setAttribute("aria-label", `This age: ${sumWords(facts.gained)}`);
    sumAll.setAttribute("aria-label", `Your war so far: ${facts.total.tokens.length ? `${facts.total.tokens.map(signed).join(" ")}, ${points(facts.total.points)}` : "no tokens yet"}`);
    const others = elsewhereWords(facts.elsewhere, nameOf);
    elsewhere.hidden = !others;
    elsewhere.replaceChildren(...(others ? [el("span", { class: "ws-else-k" }, "Elsewhere at the table: "), el("span", { class: "ws-else-v" }, `${others}.`)] : []));
    for (const x of [sumAge, sumAll, elsewhere]) x.classList.add("ws-off");
    label.textContent = "Continue";
    button.classList.remove("counting");
    clearTimeout(timer);
    clearInterval(tick);
    live.textContent = "";

    node.classList.toggle("ws-still", fast);
    back = document.activeElement;
    if (!node.isConnected) document.body.append(node);
    node.hidden = false;
    const result = new Promise((ok) => (done = ok));
    document.addEventListener("keydown", onKey, true);
    node.addEventListener("focusout", onFocusOut);
    requestAnimationFrame(() => node.classList.add("on"));
    // The dialog's description, read once as Continue takes focus.
    live.textContent = `${warSummary(facts, nameOf)}.`;
    button.focus({ preventScroll: true });
    sound("war");

    (async () => {
      if (!(await sleep((fast ? 250 : 520) * k, r))) return;
      if (!(await count([L, M], r, k, fast))) return;
      if (!(await land(gl, left.result, win, L, M, "left", r, k, fast))) return;
      if (!(await count([R], r, k, fast))) return;
      if (!(await land(gr, right.result, win, R, M, "right", r, k, fast))) return;
      for (const x of [sumAge, sumAll, elsewhere]) {
        x.classList.remove("ws-off");
        if (!(await sleep(650 * k, r))) return;
      }
      if (wait > 0) {
        const end = Date.now() + wait;
        button.style.setProperty("--ws-wait", `${wait}ms`);
        button.classList.add("counting");
        const show = () => (label.textContent = `Continue · ${Math.max(1, Math.ceil((end - Date.now()) / 1000))}`);
        show();
        tick = setInterval(show, 250);
        timer = setTimeout(() => r === run && finish(), wait);
      }
    })();
    return result;
  }

  return { node, play, close: finish };
}
