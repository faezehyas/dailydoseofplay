// Interactive tutorials: a game's short lessons, played on its own board.
// Each step says what to do, lights up squares (with arrows where they
// help) and waits for the learner's move, which the game's rules.js checks.
// A right move gets a check mark and a soft chime; a wrong one springs back,
// and after the second wrong try the squares of the right move light up.
// No server, no timer, no score. Finished lessons get a tick, kept on this
// device only.
//
//   startTutorial({ root, slug, title, tutorial, onPlayRobot, onClose }) -> { destroy }
//
// tutorial is the game's tutorial.js module:
//   lessons                  [{ title, steps: [{ text, position, highlight, arrows, expect, reply }] }]
//                            (lessons.js). A step without a position goes on from the last one.
//                            expect is a move or a list of accepted moves; a move matches when it
//                            has every field of one of them (a list field, such as a path, holds
//                            the same items in order, lists in it too). reply is a move played back.
//   flavour                  the timbre of its chimes (chimes.js)
//   load(position)           a rules state for a position; its side to move is the learner
//   play(state, move, step)  applies a move for the side to move with rules.js, or throws RuleError;
//                            what it returns (the rules' events) goes to render
//   cells(move)              the cells a move uses, lit up by the hint
//   board()                  the game's board view: { node, render(state, played), onMove(fn), cell(c), reject(move) }
//                            render gets `played`, what play returned, for the move that just
//                            landed (the learner's or the reply), and may animate it as the game
//                            does, returning a promise that settles once it has landed; the check
//                            mark, the chime and the next step wait for it. cell(c) is the element
//                            of cell c; reject(move) springs a wrong move back.
// highlight is a list of cells, arrows a list of [from, to] cells.
import { el } from "./shell.js";
import { RuleError } from "./turn-match.js";
import { sounds, chime } from "./chimes.js";
import { celebrate, calm } from "./celebrate.js";

const KEY = "ddp-lessons";
const RIGHT_MS = 650; // the check mark shows before the reply or the next step
const REPLY_MS = 550;
const NS = "http://www.w3.org/2000/svg";
const NUMBERS = ["", "One", "Two", "Three", "Four", "Five", "Six"];

