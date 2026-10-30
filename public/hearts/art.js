// What the Hearts view (main.js) shares with its tutorial (tutorial.js): the
// pace of its motion, the table (the others round the trick, its chips and a
// hand's tally, your corner), how it draws your hand, the seats and the trick,
// and how it moves: a card to the trick, a trick taken, the queen landing,
// hearts breaking, the pass and a hand's points tallying up.
import { el } from "../engine/shell.js";
import { tokenMs, easing } from "../engine/cards/table.js";
import { cardWords, cardName, suitOf, SUIT_NAMES } from "../engine/cards/faces.js";
import { isPoint, HEARTS, QUEEN_SPADES } from "./rules.js";
import { play } from "./sounds.js";

export const PACE = { deal: 26, dealFly: 260, pass: 520, between: 140, play: 360, look: 520, gather: 440, tally: 45, bubble: 820, moment: 900 };
export const DIR_WORD = { left: "left", right: "right", across: "across" };
const DIR_ARROW = { left: "←", right: "→", across: "↑" };
const MOON_SVG =
  '<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle cx="60" cy="60" r="44" fill="currentColor" opacity=".18"/><path d="M78 20a44 44 0 1 0 22 62A36 36 0 1 1 78 20Z" fill="currentColor"/><circle cx="52" cy="52" r="5" fill="#000" opacity=".12"/><circle cx="44" cy="76" r="7" fill="#000" opacity=".1"/><circle cx="66" cy="88" r="4" fill="#000" opacity=".12"/></svg>';
const HEART_SVG = '<svg viewBox="0 0 24 22" aria-hidden="true" focusable="false"><path d="M12 21 2.6 11.7A5.6 5.6 0 0 1 12 4a5.6 5.6 0 0 1 9.4 7.7Z" fill="currentColor"/></svg>';
const BROKEN_SVG =
  '<svg viewBox="0 0 24 22" aria-hidden="true" focusable="false"><path class="l" d="M12 21 2.6 11.7A5.6 5.6 0 0 1 12 4l-1.6 4.4 2.6 3-2.2 3.4Z" fill="currentColor"/><path class="r" d="M12 21l1.2-6.2 2.2-3.4-2.6-3L12 4a5.6 5.6 0 0 1 9.4 7.7Z" fill="currentColor"/></svg>';

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

// Your hand by suit (clubs, diamonds, spades, hearts, alternating colours), low to high.
const SUIT_ORDER = [3, 2, 0, 1];
export const handOrder = (slot, f) => (f === null ? 1000 + slot : SUIT_ORDER.indexOf(suitOf(f)) * 20 + (f % 13 === 0 ? 14 : f % 13));

// The table as drawn, from a match state.
export function tableView(st) {
  return {
    hands: st.hands.map((h) => h.slice()),
    trick: st.trick.map((x) => ({ p: x.p, slot: x.slot })),
    won: st.won.map((w) => w.length / st.players),
    scores: st.scores.slice(),
    dir: st.dir,
    picks: st.picks.map(Boolean),
    stock: 0,
    wins: -1,
    arriving: new Set(),
    flipping: new Set(),
  };
}

// Why a card can't be played now, in words.
export function whyNot(st, me, slot, face) {
  const f = face(slot);
  if (st.trick.length) {
    const lead = suitOf(st.trick[0].face);
    const can = st.hands[me].some((s) => suitOf(face(s)) === lead);
    if (suitOf(f) !== lead && can) return `Follow suit: play a ${SUIT_NAMES[lead].toLowerCase().replace(/s$/, "")}`;
    if (st.tricks === 0 && isPoint(f)) return "No points on the first trick";
    return "You can't play that one now";
  }
  if (st.tricks === 0) return "The 2 of clubs leads";
  return suitOf(f) === HEARTS ? "Hearts aren't broken yet: lead another suit" : "You can't lead that one now";
}

