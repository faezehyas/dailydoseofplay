// Quick reactions between players: a React button in the player bar opens a
// tray of preset emoji and phrases, and a reaction shows as a bubble by the
// sender's name for about 3 s, with a soft pop. There is no free text, so
// nothing to moderate: peers send only an index into the fixed list
// ($react {i}, see session.js), and an index nobody knows is ignored. Each
// seat may react once every GAP_MS, checked when sending and when receiving.
// "Mute reactions" (the settings panel's General tab, prefs.js) hides other
// players' bubbles on this device.
//
// Robots banter through the same message (robotBanter() below), and a game
// may add a few lines of its own for them (setGameLines()), numbered after
// the fixed ones.
import { el } from "./shell.js";
import { getPrefs } from "./prefs.js";
import { defineSounds } from "./sound.js";
import { tone } from "./synth.js";

const EMOJI = ["👋", "😄", "😮", "😅", "🤔", "🔥", "👏", "😢"];
const PHRASES = ["Good luck!", "Nice move!", "Oops!", "Hmm…", "Your turn!", "So close!", "Good game!", "Rematch?"];
export const REACTIONS = [...EMOJI, ...PHRASES];
export const GAP_MS = 2000;
const SHOW_MS = 3000;
const OUT_MS = 200; // the bubble fades for the last --dur-med of SHOW_MS

// The game's own robot lines by event ({ strongMove, lead, end }), flattened
// so every tab numbers them the same.
let gameLines = [];
export function setGameLines(lines = {}) {
  gameLines = Object.entries(lines).flatMap(([event, list]) => list.map((text) => ({ event, text })));
}

const reactionText = (i) => (Number.isInteger(i) ? (REACTIONS[i] ?? gameLines[i - REACTIONS.length]?.text ?? null) : null);

export const sounds = defineSounds({
  pop: { role: "ui", offset: -4, trim: 5.1, synth: (a, o, t) => tone(a, o, t, { freq: 520, to: 880, dur: 0.09, gain: 0.12 }) },
});

// Sends and receives reactions over a session, with the checks: a known
// index, and at most one per seat every GAP_MS. No DOM.
export function reactionLink(session, now = () => Date.now()) {
  const last = [];
  const allow = (seat, i) => {
    if (reactionText(i) === null || now() - (last[seat] ?? -Infinity) < GAP_MS) return false;
    last[seat] = now();
    return true;
  };
  return {
    send(i) {
      if (session.ended || !allow(session.index, i)) return false;
      session.send({ t: "$react", i });
      return true;
    },
    // fn(seat, text) for each reaction someone else sent that passes.
    onReaction(fn) {
      return session.on("react", (seat, i) => allow(seat, i) && fn(seat, reactionText(i)));
    },
  };
}

