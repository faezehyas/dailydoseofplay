import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HEXES, CORNERS, EDGES, pips } from "./board.js";
import { tokenSvg, roadSvg, settlementSvg, citySvg, robberSvg, spotSvg, diceSvg } from "./pieces.js";

const css = readFileSync(new URL("./pieces.css", import.meta.url), "utf8");
const NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

// Tags open and close in order, attributes are quoted, nothing is left open.
function assertWellFormed(svg) {
  const stack = [];
  const tags = svg.match(/<[^>]*>/g) || [];
  assert.equal(svg.replace(/<[^>]*>/g, "").replace(/[^<>]/g, ""), "", "no stray angle brackets");
  for (const t of tags) {
    const m = t.match(/^<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>$/);
    assert.ok(m, `well-formed tag: ${t}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `closes ${m[2]}`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, [], "every tag is closed");
}

const attr = (svg, name) => (svg.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
const place = (svg) => {
  const m = attr(svg, "transform").match(/translate\(([-\d.]+) ([-\d.]+)\)(?: rotate\(([-\d.]+)\))?/);
  return { x: +m[1], y: +m[2], rot: m[3] === undefined ? null : +m[3] };
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: ${a} vs ${b}`);
const classes = (svg) => new Set([...svg.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));

test("buildings sit on their corner, in their seat's colour", () => {
  for (const c of CORNERS) {
    for (let seat = 0; seat < 4; seat++) {
      for (const [draw, kind] of [[settlementSvg, "hx-settlement"], [citySvg, "hx-city"]]) {
        const svg = draw(c.id, seat);
        assertWellFormed(svg);
        assert.equal(attr(svg, "data-corner"), String(c.id));
        assert.ok(classes(svg).has(kind) && classes(svg).has(`p-${seat}`) && classes(svg).has("hx-piece"));
        const p = place(svg);
        near(p.x, c.x * 100, "x");
        near(p.y, c.y * 100, "y");
      }
    }
  }
});

test("a road lies along its edge, turned from one corner to the other", () => {
  for (const e of EDGES) {
    const svg = roadSvg(e.id, e.id % 4);
    assertWellFormed(svg);
    assert.equal(attr(svg, "data-edge"), String(e.id));
    assert.ok(classes(svg).has(`p-${e.id % 4}`));
    const p = place(svg);
    near(p.x, e.x * 100, "x");
    near(p.y, e.y * 100, "y");
    const a = CORNERS[e.a], b = CORNERS[e.b];
    near(p.rot, (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, "angle");
  }
});

test("a city is bigger than a settlement", () => {
  const span = (svg) => {
    const nums = [...svg.matchAll(/class="hx-halo" d="([^"]*)"/g)].flatMap((m) => m[1].match(/-?[\d.]+/g).map(Number));
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
  const [sw, sh] = span(settlementSvg(20, 0));
  const [cw, ch] = span(citySvg(20, 0));
  assert.ok(cw > sw * 1.3 && ch > sh * 1.3, `${cw}x${ch} vs ${sw}x${sh}`);
});

test("every seat's pieces carry a different mark, so no two seats differ by hue alone", () => {
  for (const draw of [(s) => settlementSvg(20, s), (s) => citySvg(20, s), (s) => roadSvg(30, s)]) {
    const marks = [0, 1, 2, 3].map((s) => (draw(s).match(/<[^>]*class="hx-mark[^"]*"[^>]*>/g) || []).map((t) => t.replace(/\s(cx|cy)="[^"]*"/g, "")).join(""));
    assert.equal(new Set(marks).size, 4, marks.join(" | "));
  }
});

test("number tokens show the number and its pips, 6 and 8 in red", () => {
  for (const h of HEXES) {
    for (const n of NUMBERS) {
      const svg = tokenSvg(n, h.id);
      assertWellFormed(svg);
      assert.equal(attr(svg, "data-hex"), String(h.id));
      assert.match(svg, new RegExp(`<text[^>]*>${n}</text>`));
      const pipGroup = svg.match(/<g class="hx-pips">(.*?)<\/g>/)[1];
      assert.equal((pipGroup.match(/<circle/g) || []).length, pips(n));
      assert.equal(classes(svg).has("hx-hot"), n === 6 || n === 8);
      const p = place(svg);
      near(p.x, h.x * 100, "x");
      near(p.y, h.y * 100, "y");
    }
  }
});

test("the robber stands on its hex, and can hop from another", () => {
  for (const h of HEXES) {
    const svg = robberSvg(h.id);
    assertWellFormed(svg);
    assert.equal(attr(svg, "data-hex"), String(h.id));
    assert.ok(!classes(svg).has("hx-hop"));
    const p = place(svg);
    assert.ok(Math.hypot(p.x - h.x * 100, p.y - h.y * 100) < 70, "inside its hex");
  }
  const hop = robberSvg(9, 0);
  assertWellFormed(hop);
  assert.ok(classes(hop).has("hx-hop"));
  const [dx, dy] = [...attr(hop, "style").matchAll(/--hx-d[xy]: ([-\d.]+)px/g)].map((m) => +m[1]);
  near(dx, (HEXES[0].x - HEXES[9].x) * 100, "dx");
  near(dy, (HEXES[0].y - HEXES[9].y) * 100, "dy");
});

test("spots carry their ids, take focus and have a finger-sized hit area", () => {
  for (const c of CORNERS) {
    const svg = spotSvg("corner", c.id);
    assertWellFormed(svg);
    assert.equal(attr(svg, "data-corner"), String(c.id));
    const p = place(svg);
    near(p.x, c.x * 100, "x");
    near(p.y, c.y * 100, "y");
  }
  for (const e of EDGES) {
    const svg = spotSvg("edge", e.id);
    assertWellFormed(svg);
    assert.equal(attr(svg, "data-edge"), String(e.id));
    near(place(svg).x, e.x * 100, "x");
  }
  for (const h of HEXES) {
    const svg = spotSvg("hex", h.id, 'Move the robber to "the hills"');
    assertWellFormed(svg);
    assert.equal(attr(svg, "data-hex"), String(h.id));
    assert.equal(attr(svg, "aria-label"), "Move the robber to &#34;the hills&#34;");
  }
  for (const svg of [spotSvg("corner", 0), spotSvg("edge", 0), spotSvg("hex", 0)]) {
    assert.equal(attr(svg, "role"), "button");
    assert.equal(attr(svg, "tabindex"), "0");
    assert.ok(classes(svg).has("hx-hit"));
  }
  // A board 360 px wide shows about 0.36 px a unit; a finger wants about 44 px.
  assert.ok(+spotSvg("corner", 0).match(/class="hx-hit" r="([\d.]+)"/)[1] * 2 * 0.36 >= 43);
  const kite = spotSvg("edge", 0).match(/class="hx-hit" d="([^"]*)"/)[1].match(/-?[\d.]+/g).map(Number);
  assert.ok((Math.max(...kite) - Math.min(...kite)) * 0.36 >= 50, "an edge's hit area is tall across the edge");
});

test("dice show their faces and flicker through others while rolling", () => {
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const svg = diceSvg([a, b]);
      assertWellFormed(svg);
      const dice = svg.split('<g class="hx-die"').slice(1);
      [a, b].forEach((face, i) => {
        assert.match(dice[i], new RegExp(`^ data-face="${face}"`));
        const shown = dice[i].match(/<g class="hx-die-pips[^"]*">(.*?)<\/g>/)[1];
        assert.equal((shown.match(/<circle/g) || []).length, face);
        const alts = [...dice[i].matchAll(/<g class="hx-die-pips-alt[^"]*" opacity="0">(.*?)<\/g>/g)].map((m) => (m[1].match(/<circle/g) || []).length);
        assert.equal(alts.length, 3);
        assert.ok(!alts.includes(face));
      });
    }
  }
});

test("pieces.css styles every part, in both themes, and keeps motion behind the reduced-motion query", () => {
  const block = (start) => css.slice(css.indexOf("{", css.indexOf(start)) + 1, css.indexOf("}", css.indexOf(start)));
  const tokens = (body) => [...body.matchAll(/(--hx-[\w-]+):/g)].map((m) => m[1]).sort();
  const light = tokens(block(":root {"));
  assert.deepEqual(tokens(block(':root:not([data-theme="light"])')), light);
  assert.deepEqual(tokens(block(':root[data-theme="dark"] {')), light);
  const defined = new Set([...light, ...[...css.matchAll(/(--hx-[\w-]+):/g)].map((m) => m[1])]);
  for (const [, v] of css.matchAll(/var\((--hx-[\w-]+)/g)) if (!["--hx-dx", "--hx-dy"].includes(v)) assert.ok(defined.has(v), `${v} is defined`);

  const all = [settlementSvg(20, 3), citySvg(20, 2), roadSvg(30, 1), roadSvg(30, 3), tokenSvg(6, 0), robberSvg(0, 1), spotSvg("corner", 0), spotSvg("edge", 0), spotSvg("hex", 0), diceSvg([1, 5])].join("");
  const structural = new Set(["hx-settlement", "hx-city", "hx-spot-corner", "hx-spot-edge", "p-1", "p-2", "p-3"]);
  for (const c of classes(all)) if (!structural.has(c)) assert.match(css, new RegExp(`\\.${c}(?![\\w-])`), `.${c} is styled`);

  const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
  const outside = css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.ok(!/animation:/.test(outside), "no animation outside the reduced-motion query");
  for (const cls of [".hx-rolling", ".hx-pop", ".hx-draw", ".hx-hop", ".hx-spot-pulse"]) assert.ok(motion.includes(cls), `${cls} moves`);
});
