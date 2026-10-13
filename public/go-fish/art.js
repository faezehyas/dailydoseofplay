// What the Go Fish view (main.js) shares with its tutorial (tutorial.js): the
// pace of its motion, the seats you ask, the books, your hand, the ask
// button, the speech bubbles and the motion of cards changing hands.
import { el } from "../engine/shell.js";
import { tokenMs, easing } from "../engine/cards/table.js";
import { cardWords } from "../engine/cards/faces.js";
import { rankOf, rankWords } from "./rules.js";
import { play } from "./sounds.js";

// How long robots take before each move (robotPause() scales these in tests).
export const ROBOT_PACE = { answer: 480, book: 380, done: 220, ask: 650, option: 80, max: 1800 };
// Your browser's own answers, books and lucky fish, after a short beat.
export const AUTO = { answer: 550, book: 400, show: 400, done: 250 };
export const PACE = { deal: 70, dealFly: 300, give: 440, draw: 360, book: 460, bubble: 820, between: 180, take: 60 };
const NUMBER = ["no", "one", "two", "three", "four"];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// "a 7", "an 8", "two Jacks"
export const cardsOf = (n, r) => (n === 1 ? `${r === 0 || r === 7 ? "an" : "a"} ${rankWords(r).replace(/s$/, "")}` : `${NUMBER[n] ?? n} ${rankWords(r)}`);
// What the player asked says as they hand over n cards.
export const giveWords = (n) => (n === 1 ? "Here you go!" : n === 2 ? "Here, both!" : `Here, all ${NUMBER[n] ?? n}!`);
const FISH_SVG =
  '<svg viewBox="0 0 40 24" aria-hidden="true" focusable="false"><path d="M3 12C9 3 21 2 29 9L37 3V21L29 15C21 22 9 21 3 12Z" fill="currentColor"/><circle cx="11" cy="10.5" r="2" fill="#fff"/><circle cx="11.4" cy="10.7" r="1" fill="#1d2129"/><path d="M17 8Q20 12 17 16" fill="none" stroke="rgb(0 0 0 / 22%)" stroke-width="1.4" stroke-linecap="round"/></svg>';

// "Go fish!" in a bubble, with a fish.
export function fishWords() {
  const icon = el("span", { class: "gf-say-fish", "aria-hidden": "true" });
  icon.innerHTML = FISH_SVG;
  return [icon, "Go fish!"];
}

// Your hand, by rank (so a rank's cards sit together), then suit.
const handOrder = (slot, face) => (face === null ? 1000 + slot : rankOf(face) * 4 + Math.floor(face / 13));

// Another player's seat, with their books and a button to ask them (onPick(p)).
export function askSeat(table, { p, name, pos, onPick }) {
  const seat = table.makeSeat({ p, name, pos });
  seat.books = el("div", { class: "gf-books", "aria-hidden": "true" });
  seat.pick = el("button", { class: "gf-pick", type: "button", dataset: { seat: p }, disabled: true, onclick: () => onPick(p) });
  seat.node.append(seat.books);
  seat.node.prepend(seat.pick);
  return seat;
}

// A seat as drawn: its fan and books, and whether you may ask it (can) and have picked it (chosen).
export function drawSeat(table, o, { name, hand, books, face, arriving, out, can, chosen, asked, rank, unit }) {
  const n = hand.length;
  o.render(hand, arriving, `${name}: ${out ? "out of cards" : plural(n, "card")}, ${plural(books.length, unit)}`);
  drawBooks(table, o.books, books, { face, arriving });
  o.pick.disabled = !can;
  o.pick.setAttribute("aria-label", can ? `Ask ${name}${rank !== null ? ` for ${rankWords(rank)}` : ""} (${plural(n, "card")})` : `${name}, ${plural(n, "card")}`);
  o.pick.setAttribute("aria-pressed", String(can && chosen));
  o.node.classList.toggle("askable", can);
  o.node.classList.toggle("chosen", can && chosen);
  o.node.classList.toggle("asked", asked);
  o.node.classList.toggle("out", !!out);
}

