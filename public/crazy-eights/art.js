// What the Crazy Eights view (main.js) shares with its tutorial (tutorial.js):
// the pace of its motion, the discard pile and the suit to follow, an 8's
// burst of pips and the suit picker.
import { el } from "../engine/shell.js";
import { tokenMs, easing } from "../engine/cards/table.js";
import { suitSvg } from "../engine/cards/art.js";
import { SUIT_NAMES } from "../engine/cards/faces.js";
import { suitOf, rankOf, cardName, isEight } from "./rules.js";

export const PACE = { deal: 70, dealFly: 300, fly: 420, mine: 280, draw: 360, flip: 420, between: 240, bubble: 700, gather: 520 };

// My hand, by suit (alternating colours) then rank; a card not shown yet goes last.
const ORDER = [0, 1, 3, 2];
export const handOrder = (slot, face) => (face === null ? 1000 + slot : ORDER[suitOf(face)] * 13 + ((rankOf(face) + 12) % 13));

// A pile card's tilt, the same for a slot on every render.
export const tilt = (slot) => ((slot * 37) % 15) - 7;

// The top three cards of the discard pile, face up as far as face(slot) knows.
export function drawPile(table, pile, discard, { face, arriving }) {
  const top = discard.slice(-3);
  const want = top.map((slot) => String(slot));
  if ([...pile.children].map((c) => c.dataset.slot).join() !== want.join()) {
    pile.replaceChildren(
      ...top.map((slot) => {
        const card = table.cardEl(face(slot));
        card.dataset.slot = slot;
        return card;
      }),
    );
  }
  for (const card of pile.children) {
    const slot = Number(card.dataset.slot);
    const f = face(slot);
    table.setFace(card, f);
    card.classList.toggle("down", f === null);
    card.style.transform = `rotate(${tilt(slot)}deg)`;
    card.style.opacity = arriving.has(slot) ? "0" : "";
  }
  const topFace = discard.length ? face(discard.at(-1)) : null;
  pile.setAttribute("aria-label", topFace === null ? "Discard pile" : `Discard pile: ${cardName(topFace)} on top`);
}

// The suit to follow, and whether an 8 named it.
export function drawSuit(badge, suit, named) {
  if (suit < 0) return void (badge.hidden = true);
  badge.hidden = false;
  badge.className = `ce-suit-badge s-${suit} ${named ? "named" : ""}`;
  badge.innerHTML = `${suitSvg(suit)}<span>${named ? `${SUIT_NAMES[suit]}, named` : SUIT_NAMES[suit]}</span>`;
  badge.setAttribute("aria-label", `Suit to follow: ${SUIT_NAMES[suit]}${named ? ", named by an 8" : ""}`);
}

// Pips of the named suit burst from the pile (rect r); a ring spreads under them.
export function suitBurst(table, r, suit, g) {
  if (table.fast() || !table.live(g)) return;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const ring = el("span", { class: "pc-fx ring" });
  ring.style.transform = `translate(${cx}px, ${cy}px)`;
  table.flyLayer.append(ring);
  ring.animate([{ transform: `translate(${cx}px, ${cy}px) scale(.4)`, opacity: 1 }, { transform: `translate(${cx}px, ${cy}px) scale(2.6)`, opacity: 0 }], { duration: tokenMs("slow") * 2.2, easing: easing("out") }).finished.then(() => ring.remove(), () => ring.remove());
  const n = 10;
  for (let i = 0; i < n; i++) {
    const node = el("span", { class: `pc-fx s-${suit}` });
    node.innerHTML = suitSvg(suit);
    table.flyLayer.append(node);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 60 + Math.random() * 50;
    node
      .animate(
        [
          { transform: `translate(${cx}px, ${cy}px) scale(.3)`, opacity: 1 },
          { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d}px) scale(1.1) rotate(${(Math.random() - 0.5) * 90}deg)`, opacity: 1, offset: 0.6 },
          { transform: `translate(${cx + Math.cos(a) * d * 1.25}px, ${cy + Math.sin(a) * d * 1.25 + 14}px) scale(.8)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 300, easing: easing("out") },
      )
      .finished.then(() => node.remove(), () => node.remove());
  }
}

// A card that can't be played shakes.
export function nudge(table, node) {
  if (!node || table.fast()) return;
  node.firstChild.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: tokenMs("slow"), easing: easing("out") });
}

// The suit picker for an 8 (face): the suit you hold most of in `rest` takes
// focus; pick(suit) or cancel(). Arrows move, 1 to 4 pick, Escape cancels.
export function showPicker(picker, { face, rest, pick, cancel }) {
  const others = rest.filter((f) => f !== null && !isEight(f));
  const n = [0, 1, 2, 3].map((s) => others.filter((f) => suitOf(f) === s).length);
  const best = n.indexOf(Math.max(...n));
  const buttons = [0, 1, 2, 3].map((s) => {
    const btn = el("button", { class: `ce-pick s-${s} ${s === best ? "best" : ""}`, type: "button", dataset: { suit: s }, "aria-label": `${SUIT_NAMES[s]}${n[s] ? `, you hold ${n[s]}` : ""}` });
    btn.innerHTML = `${suitSvg(s)}<span>${SUIT_NAMES[s]}</span>`;
    btn.addEventListener("click", () => pick(s));
    return btn;
  });
  picker.replaceChildren(
    el(
      "div",
      { class: "ce-picker-card" },
      el("h2", { id: "ce-picker-title" }, `Play ${cardName(face)}: name a suit`),
      el("div", { class: "ce-picker-suits", role: "group", "aria-label": "Suits" }, buttons),
      el("button", { class: "btn small ghost", type: "button", onclick: () => cancel() }, "Cancel"),
    ),
  );
  picker.hidden = false;
  picker.onkeydown = (e) => {
    if (e.key === "Escape") return cancel();
    if (e.key === "Tab") {
      // Modal: Tab cycles through the picker's own buttons.
      const all = [...picker.querySelectorAll("button")];
      const i = all.indexOf(document.activeElement);
      e.preventDefault();
      return all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus();
    }
    const i = buttons.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step && i >= 0) {
      e.preventDefault();
      buttons[(i + step + 4) % 4].focus();
    } else if (/^[1-4]$/.test(e.key)) pick(Number(e.key) - 1);
  };
  buttons[best].focus();
}
