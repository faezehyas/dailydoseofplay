// Backgammon's motion and drag, shared by the game (main.js) and its tutorial
// (tutorial.js). Checkers in the air are copies ("ghosts") that fly over the
// board; the real checker waits hidden where it lands. The game's state
// never waits.
import { el } from "../engine/shell.js";
import { BAR, OFF } from "./rules.js";
import { play } from "./sounds.js";
import { theirKey } from "./art.js";

const FLY = { min: 240, perPx: 0.9, max: 620 }; // a checker's flight time, by distance
export const MY_PACE = 0.7; // your own checkers fly faster than the replayed ones
export const DROP_PACE = 0.45; // a dropped checker settles from where it was let go

// board and cells as boardCells() made them; render() redraws the board,
// leaving the checkers counted in `hidden` invisible; gone() is true once
// the view is torn down.
export function motion(board, cells, { still, render, gone = () => false }) {
  const hidden = new Map(); // cell key -> checkers still in the air, hidden at the top of that cell
  let flying = 0;

  function hide(key, by) {
    const n = (hidden.get(key) || 0) + by;
    if (n > 0) hidden.set(key, n);
    else hidden.delete(key);
  }

  // Where the top checker (or slab) of a cell is drawn, relative to the board.
  function topRect(key) {
    const items = cells.get(key).querySelectorAll(".checker, .slab");
    const node = items[items.length - 1];
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    return { x: r.left - b.left - board.clientLeft, y: r.top - b.top - board.clientTop, w: r.width, h: r.height };
  }

  function ghost(whose, at) {
    const node = el("span", { class: `checker ${whose} ghost`, "aria-hidden": "true" });
    Object.assign(node.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, height: `${at.h}px` });
    board.append(node);
    return node;
  }

  // Lifts a checker, carries it along a low arc and sets it down (squashed
  // into a slab when it lands in a tray). Resolves once it has landed.
  function fly(whose, from, to, pace = 1, node = null) {
    if (!from || !to || still || gone()) {
      node?.remove();
      return Promise.resolve();
    }
    node ??= ghost(whose, from);
    flying++;
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    const dist = Math.hypot(dx, dy);
    const lift = Math.min(22, 6 + dist * 0.06);
    const frames = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const grow = 1 + 0.16 * Math.sin(Math.PI * t);
      const sx = grow * (1 + t * (to.w / from.w - 1));
      const sy = grow * (1 + t * (to.h / from.h - 1));
      frames.push({ transform: `translate(${dx * t}px, ${dy * t - 4 * lift * t * (1 - t)}px) scale(${sx}, ${sy})` });
    }
    const ms = Math.min(FLY.max, FLY.min + dist * FLY.perPx) * pace;
    return node
      .animate(frames, { duration: ms, easing: "cubic-bezier(.45, 0, .25, 1)", fill: "forwards" })
      .finished.catch(() => {})
      .finally(() => {
        node.remove();
        flying--;
      });
  }

  // Plays one step of `whose` ("mine" or "theirs") on the board shown.
  // `apply()` moves the checker in the position being drawn and returns
  // { hit }; a copy flies to where it lands, then a checker it hit flies to the bar.
  async function moveOnScreen(whose, from, to, apply, pace, drop = {}) {
    const key = (n) => (whose === "mine" ? n : theirKey(n));
    const barKey = whose === "mine" ? "bar-top" : BAR;
    const start = drop.start ?? topRect(key(from));
    const under = topRect(key(to));
    const done = apply();
    hide(key(to), 1);
    if (done.hit) hide(barKey, 1);
    render();
    const knocked = done.hit && under && !still ? ghost(whose === "mine" ? "theirs" : "mine", under) : null;
    await fly(whose, start, topRect(key(to)), pace, drop.node);
    hide(key(to), -1);
    render();
    play(to === OFF ? "off" : done.hit ? "hit" : "place");
    if (!done.hit) return;
    await fly(null, under, topRect(barKey), pace, knocked);
    hide(barKey, -1);
    render();
    play("bar");
  }

  // Takes back your step `last` ({ from, to, hit }): `apply()` puts the
  // position being drawn back, then the checker, and any checker it hit,
  // flies home.
  function takeBack(last, apply) {
    const start = topRect(last.to);
    const blot = last.hit ? topRect("bar-top") : null;
    apply();
    hide(last.from, 1);
    if (last.hit) hide(last.to, 1);
    render();
    const back = (whose, from, key) =>
      fly(whose, from, topRect(key), MY_PACE).then(() => {
        hide(key, -1);
        render();
        play("bar");
      });
    back("mine", start, last.from);
    if (last.hit) back("theirs", blot, last.to);
  }

  // Drag a checker with a mouse or finger; a press that doesn't move is a tap.
  // steps() lists the legal steps, tap(n) takes a tap on cell n, lift(from)
  // picks the checker lifted, drop(step, { start, node }) plays it. A drop
  // anywhere else flies back, still picked, unless miss(from, to) takes a
  // drop on another point.
  function drags({ steps, ready = () => true, tap, lift, drop, miss }) {
    let drag = null;
    let dragged = false;
    const cellAt = (x, y) => {
      const cell = document.elementFromPoint(x, y)?.closest("button[data-n]");
      return cell && board.contains(cell) ? Number(cell.dataset.n) : null;
    };
    board.addEventListener("click", (e) => {
      const cell = e.target.closest("button[data-n]");
      if (cell && !dragged) tap(Number(cell.dataset.n));
      dragged = false;
    });
    board.addEventListener("pointerdown", (e) => {
      dragged = false;
      const cell = e.target.closest("button[data-n]");
      if (!cell || e.button !== 0 || drag || !ready()) return;
      const from = Number(cell.dataset.n);
      if (!steps().some((s) => s.from === from)) return;
      drag = { from, id: e.pointerId, x: e.clientX, y: e.clientY, node: null, over: null };
      listen(true);
    });
    // The page follows the pointer only while a checker is pressed.
    function listen(on) {
      const set = on ? addEventListener : removeEventListener;
      set("pointermove", onPointerMove);
      set("pointerup", endDrag);
      set("pointercancel", endDrag);
    }
    function letGo() {
      drag = null;
      listen(false);
    }
    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.node) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        const at = topRect(drag.from);
        if (!at || !steps().some((s) => s.from === drag.from)) return letGo();
        drag.size = at;
        drag.node = ghost("mine", at);
        drag.node.classList.add("held");
        hide(drag.from, 1);
        lift(drag.from);
      }
      const b = board.getBoundingClientRect();
      const x = e.clientX - b.left - board.clientLeft - drag.size.w / 2;
      const y = e.clientY - b.top - board.clientTop - drag.size.h / 2;
      Object.assign(drag.node.style, { left: `${x}px`, top: `${y}px` });
      const over = cellAt(e.clientX, e.clientY);
      if (over !== drag.over) {
        cells.get(drag.over)?.classList.remove("over");
        drag.over = over;
        if (steps().some((s) => s.from === drag.from && s.to === over)) cells.get(over).classList.add("over");
      }
    }
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const { from, node, over } = drag;
      letGo();
      if (!node) return;
      dragged = true;
      cells.get(over)?.classList.remove("over");
      const to = e.type === "pointerup" ? cellAt(e.clientX, e.clientY) : null;
      const there = steps()
        .filter((s) => s.from === from && s.to === to)
        .sort((a, b) => a.die - b.die);
      const b = board.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      const at = { x: r.left - b.left - board.clientLeft, y: r.top - b.top - board.clientTop, w: r.width, h: r.height };
      node.classList.remove("held");
      if (there.length) {
        hide(from, -1);
        return drop(there[0], { start: at, node });
      }
      if (miss && to !== null && to !== from) {
        node.remove();
        hide(from, -1);
        return miss(from, to);
      }
      // Not a legal point: back where it came from, still picked.
      fly("mine", at, topRect(from), 0.6, node).then(() => {
        hide(from, -1);
        render();
      });
    }
    return {
      active: () => !!drag,
      // The cell whose checker is in the hand, if any.
      held: () => (drag?.node ? drag.from : null),
      stop: letGo,
    };
  }

  return {
    hidden,
    get flying() {
      return flying;
    },
    hide,
    topRect,
    ghost,
    fly,
    moveOnScreen,
    takeBack,
    drags,
  };
}