// Each book a small fan of its cards, face up; a long row overlaps more.
export function drawBooks(table, box, books, { face, arriving }) {
  const want = books.map((b) => String(b.slots[0]));
  const have = [...box.children].map((c) => c.dataset.book);
  if (have.join() !== want.join()) {
    for (const node of [...box.children]) if (!want.includes(node.dataset.book)) node.remove();
    books.forEach((b, i) => {
      let node = box.querySelector(`[data-book="${b.slots[0]}"]`);
      if (!node) {
        node = el("div", { class: "gf-book", dataset: { book: b.slots[0], rank: b.rank } }, b.slots.map((slot) => table.cardEl(face(slot))));
      }
      if (box.children[i] !== node) box.insertBefore(node, box.children[i] ?? null);
    });
  }
  box.style.setProperty("--n", String(books.length));
  for (const node of box.children) node.style.opacity = arriving.has(Number(node.dataset.book)) ? "0" : "";
}

// Your hand, the cards of the rank you ask for (rank) lifted while it is your ask.
export function drawHand(table, hand, { face, arriving, rank, asking }) {
  const slots = hand.slice().sort((a, b) => handOrder(a, face(a)) - handOrder(b, face(b)));
  const chosen = slots.filter((slot) => face(slot) !== null && rankOf(face(slot)) === rank);
  table.renderHand(slots, {
    face,
    arriving,
    first: chosen[0],
    look: (slot, f) => {
      const on = f !== null && rankOf(f) === rank && asking;
      return {
        lift: on,
        classes: { chosen: on, askable: asking },
        label: f === null ? "A card, still being dealt" : `${cardWords(f)}${on ? ", chosen to ask for" : ""}`,
      };
    },
  });
}

// The Ask button and the hints under the hand and beside the table; to is the player picked, many whether there was a choice.
export function drawAsk({ askBtn, handHint, hint, tableBox }, { asking, playing, rank, to, many, nameOf }) {
  askBtn.hidden = !asking;
  tableBox.classList.toggle("my-ask", asking);
  if (!asking) {
    handHint.textContent = "";
    hint.textContent = playing ? "Ask for a rank you hold. Got them all? You go again. Go fish? You draw from the pond." : "";
    hint.parentNode.hidden = !hint.textContent;
    return;
  }
  hint.parentNode.hidden = false;
  askBtn.disabled = rank === null || to === null;
  askBtn.textContent = rank === null && to === null ? "Pick a card and a player" : rank === null ? `Ask ${nameOf(to)} for…` : to === null ? `Ask … for ${rankWords(rank)}` : `Ask ${nameOf(to)} for ${rankWords(rank)}`;
  handHint.textContent = rank === null ? "Tap a card to ask for its rank" : many && to === null ? "Now tap a player" : "";
  hint.textContent = "Tap a card, then a player, then Ask. Keys: arrows and Enter in your hand, Tab to the players, A asks, Esc clears.";
}

