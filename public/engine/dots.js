// The logo's four dots as a loader. They wait apart, drifting, and come home
// as real steps finish; with all four home they make the logo: its coral
// square appears behind them and a ring of small dots bursts out once. The
// lobby uses them while connecting and while waiting for friends (see
// **Loading in the lobby** in ARCHITECTURE.md).
//
//   dotsLoader({ words, help, shown, onStage }) -> { node, lit(dots), done(), stop(), shown }
//
// Every wait keeps one clock: nothing for SHOW ms (most waits end there), then
// the dots, the caller's `words` element from WORDS ms and its `help` element
// from HELP ms, until done. `shown` starts with the dots in view, for a screen
// that carries on from one that showed them; onStage(stage) hears each stage.
// lit(n) brings the first n dots home, lit([i, …]) those dots (0 is top left,
// then clockwise); done() brings all four home and resolves once the burst
// has played, at once if the dots never showed. The dots are aria-hidden: the
// words say what is happening. Their look and motion live in theme.css; with
// reduced motion they stand still.
import { el } from "./shell.js";

export const SHOW = 300;
export const WORDS = 2000;
export const HELP = 10000;
// How long the full logo and its burst stay before the screen moves on.
export const DONE = 1000;

const STAGES = ["none", "dots", "words", "help"];
const AT = { dots: SHOW, words: WORDS, help: HELP };

// The dots that come home for the seats taken (one boolean per seat): two
// each at a table for two, one each at a table for four; at three the host's
// seat brings two.
export function seatDots(taken) {
  const dots = taken.length === 2 ? [[0, 2], [1, 3]] : taken.length === 3 ? [[0, 2], [1], [3]] : [[0], [1], [2], [3]];
  return taken.flatMap((t, k) => (t ? dots[k] : []));
}

// The loader's clock and dots without the page: render(state) runs at the
// start and on every change, with state = { stage, on: [4 booleans], done }.
export function dotsClock(render, { help = false, shown = false } = {}) {
  const state = { stage: shown ? "dots" : "none", on: [false, false, false, false], done: false };
  const reach = (stage) => {
    if (STAGES.indexOf(stage) <= STAGES.indexOf(state.stage)) return;
    state.stage = stage;
    render(state);
  };
  const timers = ["dots", "words", ...(help ? ["help"] : [])].map((stage) => setTimeout(() => reach(stage), AT[stage]));
  render(state);
  return {
    state,
    lit(dots) {
      state.on = state.on.map((_, i) => (typeof dots === "number" ? i < dots : dots.includes(i)));
      state.done = false;
      render(state);
    },
    done() {
      state.on = state.on.map(() => true);
      state.done = true;
      render(state);
      const wait = state.stage === "none" ? 0 : DONE;
      return new Promise((resolve) => (wait ? setTimeout(resolve, wait) : resolve()));
    },
    stop: () => timers.forEach(clearTimeout),
  };
}

export function dotsLoader({ words, help, shown, onStage } = {}) {
  const dots = [0, 1, 2, 3].map((i) => el("i", { class: `dot d${i}`, style: `--i: ${i}` }, el("b")));
  const cue = el(
    "div",
    { class: "dots-cue", "aria-hidden": "true" },
    el("span", { class: "dots-square" }),
    el("span", { class: "dots" }, dots),
    el("span", { class: "dots-burst" }, Array.from({ length: 8 }, (_, k) => el("i", { style: `--a: ${k * 45}deg` }))),
  );
  words?.classList.add("dots-words");
  help?.classList.add("dots-help");
  const node = el("div", { class: "dots-wait" }, cue, words, help);
  const clock = dotsClock(
    ({ stage, on, done }) => {
      if (node.dataset.stage !== stage) {
        node.dataset.stage = stage;
        onStage?.(stage);
      }
      node.toggleAttribute("data-done", done);
      dots.forEach((dot, i) => dot.classList.toggle("on", on[i]));
    },
    { help: !!help, shown },
  );
  return {
    node,
    lit: clock.lit,
    done: clock.done,
    stop: clock.stop,
    get shown() {
      return clock.state.stage !== "none";
    },
  };
}