// The table: the others round the trick, the trick with its chips and a
// hand's tally, and your corner. names[p] is seat p's name; onPass() presses Pass.
export function heartsTable(table, { me, names, myName, onPass }) {
  const { fly, live, fast, wait, rectIn, flyLayer, hand, handCards } = table;
  const count = names.length;
  const around = Array.from({ length: count }, (_, i) => (me + i) % count); // me, then clockwise (to my left)

  // The others round the table: the next on your left, then across, then on your right.
  const POS = count === 4 ? ["left", "top", "right"] : ["left", "right"];
  const posOf = (p) => (p === me ? "bottom" : POS[around.indexOf(p) - 1]);
  const opps = around.slice(1).map((p, i) => {
    const seat = table.makeSeat({ p, name: names[p], pos: POS[i] });
    seat.won = table.makeWon(p);
    seat.mark = el("span", { class: "hr-picked", hidden: true, "aria-hidden": "true" }, "✓");
    seat.node.append(el("span", { class: "hr-seat-row" }, seat.won.node));
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
  const passBtn = el("button", { class: "btn primary hr-pass", type: "button", id: "hr-pass", hidden: true, onclick: () => onPass() }, passLabel, passNote);
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "hr-timer", id: "hr-timer", hidden: true, role: "timer", "aria-label": "Time for your move" }, el("span", { class: "bar" }, timerFill), timerText);
  const actionBar = el("div", { class: "hr-bar", id: "hr-bar" }, passBtn, timer);
  const myCount = el("span", { class: "count mono" }, "0");
  const myWon = table.makeWon(me);
  const myPill = el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, myName), myCount);
  const handHint = el("p", { class: table.cls("hand-hint"), id: "hr-hand-hint" });
  const meArea = el("div", { class: table.cls("me", `p-${me}`) }, actionBar, hand, el("div", { class: "hr-me-row" }, myPill, myWon.node), handHint);
  const tableBox = el("div", { class: table.cls("table", `four-seats seats-${count}`), id: "hr-table" }, el("div", { class: table.cls("opps") }, opps.map((o) => o.node)), centre, meArea);
  const tableWrap = el("div", { class: table.cls("table-wrap") }, tableBox, flyLayer);

  // ---------- drawing ----------
  // Your hand: look gives each card its classes and words.
  function drawHand(slots, { face, arriving, choice, legal, pass, sent, picked }) {
    table.renderHand(slots, {
      face,
      arriving,
      first: legal.size ? slots.find((s) => legal.has(s)) : picked[0],
      look: (slot, f) => {
        const isPicked = picked.includes(slot) || sent.has(slot);
        const playable = legal.has(slot);
        return {
          lift: isPicked,
          classes: { playable, dim: choice === "play" && !playable, picked: isPicked, pickable: pass && !sent.size },
          label:
            f === null
              ? "A card, still being dealt"
              : `${cardWords(f)}${playable ? ", play it" : choice === "play" ? ", can't be played now" : ""}${isPicked ? ", picked to pass" : ""}`,
        };
      },
    });
    myCount.textContent = String(slots.length);
  }

  // passing: the hand is being passed, so a seat that has picked shows a tick.
  function drawSeats(view, passing) {
    for (const o of opps) {
      const n = view.hands[o.p].length;
      // The tricks they've won, but not the points in them: those you remember, as at a real table.
      o.render(view.hands[o.p], view.arriving, `${names[o.p]}: ${plural(n, "card")}, ${plural(view.won[o.p], "trick")} won`);
      o.won.render(view.won[o.p]);
      o.mark.hidden = !(view.dir !== "none" && view.picks[o.p] && passing);
    }
    myWon.render(view.won[me]);
  }

  // The trick and the chips under it; to: the seat you pass to, while you pick (else null).
  function drawCentre(view, { face, nameOf, to }) {
    const lead = view.trick.length ? face(view.trick[0].slot) : null;
    const plays = view.trick.filter((x) => !view.arriving.has(x.slot));
    trick.render(view.trick, {
      face,
      arriving: view.arriving,
      suit: lead === null ? null : suitOf(lead),
      wins: view.wins,
      label: plays.length ? `The trick: ${plays.map((x) => `${nameOf(x.p)} ${cardName(face(x.slot) ?? 0)}`).join(", ")}${lead !== null ? `. Follow ${SUIT_NAMES[suitOf(lead)].toLowerCase()}` : ""}` : "The trick is empty",
    });
    passChip.hidden = to === null;
    if (to !== null) passChip.textContent = `Pass ${DIR_WORD[view.dir]} ${DIR_ARROW[view.dir]} ${nameOf(to)}`;
  }

  // The Pass button (dir: this hand's pass while you pick, else null) and the line under your hand.
  function drawActions({ dir, note, ready, choice, wantPass }) {
    passBtn.hidden = !dir;
    if (dir) {
      passLabel.textContent = `Pass ${DIR_WORD[dir]} ${DIR_ARROW[dir]}`;
      passNote.textContent = note;
      passBtn.disabled = !ready;
    }
    tableBox.classList.toggle("my-turn", !!choice || !!dir);
    handHint.textContent = dir ? (wantPass ? "Esc puts them back" : "Tap three cards to pass") : choice === "play" ? "Tap a lit card to play it" : "";
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

  // Hearts break: the chip's heart cracks in two with a heartbeat, then the chip goes
  // (whether they're broken is yours to remember, as at a real table).
  function heartsBreak(g) {
    play("broken");
    if (fast() || !live(g)) return;
    const [l, r] = brokenChip.querySelectorAll("path");
    const ms = tokenMs("slow") * 2.4;
    brokenChip.hidden = false;
    brokenChip
      .animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1.18)", opacity: 1, offset: 0.12 }, { transform: "scale(1)", offset: 0.2 }, { transform: "scale(1.1)", offset: 0.3 }, { transform: "scale(1)", opacity: 1, offset: 0.8 }, { transform: "scale(1)", opacity: 0 }], { duration: ms * 2, easing: easing("out") })
      .finished.then(() => (brokenChip.hidden = true), () => (brokenChip.hidden = true));
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

  // A card flies from its seat to the trick; the queen lands with her weight.
  async function cardToTrick(view, ev, { g, k, render }) {
    const from = seatRect(ev.p, ev.slot);
    view.hands[ev.p] = view.hands[ev.p].filter((s) => s !== ev.slot);
    view.trick.push({ p: ev.p, slot: ev.slot });
    view.arriving.add(ev.slot);
    render();
    play("play");
    await fly(ev.face, from, trick.rect(ev.p), { ms: PACE.play * k, turn: ev.p === me ? null : "up", spin: ((ev.slot * 37) % 9) - 4, g });
    view.arriving.delete(ev.slot);
    if (!live(g)) return;
    render();
    if (ev.face === QUEEN_SPADES) queenLands(ev.p, g);
  }

  // The trick's winner lights up, then it is swept to their tricks. Returns its points.
  async function takeTrick(view, ev, { face, g, k, render }) {
    await wait(PACE.look * k, g);
    if (!live(g)) return 0;
    view.wins = ev.winner;
    render();
    await wait(PACE.look * 0.6 * k, g);
    if (!live(g)) return 0;
    play("sweep");
    await trick.gather(ev.plays, ev.winner, wonRect(ev.winner), { face, ms: PACE.gather * k, g });
    if (!live(g)) return 0;
    view.trick = [];
    view.wins = -1;
    view.won[ev.winner]++;
    const raw = ev.plays.reduce((n, x) => n + (suitOf(x.face) === HEARTS ? 1 : x.face === QUEEN_SPADES ? 13 : 0), 0);
    render();
    return raw;
  }

  // The pass: each seat's three cards leave face down toward their seat; yours arrive and turn up in your hand.
  async function passCards(view, ev, { to, from, face, g, k, render }) {
    play("pass");
    const flights = [];
    for (let q = 0; q < count; q++) {
      const cards = ev.picks[q].map((s) => ({ face: q === me ? face(s) : null, rect: seatRect(q, s) }));
      flights.push(table.sendCards(cards, seatRect(to(q)), { ms: PACE.pass * k, g }));
    }
    for (let q = 0; q < count; q++) view.hands[q] = view.hands[q].filter((s) => !ev.picks[q].includes(s));
    // The cards coming to you land face down, then turn up.
    const mine = ev.picks[from];
    for (const s of mine) view.flipping.add(s);
    render();
    await Promise.all(flights);
    if (!live(g)) return;
    for (let q = 0; q < count; q++) view.hands[to(q)].push(...ev.picks[q]);
    view.picks = view.picks.map(() => false);
    render();
    await wait(tokenMs("med"), g);
    for (const s of mine) view.flipping.delete(s);
    render();
    await wait(tokenMs("slow"), g);
  }

  // A hand's points tally up: the moon rises first, then each seat's points count into its
  // total, and the lowest light up. scoreOf(p): seat p's total; seats: their colours, for the confetti.
  async function tallyUp(view, ev, { nameOf, scoreOf, seats, g, k, render }) {
    const rows = around.map((p) => {
      const add = el("span", { class: "add mono" }, "0");
      const total = el("span", { class: "total mono" }, String(scoreOf(p)));
      const row = el("div", { class: `hr-tally-row p-${p} ${p === me ? "mine" : ""}` }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "who" }, nameOf(p)), add, total);
      return { p, add, total, row };
    });
    tallyTitle.textContent = ev.moon >= 0 ? `${nameOf(ev.moon)} shot the moon!` : `Hand ${ev.hand}`;
    tallyRows.replaceChildren(...rows.map((r) => r.row));
    if (ev.moon >= 0) {
      play("moon");
      moment(`${nameOf(ev.moon)} shot the moon!`, ev.moon, "moon", g, MOON_SVG);
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
    const best = Math.min(...around.map(scoreOf));
    for (const r of rows) r.row.classList.toggle("low", scoreOf(r.p) === best);
  }

  return {
    around,
    opps,
    seatOf,
    trick,
    deckBox,
    tally,
    passBtn,
    timer,
    timerFill,
    timerText,
    actionBar,
    meArea,
    myWon,
    myPill,
    tableBox,
    tableWrap,
    drawHand,
    drawSeats,
    drawCentre,
    drawActions,
    seatRect,
    wonRect,
    say,
    heartsBreak,
    cardToTrick,
    takeTrick,
    passCards,
    tallyUp,
  };
}