// The table's motion. view() is the table as drawn ({ hands, stock, books, arriving }),
// redrawn by render(); sayHost(p) holds p's bubbles; total() is the books in the game.
export function tableMotion({ table, view, render, face, me, seats, seatRect, booksBox, sayHost, tableBox, pond, stock, total }) {
  const { cardEl, fly, live, fast, wait, rectIn, flyLayer, handCards } = table;

  // A speech bubble at a seat: "Got any 7s?", "Go fish!".
  function say(p, content, g, kind = "") {
    if (!live(g)) return;
    const host = sayHost(p);
    host.querySelector(":scope > .gf-say")?.remove();
    const node = el("div", { class: `gf-say p-${p} ${kind}`, role: "presentation" }, content);
    host.append(node);
    // Kept inside the table; its tail still points at the seat.
    const b = node.getBoundingClientRect();
    const t = tableBox.getBoundingClientRect();
    const shift = Math.max(0, t.left + 8 - b.left) + Math.min(0, t.right - 8 - b.right);
    if (shift) {
      node.style.marginLeft = `${shift}px`;
      node.style.setProperty("--shift", `${shift}px`);
    }
    const end = () => node.remove();
    const ms = PACE.bubble * 1.7;
    if (fast()) return setTimeout(end, 900);
    node
      .animate(
        [
          { transform: "translate(-50%, 8px) scale(.7)", opacity: 0 },
          { transform: "translate(-50%, 0) scale(1)", opacity: 1, offset: 0.14 },
          { transform: "translate(-50%, 0) scale(1)", opacity: 1, offset: 0.85 },
          { transform: "translate(-50%, -6px) scale(.96)", opacity: 0 },
        ],
        { duration: ms, easing: easing("out") },
      )
      .finished.then(end, end);
  }

  // "Go fish!": rings spread on the pond beside the stock, and a fish leaps out and dives back.
  function splash(g) {
    if (fast() || !live(g)) return;
    const st = rectIn(stock);
    const w = st.w;
    const cx = st.x + w * 1.55;
    const cy = st.y + st.h * 0.7;
    for (const [i, d] of [0, 160].entries()) {
      const ring = el("span", { class: "gf-fx ring" });
      flyLayer.append(ring);
      ring
        .animate([{ transform: `translate(${cx}px, ${cy}px) scale(.3, .15)`, opacity: 0.9 }, { transform: `translate(${cx}px, ${cy}px) scale(${1.8 - i * 0.4}, ${0.9 - i * 0.2})`, opacity: 0 }], { duration: tokenMs("slow") * 3, delay: d, easing: easing("out"), fill: "backwards" })
        .finished.then(() => ring.remove(), () => ring.remove());
    }
    const fish = el("span", { class: "gf-fx fish" });
    fish.innerHTML = FISH_SVG;
    fish.style.setProperty("--fw", `${Math.round(w * 0.75)}px`);
    flyLayer.append(fish);
    const span = w * 0.55;
    const up = Math.min(90, st.h * 0.75);
    const at = (dx, dy, rot, s = 1) => `translate(${cx + dx}px, ${cy + dy}px) rotate(${rot}deg) scale(${s})`;
    fish
      .animate(
        [
          { transform: at(span, 6, 50, 0.5), opacity: 0 },
          { transform: at(span * 0.6, -up * 0.7, 30), opacity: 1, offset: 0.25 },
          { transform: at(0, -up, 0), opacity: 1, offset: 0.5 },
          { transform: at(-span * 0.6, -up * 0.7, -30), opacity: 1, offset: 0.75 },
          { transform: at(-span, 6, -50, 0.5), opacity: 0 },
        ],
        { duration: tokenMs("slow") * 3.2, easing: "cubic-bezier(.3,.1,.4,1)" },
      )
      .finished.then(() => fish.remove(), () => fish.remove());
    for (let i = 0; i < 5; i++) {
      const drop = el("span", { class: "gf-fx drop" });
      flyLayer.append(drop);
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      drop
        .animate([{ transform: `translate(${cx + span}px, ${cy}px) scale(.6)`, opacity: 0.9 }, { transform: `translate(${cx + span + Math.cos(a) * 34}px, ${cy + Math.sin(a) * 30}px) scale(1)`, opacity: 0 }], { duration: tokenMs("slow") * 2, delay: 60, easing: easing("out"), fill: "backwards" })
        .finished.then(() => drop.remove(), () => drop.remove());
    }
  }

  // Sparkles round a rect: a lucky catch, a book.
  function sparkle(r, p, g, n = 8) {
    if (fast() || !live(g)) return;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    for (let i = 0; i < n; i++) {
      const node = el("span", { class: `gf-fx spark p-${p}` });
      flyLayer.append(node);
      const a = (i / n) * Math.PI * 2;
      const d = Math.max(r.w, r.h) * 0.6 + 14;
      node
        .animate([{ transform: `translate(${cx}px, ${cy}px) scale(.2)`, opacity: 1 }, { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d}px) scale(1)`, opacity: 0 }], { duration: tokenMs("slow") * 2.4, easing: easing("out") })
        .finished.then(() => node.remove(), () => node.remove());
    }
  }

  // Moves `slot` from the pond to player p's hand.
  async function dealTo(p, slot, g, ms, sound = "deal") {
    const from = table.stockRect();
    view().stock = Math.max(0, view().stock - 1);
    view().hands[p].push(slot);
    view().arriving.add(slot);
    render();
    if (sound) play(sound);
    await fly(p === me ? face(slot) : null, from, seatRect(p, slot), { ms, turn: p === me && face(slot) !== null ? "up" : null, g });
    view().arriving.delete(slot);
    if (live(g)) render();
  }

  // Cards handed over, face up: from the answerer's hand to the asker's.
  async function handOver(ev, g, k) {
    const from = new Map(ev.slots.map((slot) => [slot, seatRect(ev.p, slot)]));
    view().hands[ev.p] = view().hands[ev.p].filter((s) => !ev.slots.includes(s));
    for (const slot of ev.slots) {
      view().hands[ev.to].push(slot);
      view().arriving.add(slot);
    }
    render();
    // At once (reduced motion, a hidden tab): one slide, not a burst.
    if (fast()) play("draw");
    await Promise.all(
      ev.slots.map((slot, i) =>
        wait(i * 110 * k, g).then(async () => {
          if (!fast()) play("draw");
          await fly(face(slot), from.get(slot), seatRect(ev.to, slot), { ms: PACE.give * k, turn: ev.to === me ? null : "down", g });
          view().arriving.delete(slot);
          if (live(g)) render();
        }),
      ),
    );
  }

  // A book: its cards gather from the hand and fan down in front of their owner.
  async function layBook(ev, g, k) {
    const from = new Map(ev.slots.map((slot) => [slot, seatRect(ev.p, slot)]));
    view().hands[ev.p] = view().hands[ev.p].filter((s) => !ev.slots.includes(s));
    view().books[ev.p].push({ rank: ev.rank, slots: ev.slots.slice() });
    view().arriving.add(ev.slots[0]);
    render();
    const node = booksBox(ev.p).querySelector(`[data-book="${ev.slots[0]}"]`);
    const targets = node ? [...node.children].map((c) => rectIn(c)) : [];
    await Promise.all(ev.slots.map((slot, i) => wait(i * 70 * k, g).then(() => fly(face(slot), from.get(slot), targets[i] ?? rectIn(booksBox(ev.p)), { ms: PACE.book * k, turn: ev.p === me ? null : "up", spin: (i - 1.5) * 6, g }))));
    view().arriving.delete(ev.slots[0]);
    if (!live(g)) return;
    render();
    play("book");
    if (node && !fast()) node.animate([{ transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: tokenMs("slow") * 1.4, easing: easing("spring") });
    if (node) sparkle(rectIn(node), ev.p, g, 10);
    // The last book of the game: confetti from where it landed.
    if (view().books.flat().length === total() && node) table.confetti(rectIn(node), ev.p, seats, g);
  }

  // A lucky fish is shown: your card hops; another player's flips up over their seat.
  async function showLucky(ev, g, k) {
    if (ev.p === me) {
      const btn = handCards.get(ev.slot);
      if (btn && !fast() && live(g)) btn.firstChild.animate([{ transform: "translateY(0)" }, { transform: "translateY(-22px) rotate(-4deg)", offset: 0.4 }, { transform: "translateY(0)" }], { duration: tokenMs("slow") * 2.4, easing: easing("spring") });
      if (btn) sparkle(rectIn(btn.firstChild), me, g);
      await wait(PACE.bubble * 0.7 * k, g);
      return;
    }
    const from = seatRect(ev.p, ev.slot);
    const r = rectIn(pond);
    const to = { x: from.x + (r.x + r.w / 2 - from.x) * 0.35, y: from.y + 30, w: r.w * 0.55, h: r.w * 0.55 * 1.4 };
    if (fast() || !live(g)) return;
    const card = cardEl(face(ev.slot), { down: true });
    card.classList.add("gf-shown");
    card.style.width = `${to.w}px`;
    card.style.height = `${to.h}px`;
    flyLayer.append(card);
    card.animate([{ transform: `translate(${from.x}px, ${from.y}px) scale(${from.w / to.w})`, opacity: 0.6 }, { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1, offset: 0.35 }, { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1, offset: 0.8 }, { transform: `translate(${from.x}px, ${from.y}px) scale(${from.w / to.w})`, opacity: 0 }], {
      duration: PACE.bubble * 1.8 * k,
      easing: easing("out"),
      fill: "forwards",
    });
    const inner = card.querySelector(".in");
    inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: PACE.bubble * 0.5 * k, delay: PACE.bubble * 0.3 * k, easing: easing("out"), fill: "forwards" });
    setTimeout(() => sparkle(to, ev.p, g), PACE.bubble * 0.6 * k);
    await wait(PACE.bubble * 1.8 * k, g);
    card.remove();
  }

  return { say, splash, dealTo, handOver, layBook, showLucky };
}
