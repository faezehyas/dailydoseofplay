// The player bar every game shows above its board: a pill per player (you
// first, then the others in seat order; "(robot)" after a player a robot
// took over from) with an optional badge and note, a
// ring on whoever's turn it is, three dots in a robot's pill while its move
// takes a moment, a tick once a player's shuffle is checked, the wins so far
// (and draws, for games that have them), and React (reactions.js) and Leave, always at the top right. Colours come from --seat and --seat-text: .mine and .theirs by
// default, or a game's own class per seat (see "player bar" in theme.css).
import { el } from "./shell.js";
import { reactionControls } from "./reactions.js";

// An arrow out of a door, so Leave reads as a way out at a glance.
const LEAVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/></svg>';
const TICK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
export const THINK_AFTER = 300; // ms a robot's move takes before its pill shows the dots

// Three dots that bounce in turn: a wait, in a robot's pill or beside the deck's work.
export const thinkingDots = () => el("span", { class: "think", "aria-hidden": "true" }, el("i"), el("i"), el("i"));

// show(seat) once `seat` has been thinking for `ms`, show(-1) when it stops;
// returns set(seat), called with the seat that thinks now, or -1.
export function thinkingDelay(show, ms = THINK_AFTER) {
  let seat = -1;
  let timer = null;
  let shown = false;
  return (next) => {
    if (next === seat) return;
    clearTimeout(timer);
    if (shown) show(-1);
    shown = false;
    seat = next;
    if (next !== -1)
      timer = setTimeout(() => {
        shown = true;
        show(next);
      }, ms);
  };
}

export function playerBar(session, { onLeave, classes = () => "" }) {
  const me = session.index;
  const order = [me, ...session.others.map((p) => p.seat)];
  const cls = (seat) => `${seat === me ? "mine" : "theirs"} ${classes(seat)}`;
  const label = (seat) => (seat === me ? "You" : session.players[seat].name);
  const robot = (seat) => seat !== me && (session.mode === "robot" || !!session.players[seat]?.robot);

  const pills = order.map((seat) => {
    const name = seat === me ? `${session.me.name} (you)` : label(seat);
    const badge = el("span", { class: "pb-badge" });
    const note = el("small", { class: "pb-note" });
    const nameEl = el("span", { class: "pb-name", title: name }, name);
    const tick = el("span", { class: "pb-tick", hidden: true });
    tick.innerHTML = TICK_ICON;
    const node = el("span", { class: `pb-who ${cls(seat)} ${robot(seat) ? "pb-robot" : ""}` }, badge, el("span", { class: "pb-label" }, nameEl, note), tick, thinkingDots());
    return { seat, node, badge, note, nameEl, tick };
  });
  const think = thinkingDelay((seat) => pills.forEach((p) => p.node.classList.toggle("thinking", p.seat === seat)));
  session.on("takeover", (seat) => {
    const { node, nameEl } = pills.find((p) => p.seat === seat);
    nameEl.textContent = nameEl.title = `${label(seat)} (robot)`;
    node.classList.add("pb-robot");
  });
  const box = (c, text) => {
    const dd = el("dd");
    return { node: el("div", { class: c }, el("dt", { title: text }, text), dd), dd };
  };
  const wins = order.map((seat) => box(cls(seat), label(seat)));
  const draws = box("draws", "Draws");
  const duel = order.length === 2;
  const players = el("div", { class: "pb-players" }, duel ? [pills[0].node, el("span", { class: "pb-vs" }, "vs"), pills[1].node] : pills.map((p) => p.node));
  const leave = el("button", { class: "btn small pb-leave", type: "button", id: "leave", title: "Leave", onclick: onLeave }, el("span", { class: "pb-leave-label" }, "Leave"));
  leave.insertAdjacentHTML("afterbegin", LEAVE_ICON);
  const react = reactionControls(session, (seat) => pills.find((p) => p.seat === seat).node);
  const scoreBox = el("dl", { class: "pb-score", id: "score", "aria-label": "Score" }, wins.map((w) => w.node));
  const node = el("div", { class: `player-bar ${duel ? "" : "many"}` }, el("div", { class: "pb-top" }, players, el("div", { class: "pb-actions" }, react.button, leave)), react.tray, scoreBox, react.live);

  // A slot shows a node of the game's (kept as is when it is already there) or text.
  const put = (slot, v) => {
    if (v instanceof Node ? slot.firstChild !== v : slot.textContent !== String(v ?? "")) slot.replaceChildren(v ?? "");
  };

  // Every field is optional and indexed by seat: turn (-1 for nobody),
  // score { wins: [...], draws } (no draws field, no Draws box), badges and notes.
  // thinking: the robot whose move is awaited, or -1; without it, the turn
  // if a robot has it. Its dots wait THINK_AFTER ms. checked: the seats whose
  // shuffle is checked, each with a tick.
  function update({ turn, score, badges, notes, thinking, checked }) {
    for (const p of pills) {
      if (turn !== undefined) p.node.classList.toggle("active", p.seat === turn);
      if (badges) put(p.badge, badges[p.seat]);
      if (notes) put(p.note, notes[p.seat]);
      if (checked) p.tick.hidden = !checked.includes(p.seat);
    }
    if (thinking === undefined && turn !== undefined) thinking = robot(turn) ? turn : -1;
    if (thinking !== undefined) think(thinking);
    if (!score) return;
    for (const [k, seat] of order.entries()) put(wins[k].dd, score.wins[seat]);
    if (typeof score.draws !== "number") return draws.node.remove();
    if (!draws.node.isConnected) wins[0].node.after(draws.node);
    put(draws.dd, score.draws);
  }

  return { node, update };
}
