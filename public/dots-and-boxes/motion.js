// The pencil's motion, shared by the game (main.js) and its tutorial
// (tutorial.js): a line drawn stroke by stroke, a box popping in, a ripple
// through a run of boxes.
import { s, r1, wobble, stroke } from "./art.js";

// Milliseconds: your stroke, theirs, the pause before their first line and
// between their lines, a box's pop, and between two boxes closed at once.
export const PACE = { mine: 170, theirs: 330, first: 300, gap: 200, after: 240, pop: 420, stagger: 110 };

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

// Motion on `board` (art.js's buildBoard) of n × n boxes. Each call takes
// its generation g: once live(g) is false it stops, and fast() skips it.
export function motion(board, n, { fast, live }) {
  const wait = (ms, g) => new Promise((r) => (fast() || !live(g) ? r() : setTimeout(r, ms)));

  function tween(ms, step, g) {
    return new Promise((resolve) => {
      if (fast() || !live(g)) {
        step(1);
        return resolve();
      }
      const t0 = performance.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (live(g)) step(1);
        resolve();
      };
      const frame = (now) => {
        if (done) return;
        if (!live(g)) return finish();
        // A frame's timestamp can be a little before t0.
        const t = clamp01((now - t0) / ms);
        step(t);
        if (t < 1) requestAnimationFrame(frame);
        else finish();
      };
      requestAnimationFrame(frame);
      // Frames stop in a hidden tab; the queue must not.
      setTimeout(finish, ms + 150);
    });
  }

  // The pencil draws line l (its lineArt `node`) from one dot to the other, a graphite tip leading.
  async function penStroke(node, l, cls, ms, g) {
    const paths = node.querySelectorAll("path");
    const { at } = stroke(n, l);
    const tip = fast() ? null : s("circle", { class: `tip ${cls}`, r: 6.5 });
    if (tip) board.fx.append(tip);
    const set = (t) => {
      for (const p of paths) p.style.strokeDashoffset = String(1 - t);
      if (tip) {
        const p = at(t);
        tip.setAttribute("cx", r1(p.x));
        tip.setAttribute("cy", r1(p.y));
      }
    };
    set(0);
    await tween(ms, (t) => set(easeOut(t)), g);
    tip?.remove();
    for (const p of paths) p.style.strokeDashoffset = "";
  }

  // Box b (its boxArt) pops in: the tint springs out, the hatch scribbles
  // itself in, the initial lands, and a few flecks fly off.
  function popBox({ inner, cx, cy }, b, cls, g) {
    if (fast() || !live(g)) return;
    const hatchPath = inner.querySelector(".hatch");
    const letter = inner.querySelector(".initial");
    const ring = s("circle", { class: `ring ${cls}`, cx, cy, r: 20 });
    board.fx.append(ring);
    const flecks = [];
    for (let i = 0; i < 7; i++) {
      const node = s("circle", { class: `fleck ${cls}`, r: 2.5 + (i % 3), style: "opacity: 0" });
      board.fx.append(node);
      flecks.push({ node, angle: (i / 7) * Math.PI * 2 + Math.random() * 0.5, dist: 46 + Math.random() * 22 });
    }
    tween(PACE.pop, (t) => {
      inner.setAttribute("transform", `scale(${(0.25 + 0.75 * easeBack(t)).toFixed(3)})`);
      hatchPath.style.strokeDashoffset = String(1 - clamp01(t * 1.6));
      const lt = clamp01((t - 0.25) / 0.75);
      letter.style.opacity = String(lt > 0 ? 1 : 0);
      letter.setAttribute("transform", `rotate(${r1(wobble(b, 11) * 6)}) scale(${(0.4 + 0.6 * easeBack(lt)).toFixed(3)})`);
      ring.setAttribute("r", r1(20 + 46 * easeOut(t)));
      ring.style.opacity = String(0.6 * (1 - t));
      for (const f of flecks) {
        // From the ring's edge outwards, fading in, then out as they fall.
        const d = 22 + f.dist * easeOut(t);
        f.node.setAttribute("cx", r1(cx + Math.cos(f.angle) * d));
        f.node.setAttribute("cy", r1(cy + Math.sin(f.angle) * d + 18 * t * t));
        f.node.style.opacity = String(t < 0.1 ? t / 0.1 : t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5);
      }
    }, g).then(() => {
      ring.remove();
      for (const f of flecks) f.node.remove();
      inner.removeAttribute("transform");
      hatchPath.style.strokeDashoffset = "";
      letter.style.opacity = "";
      letter.setAttribute("transform", `rotate(${r1(wobble(b, 11) * 6)})`);
    });
  }

  // A wave through boxes taken together: each one swells in turn.
  function ripple(boxes, g, gap = 70) {
    if (fast() || !live(g)) return;
    boxes.forEach((b, i) => {
      const inner = board.boxes.querySelector(`[data-box="${b}"] .box-in`);
      if (!inner) return;
      setTimeout(() => {
        if (!live(g)) return;
        tween(300, (t) => inner.setAttribute("transform", `scale(${(1 + 0.13 * Math.sin(Math.PI * t)).toFixed(3)})`), g).then(() => inner.removeAttribute("transform"));
      }, i * gap);
    });
  }

  return { wait, penStroke, popBox, ripple };
}
