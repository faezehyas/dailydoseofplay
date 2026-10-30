// What the Gin Rummy view (main.js) shares with its tutorial (tutorial.js):
// the pace of its motion, the table's parts, your hand grouped into its
// melds, hands laid down with their lay-offs, the knock's moment and a
// hand's score.
import { el } from "../engine/shell.js";
import { tokenMs, easing } from "../engine/cards/table.js";
import { cardWords, cardName, rankOf, suitOf } from "../engine/cards/faces.js";
import { bestMelds, isRun, sortMeld } from "../engine/cards/melds.js";
import { bestKnock, arrange, GIN_BONUS, BIG_GIN_BONUS, UNDERCUT_BONUS } from "./rules.js";
import { play } from "./sounds.js";

// Your browser's own lay-down and defence, after a short beat.
export const AUTO = { lay: 600, defend: 700 };
export const PACE = { deal: 55, dealFly: 280, flip: 420, draw: 380, take: 440, discard: 400, moment: 900, lay: 460, layoff: 520, count: 40, gather: 460, between: 160, bubble: 820 };
export const KIND = { knock: "Knock", undercut: "Undercut!", gin: "Gin!", big: "Big Gin!" };

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const tilt = (slot) => ((slot * 37) % 13) - 6;

// The table as drawn, from a rules state.
export function viewOf(st) {
  return {
    hands: st.hands.map((h) => h.slice()),
    stock: st.stock.length,
    discard: st.discard.slice(),
    // Until the upcard is turned (its face can arrive after the deal has played), it is still on the stock.
    ...(st.limit === null && st.phase === "upcard" ? { discard: [], stock: st.stock.length + 1 } : {}),
    laid: st.laid.map((l) => l && { melds: l.melds.map((x) => x.slice()), deadwood: l.deadwood.slice() }),
    layoffs: st.layoffs.map((x) => x.slice()),
    knock: st.knock && { ...st.knock },
    result: st.result && { ...st.result },
    scores: st.scores.slice(),
    tally: st.laid.map((l) => (l ? l.points : null)),
    dealer: st.dealer,
    limit: st.limit,
    arriving: new Set(),
  };
}

// The knock seat `me` can make now: { slot, points, big }, the picked card if it knocks too; null if they can't.
export function knockable(st, me, faceOf, selected) {
  const hand = st.hands[me];
  if (st.bigGin && hand.every((s) => faceOf(s) !== null) && !bestMelds(hand.map(faceOf)).points) return { big: true, points: 0, slot: null };
  const k = bestKnock(st, me, faceOf);
  if (!k || k.points > st.limit) return null;
  // The picked card, if throwing it leaves as little as the best throw.
  if (selected !== null && selected !== st.taken && arrange(hand.filter((s) => s !== selected), faceOf).points === k.points) return { slot: selected, points: k.points };
  return { slot: k.discard, points: k.points };
}

// You moved a card in the hand as shown: a meld moves as a whole among the melds; a deadwood card among the deadwood. Returns the new order.
export function moveInHand({ melds, dead, slots }, slot, to, by) {
  const from = slots.indexOf(slot);
  const mi = melds.findIndex((x) => x.includes(slot));
  if (mi >= 0) {
    let target;
    if (by === "key") target = mi + Math.sign(to - from);
    else {
      let n = 0;
      target = 0;
      while (target < melds.length - 1 && n + melds[target].length <= to) n += melds[target++].length;
    }
    target = Math.max(0, Math.min(melds.length - 1, target));
    const list = melds.slice();
    list.splice(target, 0, ...list.splice(mi, 1));
    return [...list.flat(), ...dead];
  }
  const rest = dead.filter((s) => s !== slot);
  rest.splice(Math.max(0, Math.min(rest.length, to - melds.flat().length)), 0, slot);
  return [...melds.flat(), ...rest];
}