// The React button, its tray and the bubbles, for players.js. pillOf(seat)
// is the pill a bubble shows by.
export function reactionControls(session, pillOf) {
  const link = reactionLink(session);
  const live = el("span", { class: "sr-only", "aria-live": "polite" });
  // --i staggers the items as the tray opens.
  const items = REACTIONS.map((text, i) =>
    el("button", { class: i < EMOJI.length ? "rx-emoji" : "rx-phrase", type: "button", tabindex: "-1", style: `--i: ${i}`, onclick: () => send(i) }, text),
  );
  const tray = el(
    "div",
    { class: "rx-tray", id: "reactions", role: "group", "aria-label": "Reactions", hidden: true, onkeydown },
    el("div", { class: "rx-emojis" }, items.slice(0, EMOJI.length)),
    el("div", { class: "rx-phrases" }, items.slice(EMOJI.length)),
  );
  const button = el("button", { class: "pb-react", type: "button", id: "react", title: "React", "aria-label": "React", "aria-expanded": "false", "aria-controls": "reactions", onclick: () => (tray.hidden ? open() : close()) });
  button.insertAdjacentHTML("afterbegin", REACT_ICON);

  let focused = 0;
  function focusItem(k) {
    items[focused].tabIndex = -1;
    focused = (k + items.length) % items.length;
    items[focused].tabIndex = 0;
    items[focused].focus();
  }
  function open() {
    tray.hidden = false;
    button.setAttribute("aria-expanded", "true");
    focusItem(0);
    document.addEventListener("pointerdown", outside, true);
  }
  function close(refocus = true) {
    if (tray.hidden) return;
    tray.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (refocus) button.focus();
  }
  function outside(e) {
    if (!tray.contains(e.target) && !button.contains(e.target)) close(false);
  }
  function onkeydown(e) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) focusItem(items.indexOf(document.activeElement) + step);
    else if (e.key === "Home") focusItem(0);
    else if (e.key === "End") focusItem(items.length - 1);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
  }
  function send(i) {
    close();
    if (link.send(i)) show(session.index, reactionText(i));
  }

  const timers = new Map();
  function show(seat, text) {
    if (seat !== session.index && getPrefs().muteReactions) return;
    const pill = pillOf(seat);
    pill.querySelector(".rx-bubble")?.remove();
    clearTimeout(timers.get(seat));
    const bubble = el("span", { class: `rx-bubble ${EMOJI.includes(text) ? "emoji" : ""}`, "aria-hidden": "true" }, text);
    pill.append(bubble);
    timers.set(
      seat,
      setTimeout(() => {
        bubble.classList.add("out");
        timers.set(seat, setTimeout(() => bubble.remove(), OUT_MS));
      }, SHOW_MS - OUT_MS),
    );
    live.textContent = `${seat === session.index ? "You" : session.players[seat].name}: ${text}`;
    sounds.play("pop");
  }
  link.onReaction(show);

  return { button, tray, live };
}

// A smiling face, so React reads as a reaction at a glance.
const REACT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M8 13.5a4.5 4.5 0 0 0 8 0"/><circle class="eye" cx="9" cy="9.5" r="1.3"/><circle class="eye" cx="15" cy="9.5" r="1.3"/></svg>';

// ---------- robot banter ----------
//
// The lobby calls robotBanter() for every robot seat. The robot reacts after
// a strong move of the player's (seat 0), when it takes the lead, and at the
// end, at most one line every EVERY turns (the end line always comes).
// banter, from the game (all optional):
//   score(state, seat)  how well a seat is doing; without it the robot only
//                       speaks at the end
//   strong              how far a move of the player's must drop the
//                       robot's lead to count as strong (default 1)
//   lines               { strongMove, lead, end }: a few lines of the game's
//                       own, said at those moments besides the fixed ones
const EVERY = 4;
const SAYS = {
  strongMove: ["😮", "👏", "Nice move!", "Oops!"],
  lead: ["😄", "🔥"],
  end: ["Good game!"],
};

export function robotBanter(session, robot, { score, strong = 1 } = {}, rng = Math.random) {
  const link = reactionLink(session);
  const me = session.index;
  let turns = 0;
  let endTimer = null;
  function say(event) {
    const own = gameLines.flatMap((line, k) => (line.event === event ? [REACTIONS.length + k] : []));
    const choices = [...SAYS[event].map((text) => REACTIONS.indexOf(text)), ...own];
    if (link.send(choices[Math.floor(rng() * choices.length)])) turns = 0;
  }
  const lead = (state) => score(state, me) - Math.max(...session.others.map((p) => score(state, p.seat)));

  function watch(match) {
    let turn = null;
    let before = null;
    match.on("update", () => {
      const state = match.state;
      if (!state || state.winner !== -1 || state.turn === turn) return;
      const mover = turn;
      turn = state.turn;
      turns++;
      if (!score) return;
      const now = lead(state);
      const was = before;
      before = now;
      if (was === null || turns < EVERY) return;
      if (mover === 0 && was - now >= strong) say("strongMove");
      else if (was <= 0 && now > 0) say("lead");
    });
    // After the last move, once the gap since the robot's last line allows.
    match.on("over", () => {
      clearTimeout(endTimer);
      endTimer = setTimeout(() => say("end"), GAP_MS);
    });
  }
  if (!robot?.match) return;
  watch(robot.match);
  session.on("rematch-start", () => watch(robot.match));
  session.on("end", () => clearTimeout(endTimer));
}
