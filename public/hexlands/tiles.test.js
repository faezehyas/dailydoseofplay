import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VIEWBOX, defsSvg, seaSvg, terrainSvg, harbourSvg } from "./tiles.js";
import { HEXES, EDGES, HARBOUR_EDGES, TERRAIN_NAMES, RESOURCES, ANY, layoutBoard } from "./board.js";
import { resourceGlyph } from "./card-art.js";
import { rngFromSeed } from "../engine/rng.js";

const css = readFileSync(new URL("./tiles.css", import.meta.url), "utf8");
const cardCss = readFileSync(new URL("./card-art.css", import.meta.url), "utf8"); // the harbour badges' glyphs
const board = layoutBoard(rngFromSeed("tiles"));
const KINDS = [ANY, ...RESOURCES];
const terrains = TERRAIN_NAMES.flatMap((_, t) => HEXES.map((h) => terrainSvg(t, h)));
const harbours = KINDS.map((kind, i) => harbourSvg({ edge: HARBOUR_EDGES[i], kind }));
const everything = [defsSvg(), seaSvg(board), ...terrains, ...harbours];

// Every tag closes in order, attributes are quoted, and nothing else looks like markup.
function wellFormed(svg) {
  const stack = [];
  const rest = svg.replace(/<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g, (_, close, name, attrs, self) => {
    if (close) assert.equal(stack.pop(), name, `</${name}> closes the open tag`);
    else if (!self) stack.push(name);
    return "";
  });
  assert.deepEqual(stack, [], "every tag is closed");
  assert.doesNotMatch(rest, /[<>]/, "nothing but tags and text");
}

test("the defs, the sea, every terrain on every hex and every harbour are well-formed markup", () => {
  for (const svg of everything) wellFormed(svg);
  wellFormed(`<svg viewBox="${VIEWBOX}">${everything.join("")}</svg>`);
});

test("drawing is deterministic, and hexes of one terrain differ", () => {
  assert.equal(seaSvg(board), seaSvg(layoutBoard(rngFromSeed("tiles"))));
  assert.equal(defsSvg(), defsSvg());
  TERRAIN_NAMES.forEach((_, t) => {
    const art = HEXES.map((h) => terrainSvg(t, h.id).replace(/^<g[^>]*>/, ""));
    assert.deepEqual(art, HEXES.map((h) => terrainSvg(t, h).replace(/^<g[^>]*>/, "")));
    assert.ok(new Set(art).size > HEXES.length / 2, `${TERRAIN_NAMES[t]} varies from hex to hex`);
  });
});

test("ids are prefixed hx-, unique, and every reference points at one", () => {
  const ids = [...everything.join("").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 20);
  for (const id of ids) assert.match(id, /^hx-/);
  assert.equal(new Set(ids).size, ids.length);
  const refs = [...[...everything, css].join("").matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  assert.ok(refs.length > 100);
  for (const ref of refs) assert.ok(ids.includes(ref), `#${ref} is defined`);
});

test("nothing refers outside the board: no links, images, scripts or other files", () => {
  for (const svg of [...everything, css]) {
    assert.doesNotMatch(svg, /https?:|\/\/|<image|<script|<foreignObject|@import/i);
    assert.doesNotMatch(svg, /href="[^#]/);
    assert.doesNotMatch(svg, /url\((?!#hx-)/);
  }
});

test("every terrain draws its own ground and objects, at its hex", () => {
  TERRAIN_NAMES.forEach((name, t) => {
    for (const h of HEXES) {
      const svg = terrainSvg(t, h);
      assert.ok(svg.startsWith(`<g class="hx-tile hx-${name}" transform="translate(${Math.round(h.x * 1000) / 10} ${Math.round(h.y * 1000) / 10})">`));
      assert.ok(svg.includes(`url(#hx-g-${name})`) && svg.includes('clip-path="url(#hx-clip)"'));
      assert.ok((svg.match(/<use /g) ?? []).length >= 2, `${name} on hex ${h.id} has objects`);
    }
  });
  assert.ok(HEXES.some((h) => terrainSvg(3, h).includes("#hx-mill")), "some fields have a windmill");
  assert.ok(HEXES.some((h) => terrainSvg(1, h).includes("#hx-kiln")), "some hills have a kiln");
  assert.ok(HEXES.some((h) => !terrainSvg(1, h).includes("#hx-kiln")), "not every hill has one");
});

test("objects stand clear of the number token in the middle of the hex", () => {
  for (const svg of terrains) {
    for (const m of svg.slice(svg.indexOf("clip-path")).matchAll(/<use href="#hx-[\w-]+" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g)) {
      assert.ok(Math.hypot(+m[1], +m[2]) >= 34, `an object at ${m[1]} ${m[2]}`);
    }
  }
});

test("every harbour kind gets a jetty and a badge on the water: a glyph and 2:1, or 3:1", () => {
  const [x0, y0, w, h] = VIEWBOX.split(" ").map(Number);
  KINDS.forEach((kind, i) => {
    const svg = harbours[i];
    const edge = EDGES[HARBOUR_EDGES[i]];
    assert.ok(svg.includes(`data-edge="${edge.id}"`));
    assert.ok(svg.includes(`hx-ring-${kind === ANY ? "any" : kind}`));
    if (kind === ANY) assert.ok(svg.includes(">3:1<") && !svg.includes(">2:1<"));
    else assert.ok(svg.includes(resourceGlyph(kind)) && svg.includes(">2:1<"));
  });
  for (const e of HARBOUR_EDGES) {
    const [, x, y] = harbourSvg({ edge: e, kind: ANY }).match(/class="hx-badge-at" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/).map(Number);
    assert.ok(Math.hypot(x, y) > Math.hypot(EDGES[e].x, EDGES[e].y) * 100 + 60, "out on the water");
    const r = 27 * 1.5;
    assert.ok(x - r > x0 && x + r < x0 + w && y - r > y0 && y + r < y0 + h, "inside the board, even when big");
  }
});

// The custom properties of the first `<selector> { … }` block.
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `tiles.css has a ${selector} block`);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

test("light and dark set the same tokens, the same way under both dark selectors", () => {
  const light = tokens(":root");
  const dark = tokens(':root[data-theme="dark"]');
  assert.deepEqual(tokens(':root:not([data-theme="light"])'), dark);
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
  for (const k of Object.keys(light)) assert.match(k, /^--hx-/);
  const used = new Set([...css.matchAll(/var\((--hx-[\w-]+)/g)].map((m) => m[1]));
  for (const k of used) assert.ok(k in light, `${k} is defined`);
});

test("every class in the markup is styled or a hook for the screen", () => {
  const hooks = new Set(["hx-tile", "hx-sea", "hx-harbour", "hx-badge-at", ...TERRAIN_NAMES.map((t) => `hx-${t}`)]);
  const classes = new Set([...everything.join("").matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(" ")));
  for (const c of classes) {
    assert.match(c, /^hx-/);
    if (!hooks.has(c) && !c.startsWith("hx-glyph-")) assert.ok([css, cardCss].some((sheet) => sheet.includes(`.${c} `) || sheet.includes(`.${c},`) || sheet.includes(`.${c}{`)), `.${c} is in tiles.css or card-art.css`);
  }
});

test("motion only plays when reduced motion isn't asked for", () => {
  const start = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  assert.ok(start >= 0);
  let depth = 0, end = css.indexOf("{", start);
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    if (css[end] === "}" && --depth === 0) break;
  }
  assert.doesNotMatch(css.slice(0, start) + css.slice(end), /animation\s*:/);
});