// Finished lessons by game: { "<slug>": [lesson index, …] }.
function loadDone() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY));
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}
function saveDone(slug, index) {
  const all = loadDone();
  const done = new Set(Array.isArray(all[slug]) ? all[slug] : []);
  done.add(index);
  all[slug] = [...done].sort((a, b) => a - b);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
const doneIn = (slug) => new Set(loadDone()[slug] ?? []);

const same = (a, b) => (Array.isArray(b) ? Array.isArray(a) && a.length === b.length && a.every((x, i) => same(x, b[i])) : a === b);
const matches = (move, want) => Object.keys(want).every((k) => same(move?.[k], want[k]));
const expected = (step) => [].concat(step.expect);

export function startTutorial({ root, slug, title, tutorial, onPlayRobot, onClose }) {
  const { lessons, flavour } = tutorial;
  const view = tutorial.board();
  const timers = new Set();
  let lesson = -1;
  let stepIndex = 0;
  let state = null;
  let tries = 0;
  let busy = false;
  let run = 0; // bumps whenever the lesson moves on

  const later = (fn, ms) => {
    const t = setTimeout(() => (timers.delete(t), fn()), ms);
    timers.add(t);
  };
  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    run += 1;
  };
  // Runs fn once the board has shown a move (render's promise, if any),
  // unless the lesson has moved on meanwhile.
  const landed = (shown, fn) => {
    const at = run;
    Promise.resolve(shown).then(() => at === run && fn());
  };

  // ---------- the lesson's pieces ----------
  const heading = el("h1", { tabindex: "-1" });
  const count = el("span", { class: "tut-count mono" });
  const dots = el("span", { class: "tut-dots", "aria-hidden": "true" });
  const stepCount = el("span", { class: "tut-step mono" });
  const text = el("p", { class: "tut-text", id: "tut-text", role: "status" });
  const arrows = document.createElementNS(NS, "svg");
  arrows.setAttribute("class", "tut-arrows");
  arrows.setAttribute("aria-hidden", "true");
  const check = el("span", { class: "tut-check", "aria-hidden": "true", hidden: true });
  check.innerHTML = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="19"/><path d="M11 21l6 6 12-13"/></svg>';
  const stage = el("div", { class: "tut-stage" }, view.node, arrows, check);
  const feedback = el("p", { class: "tut-feedback", id: "tut-feedback", "aria-live": "polite" });
  const next = el("div", { class: "tut-next", hidden: true });
  const lessonView = el(
    "div",
    { class: "tutorial tut-lesson-view" },
    el(
      "div",
      { class: "tut-top" },
      el("button", { class: "btn ghost small", type: "button", id: "tut-lessons", onclick: () => showList() }, "All lessons"),
      count,
    ),
    heading,
    el("p", { class: "tut-progress" }, dots, stepCount),
    text,
    stage,
    feedback,
    next,
  );
  view.onMove(onMove);
  const resize = new ResizeObserver(() => lesson >= 0 && drawArrows());
  resize.observe(stage);

  // ---------- screens ----------
  function show(node, focus) {
    calm();
    root.replaceChildren(node);
    focus.focus();
  }

  function showList() {
    clearTimers();
    lesson = -1;
    const done = doneIn(slug);
    const h1 = el("h1", { tabindex: "-1" }, `Learn ${title}`);
    show(
      el(
        "div",
        { class: "card tutorial tut-list" },
        h1,
        el("p", { class: "tagline" }, `${NUMBERS[lessons.length] ?? lessons.length} short lessons on the real board. Make each move to learn the rule.`),
        el(
          "ol",
          { class: "tut-lessons", id: "tut-lessons-list" },
          lessons.map((l, i) =>
            el(
              "li",
              {},
              el(
                "button",
                { class: "tut-lesson", type: "button", dataset: { done: String(done.has(i)) }, onclick: () => openLesson(i) },
                el("span", { class: "tut-num mono", "aria-hidden": "true" }, String(i + 1)),
                el("span", { class: "tut-name" }, l.title),
                el("span", { class: "tut-tick" }, done.has(i) ? el("span", { class: "sr-only" }, ", done") : null),
              ),
            ),
          ),
        ),
        el("p", { class: "tut-summary mono", id: "tut-summary" }, `${done.size} of ${lessons.length} done`),
        el("button", { class: "btn ghost", type: "button", onclick: onClose }, "Back to the lobby"),
      ),
      h1,
    );
  }

  function openLesson(i) {
    clearTimers();
    lesson = i;
    stepIndex = 0;
    heading.textContent = lessons[i].title;
    count.textContent = `Lesson ${i + 1} of ${lessons.length}`;
    show(lessonView, heading);
    runStep();
  }

  function runStep() {
    const steps = lessons[lesson].steps;
    const step = steps[stepIndex];
    if (step.position !== undefined) state = tutorial.load(step.position);
    tries = 0;
    busy = false;
    view.render(state);
    light(step.highlight ?? [], "tut-lit");
    drawArrows();
    dots.replaceChildren(...steps.map((_, k) => el("span", { class: k < stepIndex ? "done" : k === stepIndex ? "now" : "" })));
    stepCount.textContent = `Step ${stepIndex + 1} of ${steps.length}`;
    text.textContent = step.text;
    feedback.textContent = "";
    feedback.className = "tut-feedback";
    check.hidden = true;
    next.hidden = true;
  }

  // ---------- moves ----------
  function onMove(move) {
    if (lesson < 0 || busy) return;
    const step = lessons[lesson].steps[stepIndex];
    const after = structuredClone(state);
    let played;
    try {
      played = tutorial.play(after, move, step);
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      return wrong(move, `${err.message}.`);
    }
    if (!expected(step).some((want) => matches(move, want))) return wrong(move, "That move is allowed, but it isn't the one this step asks for.");
    right(move, after, step, played);
  }

  function wrong(move, why) {
    tries += 1;
    view.render(state);
    view.reject(move);
    const hint = tries >= 2;
    if (hint) light(expected(lessons[lesson].steps[stepIndex]).flatMap((want) => tutorial.cells(want)), "tut-hint");
    feedback.textContent = hint ? `${why} Hint: use the squares lit up on the board.` : `${why} Try again.`;
    feedback.className = "tut-feedback wrong";
  }

  function right(move, after, step, played) {
    busy = true;
    state = after;
    light([], "tut-lit");
    arrows.replaceChildren();
    feedback.textContent = "Right!";
    feedback.className = "tut-feedback right";
    landed(view.render(state, played), () => {
      showCheck(tutorial.cells(move).at(-1));
      sounds.play(chime("right", flavour));
      later(() => {
        check.hidden = true;
        if (!step.reply) return advance();
        const replied = tutorial.play(state, step.reply, step);
        landed(view.render(state, replied), () => later(advance, REPLY_MS));
      }, RIGHT_MS);
    });
  }

  function advance() {
    if (stepIndex + 1 < lessons[lesson].steps.length) {
      stepIndex += 1;
      return runStep();
    }
    saveDone(slug, lesson);
    if (lesson === lessons.length - 1) return showEnd();
    dots.replaceChildren(...lessons[lesson].steps.map(() => el("span", { class: "done" })));
    feedback.textContent = "Lesson complete!";
    const go = el("button", { class: "btn primary", type: "button", id: "tut-next", onclick: () => openLesson(lesson + 1) }, "Next lesson");
    next.replaceChildren(go, el("button", { class: "btn", type: "button", onclick: () => showList() }, "All lessons"));
    next.hidden = false;
    go.focus();
  }

  function showEnd() {
    lesson = -1;
    const all = doneIn(slug).size === lessons.length;
    const h1 = el("h1", { tabindex: "-1", id: "tut-end" }, all ? "You've finished every lesson!" : "That was the last lesson!");
    show(
      el(
        "div",
        { class: "card tutorial tut-end" },
        h1,
        el("p", {}, all ? `You know how ${title} works. Try it in a real game.` : "Go back for the lessons you skipped, or try a real game."),
        el(
          "div",
          { class: "tut-end-actions" },
          el("button", { class: "btn primary big", type: "button", id: "tut-play-robot", onclick: onPlayRobot }, "Play the robot now"),
          el("button", { class: "btn", type: "button", onclick: () => showList() }, "Back to lessons"),
        ),
      ),
      h1,
    );
    celebrate({ outcome: "win", flavour, anchor: h1 });
  }

  // ---------- highlight layer ----------
  let lit = [];
  function light(list, kind) {
    for (const node of lit) node.classList.remove("tut-lit", "tut-hint");
    lit = list.map((c) => view.cell(c));
    for (const node of lit) node.classList.add(kind);
  }

  // Where a cell sits in the stage, in pixels.
  function box(c) {
    const s = stage.getBoundingClientRect();
    const r = view.cell(c).getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, size: r.width };
  }

  // Each arrow is drawn along +x from its start, then turned into place, so it
  // can grow from there. It leaves the edge of the piece and points at the
  // middle of the square it goes to.
  function drawArrows() {
    const list = lesson >= 0 && !busy ? (lessons[lesson].steps[stepIndex].arrows ?? []) : [];
    const { width, height } = stage.getBoundingClientRect();
    arrows.setAttribute("viewBox", `0 0 ${width} ${height}`);
    arrows.replaceChildren(
      ...list.map(([from, to]) => {
        const a = box(from);
        const b = box(to);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const w = a.size * 0.14;
        const head = w * 2.4;
        const g = document.createElementNS(NS, "g");
        g.setAttribute("transform", `translate(${a.x} ${a.y}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI})`);
        g.innerHTML = `<g class="tut-arrow"><line x1="${a.size * 0.35}" y1="0" x2="${len - head}" y2="0" stroke-width="${w}"/><path d="M${len} 0L${len - head} ${-head * 0.7}V${head * 0.7}Z"/></g>`;
        return g;
      }),
    );
  }

  function showCheck(c) {
    const { x, y, size } = box(c);
    Object.assign(check.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(28, size * 0.5)}px` });
    check.hidden = false;
  }

  showList();

  return {
    destroy() {
      clearTimers();
      resize.disconnect();
      calm();
      root.replaceChildren();
    },
  };
}