// The table seen from seat `me`, on the shared card table: its parts, and
// drawing and moving them as view() (see viewOf) says. names: by seat;
// face(slot): a card's face, or null; render(): draws everything; on: what
// the buttons do.
export function ginTable(table, { me, names, myName, face: faceOf, view, render, on }) {
  const them = 1 - me;
  const theirName = names[them];
  const nameOf = (p) => (p === me ? "You" : names[p]);
  // "You pass", "Bo passes"
  const verb = (p, s) => (p !== me ? s : /(ss|sh|ch|o)es$/.test(s) ? s.slice(0, -2) : s.replace(/s$/, ""));
  const { cardEl, setFace, fly, live, fast, wait, rectIn, flyLayer, hand, handCards } = table;
  let meldSeen = null; // the cards in melds on screen last time, for the click as one joins
  let lastClick = 0;

  // The other player: a fan of backs, or their hand laid down.
  const seat = table.makeSeat({ p: them, name: theirName, pos: "top" });
  const oppDealer = el("span", { class: "gr-dealer", hidden: true }, "Dealer");
  const oppSpread = table.makeSpread("them");
  const oppTally = el("span", { class: "gr-tally mono", id: "gr-tally-them", hidden: true });
  seat.pill.append(oppDealer);
  seat.node.insertBefore(oppSpread.node, seat.pill);
  seat.pill.after(oppTally);

  // The middle: the stock and the discard pile, the knock limit, and the score of a hand once it ends.
  const stockBtn = table.makeStock({ onClick: () => on.draw(), label: (left) => (left ? `The stock: ${plural(left, "card")}` : "The stock is empty") });
  const pile = el("button", { class: "gr-pile", id: "gr-pile", type: "button", onclick: () => on.take() });
  const limitChip = el("span", { class: "gr-limit", id: "gr-limit", hidden: true });
  const scoreTitle = el("strong", { class: "gr-score-title" });
  const scoreSum = el("span", { class: "gr-score-sum" });
  const scorePoints = el("span", { class: "gr-score-points mono" });
  const scoreTotals = el("span", { class: "gr-score-totals" });
  const scoreCard = el("div", { class: "gr-score", id: "gr-score", hidden: true }, scoreTitle, scoreSum, scorePoints, scoreTotals);
  const piles = el(
    "div",
    { class: "gr-piles" },
    el("div", { class: "gr-col" }, el("div", { class: table.cls("stack") }, stockBtn, table.riffle), el("span", { class: "gr-label" }, "Stock")),
    el("div", { class: "gr-col" }, pile, el("span", { class: "gr-label" }, "Discard")),
  );
  const centre = el("div", { class: "gr-centre" }, piles, scoreCard, limitChip, table.busyChip);

  // Your corner: what you can do now, your hand (or your hand laid down), and your deadwood.
  const takeBtn = el("button", { class: "btn small primary", type: "button", id: "gr-take", hidden: true, onclick: () => on.take() });
  const passBtn = el("button", { class: "btn small", type: "button", id: "gr-pass", hidden: true, onclick: () => on.pass() }, "Pass");
  const drawBtn = el("button", { class: "btn small", type: "button", id: "gr-draw", hidden: true, onclick: () => on.draw() }, "Draw from the stock");
  const discardBtn = el("button", { class: "btn small", type: "button", id: "gr-discard", hidden: true, onclick: () => on.discard() });
  const knockLabel = el("span", {});
  const knockNote = el("small", {});
  const knockBtn = el("button", { class: "btn primary gr-knock", type: "button", id: "gr-knock", hidden: true, onclick: () => on.knock() }, knockLabel, knockNote);
  const nextBtn = el("button", { class: "btn primary", type: "button", id: "gr-next", hidden: true, onclick: () => on.next() }, "Next hand");
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "gr-timer", id: "gr-timer", hidden: true, role: "timer", "aria-label": "Time for your move" }, el("span", { class: "bar" }, timerFill), timerText);
  const actionBar = el("div", { class: "gr-bar", id: "gr-bar" }, takeBtn, passBtn, drawBtn, discardBtn, knockBtn, nextBtn, timer);
  const mySpread = table.makeSpread("mine");
  const myCount = el("span", { class: "count mono" }, "0");
  const myDealer = el("span", { class: "gr-dealer", hidden: true }, "Dealer");
  const deadNum = el("strong", { class: "mono" }, "0");
  const deadChip = el("span", { class: "gr-deadwood", id: "gr-deadwood" }, "Deadwood ", deadNum);
  const sortRank = el("button", { class: "gr-sort", type: "button", id: "gr-sort-rank", onclick: () => on.sort("rank") }, "Rank");
  const sortSuit = el("button", { class: "gr-sort", type: "button", id: "gr-sort-suit", onclick: () => on.sort("suit") }, "Suit");
  const sorts = el("span", { class: "gr-sorts", role: "group", "aria-label": "Sort your hand by" }, el("span", { class: "gr-sort-label", "aria-hidden": "true" }, "Sort"), sortRank, sortSuit);
  const myPill = el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, myName), myCount, myDealer);
  const handHint = el("p", { class: table.cls("hand-hint"), id: "gr-hand-hint" });
  const meArea = el("div", { class: table.cls("me", `p-${me}`) }, actionBar, hand, mySpread.node, el("div", { class: "gr-me-row" }, myPill, deadChip, sorts), handHint);
  const tableBox = el("div", { class: table.cls("table"), id: "gr-table" }, el("div", { class: table.cls("opps") }, seat.node), centre, meArea);
  const tableWrap = el("div", { class: table.cls("table-wrap") }, tableBox, flyLayer);

  const known = (slot) => (view().arriving.has(slot) ? null : faceOf(slot));

  // ---------- your hand, grouped into its melds ----------
  const sortKey = (mode) => (mode === "suit" ? (s) => suitOf(faceOf(s)) * 13 + rankOf(faceOf(s)) : (s) => rankOf(faceOf(s)) * 4 + suitOf(faceOf(s)));
  // Your hand in `order` (cards you hold that it lacks go last): melds first
  // (sorted by sortMode, or in your order when null), then the deadwood; cards still in the air last.
  function handGroups(order, sortMode) {
    const slots = view().hands[me];
    order = order.filter((s) => slots.includes(s));
    for (const s of slots) if (!order.includes(s)) order.push(s);
    const ready = order.filter((s) => known(s) !== null);
    const a = arrange(ready, faceOf) ?? { melds: [], deadwood: ready, points: 0 };
    const at = (s) => order.indexOf(s);
    const key = sortMode ? sortKey(sortMode) : null;
    const melds = a.melds.slice().sort((x, y) => (key ? key(x[0]) - key(y[0]) : Math.min(...x.map(at)) - Math.min(...y.map(at))));
    const dead = a.deadwood.slice().sort((x, y) => (key ? key(x) - key(y) : at(x) - at(y)));
    const air = order.filter((s) => known(s) === null);
    return { order, melds, dead: [...dead, ...air], slots: [...melds.flat(), ...dead, ...air], points: a.points };
  }

  // A hand laid down as a spread's groups: melds (the knocker's with lay-offs), then deadwood.
  function spreadGroups(p) {
    const l = view().laid[p];
    const knocker = view().knock?.p === p;
    const sortSlots = (slots) => {
      const faces = slots.map(faceOf);
      return faces.some((f) => f === null) ? slots : sortMeld(faces).map((f) => slots[faces.indexOf(f)]);
    };
    const groups = l.melds.map((x, j) => ({ slots: sortSlots([...x, ...(knocker ? view().layoffs.filter(([, k]) => k === j).map(([s]) => s) : [])]), kind: "meld" }));
    if (l.deadwood.length) groups.push({ slots: l.deadwood.slice().sort((a, b) => sortKey("rank")(a) - sortKey("rank")(b)), kind: "dead" });
    return groups;
  }
  const laidOff = (slot) => view().layoffs.some(([s]) => s === slot);

  // ---------- drawing ----------
  // Your hand: g (handGroups()) with the card picked to discard, or laid down (g null).
  // choosing: you are to discard; taken: the card just taken from the pile; after: your best knock (bestKnock()).
  function drawHand(g, { choosing, taken, selected, after, sortMode, dealing } = {}) {
    const laid = !!view().laid[me];
    hand.hidden = laid;
    mySpread.node.hidden = !laid;
    sorts.hidden = laid;
    myCount.textContent = String(view().hands[me].length);
    if (laid) {
      mySpread.render(spreadGroups(me), { face: known, arriving: view().arriving, look: (s) => ({ classes: { layoff: laidOff(s), [`p-${them}`]: laidOff(s) } }) });
      deadChip.hidden = view().tally[me] === null && !deadNum.dataset.counting;
      if (!deadNum.dataset.counting && view().tally[me] !== null) deadNum.textContent = String(view().tally[me]);
      deadChip.classList.remove("low");
      return;
    }
    table.renderHand(g.slots, {
      face: known,
      arriving: view().arriving,
      groups: g.melds,
      first: selected ?? undefined,
      look: (slot, face) => {
        const meld = g.melds.find((x) => x.includes(slot));
        const isTaken = choosing && slot === taken;
        const where = !meld ? "deadwood" : isRun(meld.map(faceOf)) ? "in a run" : "in a set";
        return {
          lift: slot === selected,
          classes: { chosen: slot === selected, pickable: choosing && !isTaken, taken: isTaken, inmeld: !!meld },
          label: face === null ? "A card, still being dealt" : `${cardWords(face)}, ${where}${isTaken ? ", just taken from the pile" : ""}${slot === selected ? ", picked: press again to discard" : ""}`,
        };
      },
    });
    // A soft click as a card joins a meld (not during the deal).
    const inMelds = new Set(g.melds.flat());
    // Not while the dealt cards' faces are still arriving: those melds were there all along.
    const dealt = view().hands[me].every((s) => faceOf(s) !== null);
    if (!dealt) meldSeen = null;
    if (meldSeen && !dealing && [...inMelds].some((s) => !meldSeen.has(s)) && performance.now() - lastClick > 250) {
      lastClick = performance.now();
      play("meld");
    }
    if (!dealing && dealt) meldSeen = inMelds;
    deadChip.hidden = !view().hands[me].length;
    // With eleven cards, also what is left after the best throw: brass once that is low enough to knock.
    deadNum.textContent = after ? `${g.points} → ${after.points}` : String(g.points);
    deadChip.classList.toggle("low", !!view().limit && (after?.points ?? g.points) <= view().limit);
    sortRank.setAttribute("aria-pressed", String(sortMode === "rank"));
    sortSuit.setAttribute("aria-pressed", String(sortMode === "suit"));
  }

  function drawSeat() {
    const laid = !!view().laid[them];
    seat.fan.hidden = laid;
    oppSpread.node.hidden = !laid;
    if (laid) oppSpread.render(spreadGroups(them), { face: known, arriving: view().arriving, look: (s) => ({ classes: { layoff: laidOff(s), [`p-${me}`]: laidOff(s) } }) });
    const n = view().hands[them].length;
    // All backs, even the cards they took from the pile: as at a real table, you remember those.
    seat.render(laid ? [] : view().hands[them], view().arriving, `${theirName}: ${plural(n, "card")}`);
    seat.countEl.textContent = String(n);
    oppDealer.hidden = view().dealer !== them;
    myDealer.hidden = view().dealer !== me;
    drawTally(them, oppTally);
  }

  function drawTally(p, node) {
    const t = view().tally[p];
    node.hidden = t === null;
    if (t !== null && !node.dataset.counting) node.textContent = `Deadwood ${t}`;
  }

  // The stock, the pile and the knock limit (knockRule: the room's, once known); choice: your real choice now, or null.
  function drawCentre({ choice, knockRule }) {
    table.renderStock(view().stock);
    // The pile is kept squared, as at a real table: only its top card shows, and the one
    // under it only while a new one is in the air.
    const top = view().discard.slice(-2);
    const flying = view().arriving.has(view().discard.at(-1));
    const want = top.map(String);
    if ([...pile.children].map((c) => c.dataset.slot).join() !== want.join()) {
      pile.replaceChildren(
        ...top.map((slot) => {
          const card = cardEl(faceOf(slot));
          card.dataset.slot = slot;
          return card;
        }),
      );
    }
    for (const card of pile.children) {
      const slot = Number(card.dataset.slot);
      const face = known(slot);
      setFace(card, face);
      card.classList.toggle("down", face === null);
      card.style.transform = `rotate(${tilt(slot)}deg)`;
      card.style.opacity = view().arriving.has(slot) ? "0" : "";
      card.style.visibility = slot !== view().discard.at(-1) && !flying ? "hidden" : "";
    }
    const topFace = view().discard.length ? known(view().discard.at(-1)) : null;
    const canTake = (choice === "upcard" || choice === "draw") && topFace !== null;
    pile.disabled = !canTake;
    pile.classList.toggle("armed", canTake);
    pile.classList.toggle("empty", !view().discard.length);
    pile.setAttribute("aria-label", topFace === null ? "Discard pile, empty" : `Discard pile: ${cardWords(topFace)} on top${canTake ? ". Take it" : ""}`);
    stockBtn.disabled = choice !== "draw";
    stockBtn.classList.toggle("armed", choice === "draw");
    limitChip.hidden = view().limit === null || !knockRule || !!view().result;
    limitChip.textContent = view().limit === null ? "" : knockRule === "oklahoma" ? `Knock with ${view().limit} or less this hand` : `Knock with ${view().limit} or less`;
    const over = !!view().result;
    piles.hidden = over;
    scoreCard.hidden = !over;
  }

  // The buttons for your choice now (or null): top is the pile's top face, selected the card picked, kn knockable().
  function drawActions(choice, { top, selected, kn }) {
    takeBtn.hidden = !(choice === "upcard" || (choice === "draw" && top !== null));
    takeBtn.textContent = top === null ? "Take" : `Take the ${cardName(top)}`;
    passBtn.hidden = choice !== "upcard";
    drawBtn.hidden = choice !== "draw";
    discardBtn.hidden = choice !== "discard";
    discardBtn.disabled = selected === null;
    discardBtn.textContent = selected === null ? "Pick a card to discard" : `Discard the ${cardName(faceOf(selected))}`;
    knockBtn.hidden = !kn;
    if (kn) {
      knockLabel.textContent = kn.big ? "Big Gin" : kn.points ? "Knock" : "Gin";
      knockNote.textContent = kn.big ? "all eleven" : `throw ${cardName(faceOf(kn.slot))}${kn.points ? `, ${kn.points} left` : ""}`;
      knockBtn.classList.toggle("gin", !kn.points);
    }
    tableBox.classList.toggle("my-turn", !!choice && choice !== "result");
    handHint.textContent = choice === "discard" ? (selected === null ? "Tap a card twice to discard it · drag to rearrange" : `Tap the ${cardName(faceOf(selected))} again to discard it`) : view()?.laid[me] ? "" : view()?.hands[me].length ? "Drag a card to rearrange your hand" : "";
  }

  // ---------- motion ----------
  function seatRect(p, slot) {
    if (view().laid[p]) return (p === me ? mySpread : oppSpread).rect(slot);
    if (p === me) {
      const btn = slot !== undefined && handCards.get(slot);
      return btn ? rectIn(btn.firstChild) : rectIn(hand);
    }
    return seat.rect(slot);
  }
  const pileRect = () => rectIn(pile);
  const spreadOf = (p) => (p === me ? mySpread : oppSpread);

  // Moves `slot` from the stock to player p's hand.
  async function dealTo(p, slot, g, ms, sound = "deal") {
    const from = table.stockRect();
    view().stock = Math.max(0, view().stock - 1);
    view().hands[p].push(slot);
    view().arriving.add(slot);
    render();
    if (sound) play(sound);
    const face = p === me ? faceOf(slot) : null;
    await fly(face, from, seatRect(p, slot), { ms, turn: face !== null ? "up" : null, g });
    view().arriving.delete(slot);
    if (live(g)) render();
  }

  // A word over a seat: "Pass", "Ready".
  function say(p, text, g) {
    table.bubble(p === me ? actionBar : seat.node, p, text, g, PACE.bubble);
  }

  // A moment over the table: "Knock!", "Gin!", "Undercut!" in the player's colour.
  function moment(text, p, kind, g) {
    // At once (reduced motion, a hidden tab), the score card and the status line say it.
    if (!live(g) || fast()) return;
    const node = el("div", { class: `gr-moment p-${p} ${kind}`, role: "presentation" }, el("span", {}, text));
    flyLayer.append(node);
    const end = () => node.remove();
    node.animate(
      [
        { transform: "translate(-50%, -50%) scale(.4)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1.08)", opacity: 1, offset: 0.2 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.32 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.8 },
        { transform: "translate(-50%, -60%) scale(.96)", opacity: 0 },
      ],
      { duration: PACE.moment * 1.9, easing: easing("out") },
    ).finished.then(end, end);
  }

  // The felt jumps under a knock: the table nudges down and back.
  function thump(g) {
    if (fast() || !live(g)) return;
    tableBox.animate([{ transform: "translateY(0)" }, { transform: "translateY(3px)", offset: 0.25 }, { transform: "translateY(0)" }], { duration: tokenMs("slow"), easing: easing("out") });
  }

  // Sparkles from a rect, in seat p's colour: gin.
  function sparkle(r, p, g, n = 12) {
    if (fast() || !live(g)) return;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    for (let i = 0; i < n; i++) {
      const node = el("span", { class: `gr-fx spark p-${p}` });
      flyLayer.append(node);
      const a = (i / n) * Math.PI * 2;
      const d = Math.max(r.w, r.h) * 0.5 + 24;
      node
        .animate([{ transform: `translate(${cx}px, ${cy}px) scale(.2)`, opacity: 1 }, { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d}px) scale(1)`, opacity: 0 }], { duration: tokenMs("slow") * 2.6, easing: easing("out") })
        .finished.then(() => node.remove(), () => node.remove());
    }
  }

  // A number counting up, a tick for each step (it lands at once with reduced motion).
  async function countUp(node, to, g, text) {
    node.dataset.counting = "1";
    const steps = fast() ? 0 : Math.min(Math.abs(to), 24);
    for (let i = 1; i <= steps && live(g); i++) {
      node.textContent = text(Math.round((to * Math.min(1, i / steps)) || 0));
      play("count", { n: i });
      await wait(PACE.count * table.pace(), g);
    }
    delete node.dataset.counting;
    if (!live(g)) return;
    if (!steps && to) play("count");
    node.textContent = text(to);
  }

  // A hand laid down: its cards fly from the hand (or the fan, turning up) into groups on the table.
  async function layDown(p, melds, deadwood, g, k) {
    const all = [...melds.flat(), ...deadwood];
    const from = new Map(all.map((s) => [s, seatRect(p, s)]));
    view().laid[p] = { melds: melds.map((x) => x.slice()), deadwood: deadwood.slice() };
    for (const s of all) view().arriving.add(s);
    render();
    play("draw", { offset: -2 });
    const order = spreadGroups(p).flatMap((x) => x.slots);
    await Promise.all(
      order.map((s, i) =>
        wait(i * 45 * k, g).then(async () => {
          await fly(faceOf(s), from.get(s), spreadOf(p).rect(s), { ms: PACE.lay * k, turn: p === me ? null : "up", g });
          view().arriving.delete(s);
          if (live(g)) render();
        }),
      ),
    );
    if (live(g) && melds.length) play("meld");
  }

  // p's lay-offs fly one at a time onto the knocker's melds; false if the table moved on meanwhile.
  async function layOffs(p, layoffs, g, k) {
    const knocker = view().knock.p;
    for (const [i, [s, j]] of layoffs.entries()) {
      await wait(PACE.between * k, g);
      const from = spreadOf(p).rect(s);
      view().laid[p].deadwood = view().laid[p].deadwood.filter((x) => x !== s);
      view().layoffs.push([s, j]);
      view().arriving.add(s);
      render();
      play("layoff", { n: i });
      await fly(faceOf(s), from, spreadOf(knocker).rect(s), { ms: PACE.layoff * k, g });
      view().arriving.delete(s);
      if (!live(g)) return false;
      render();
    }
    return true;
  }

  // The end of a hand: what it was, the deadwood against each other, and the points
  // into the score (totals(scores) words them); false if the table moved on meanwhile.
  async function scoreHand(ev, g, k, totals) {
    view().result = { ...ev };
    scoreCard.className = `gr-score ${ev.kind} ${ev.winner >= 0 ? `p-${ev.winner}` : ""}`;
    scoreTitle.textContent = ev.kind === "knock" ? `${nameOf(view().knock.p)} ${verb(view().knock.p, "knocks")}` : ev.kind === "draw" ? "A drawn hand" : KIND[ev.kind];
    scoreSum.textContent = scoreLine(ev);
    scorePoints.textContent = "";
    scoreTotals.textContent = "";
    render();
    if (ev.kind === "undercut") {
      play("undercut");
      moment("Undercut!", ev.winner, "undercut", g);
      const knockerSpread = spreadOf(view().knock.p).node;
      if (!fast()) knockerSpread.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }], { duration: tokenMs("slow") * 1.6, easing: easing("out") });
    } else if (ev.kind === "draw") play("nope");
    if (!scoreCard.hidden && !fast()) scoreCard.animate([{ transform: "scale(.85)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: tokenMs("slow"), easing: easing("spring") });
    if (ev.winner >= 0) {
      await countUp(scorePoints, ev.points, g, (n) => `+${n} for ${ev.winner === me ? "you" : nameOf(ev.winner)}`);
      if (!live(g)) return false;
    } else scorePoints.textContent = "No points";
    view().scores = ev.scores.slice();
    scoreTotals.textContent = totals(ev.scores);
    render();
    return true;
  }

  // "Bo 6 against your 23" and the like.
  function scoreLine(ev) {
    if (ev.kind === "draw") return "Only two cards left in the stock and nobody knocked.";
    const kn = view().knock.p;
    const df = 1 - kn;
    const t = view().tally;
    const dk = t[kn] ?? 0;
    const dd = t[df] ?? 0;
    const whose = (p, n) => (p === me ? `your ${n}` : `${nameOf(p)}'s ${n}`);
    if (ev.kind === "gin" || ev.kind === "big") return `${ev.kind === "big" ? BIG_GIN_BONUS : GIN_BONUS} for gin + ${whose(df, dd)} deadwood`;
    if (ev.kind === "undercut") return `${whose(df, dd)} against ${whose(kn, dk)}: the difference + ${UNDERCUT_BONUS}`;
    return `${whose(df, dd).replace(/^\w/, (c) => c.toUpperCase())} against ${whose(kn, dk)}`;
  }

  return {
    seat,
    oppSpread,
    oppTally,
    stockBtn,
    pile,
    actionBar,
    knockBtn,
    nextBtn,
    timer,
    timerFill,
    timerText,
    mySpread,
    deadNum,
    deadChip,
    meArea,
    tableBox,
    tableWrap,
    nameOf,
    verb,
    handGroups,
    spreadGroups,
    drawHand,
    drawSeat,
    drawCentre,
    drawActions,
    // The hand was dealt or set out afresh: no click for the melds it already has.
    forgetMelds: () => (meldSeen = null),
    seatRect,
    pileRect,
    spreadOf,
    dealTo,
    say,
    moment,
    thump,
    sparkle,
    countUp,
    layDown,
    layOffs,
    scoreHand,
  };
}
