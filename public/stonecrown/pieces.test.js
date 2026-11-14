import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WONDERS, SIDES } from "./cards.js";
import { wonderSvg, wonderMini, coinSvg, tokenSvg, tableSvg } from "./pieces.js";

const css = readFileSync(new URL("./pieces.css", import.meta.url), "utf8");

// Tags open and close in order, attributes are quoted, nothing is left open.
function assertWellFormed(svg) {
  const stack = [];
  const tags = svg.match(/<[^>]*>/g) || [];
  assert.equal(svg.replace(/<[^>]*>/g, "").replace(/[^<>]/g, ""), "", "no stray angle brackets");
  for (const t of tags) {
    const m = t.match(/^<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>$/);
    assert.ok(m, `well-formed tag: ${t.slice(0, 120)}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `closes ${m[2]}`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, [], "every tag is closed");
}
// A piece can show any number of times on a page: no ids, no url() references, no stray numbers.
function assertClean(svg) {
  assertWellFormed(svg);
  assert.ok(!/\sid="/.test(svg), "no ids");
  assert.ok(!/url\(/.test(svg), "no url() references");
  assert.ok(!/NaN|undefined|Infinity/.test(svg), "no NaN, undefined or Infinity");
  assert.ok(/^<svg class="sc-[\w-]+[^"]*" viewBox="[-\d. ]+"/.test(svg), "an <svg> with its class and viewBox");
}
const classes = (svg) => new Set([...svg.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));
const stagesIn = (svg) => [...svg.matchAll(/class="sc-stage sc-stage-(\w+)" data-stage="(\d+)"/g)].map((m) => [m[1], +m[2]]);
const tuckedIn = (svg) => (svg.match(/<g transform="translate\([-\d. ]+\) rotate\([-\d. ]+ 0 50\)">/g) || []).length;

test("every wonder, side and stage count draws a clean board", () => {
  for (let w = 0; w < WONDERS.length; w++) {
    for (const side of SIDES) {
      const k = WONDERS[w].sides[side].length;
      for (let built = 0; built <= k; built++) {
        const svg = wonderSvg(w, side, { built, tucked: built });
        assertClean(svg);
        assert.ok(classes(svg).has("sc-wonder") && classes(svg).has(`sc-w-${WONDERS[w].key}`));
        assert.match(svg, new RegExp(`aria-label="${WONDERS[w].name}, side ${side}: ${built} of ${k} stages built"`));
        assert.deepEqual(stagesIn(svg), Array.from({ length: k }, (_, i) => [i < built ? "built" : "open", i]));
        assert.equal(tuckedIn(svg), built, "a card under each built stage");
        assert.match(svg, new RegExp(`>${side}</text>`), "shows its side");
        // The finished parts carry lanterns; the rest is a ghost with scaffolding on the next stage.
        assert.equal(/class="sc-ps-ghost"/.test(svg), built < k, "a ghost while unfinished");
        assert.equal(/class="sc-ps-scaffold"/.test(svg), built < k, "scaffolding while unfinished");
      }
    }
  }
});

test("a board grows as stages are built", () => {
  for (let w = 0; w < WONDERS.length; w++) {
    for (const side of SIDES) {
      const k = WONDERS[w].sides[side].length;
      const sizes = Array.from({ length: k + 1 }, (_, b) => wonderSvg(w, side, { built: b }).length);
      const boards = new Set(Array.from({ length: k + 1 }, (_, b) => wonderSvg(w, side, { built: b })));
      assert.equal(boards.size, k + 1, `${WONDERS[w].key} ${side}: each stage count looks different`);
      assert.ok(sizes[k] > sizes[0], `${WONDERS[w].key} ${side}: more drawn when finished`);
    }
  }
});

test("a card tucked beyond the built stages marks the stage being built, and ages pick the backs", () => {
  const svg = wonderSvg(1, "A", { built: 1, tucked: 2 });
  assert.deepEqual(stagesIn(svg), [["built", 0], ["pending", 1], ["open", 2]]);
  assert.equal(tuckedIn(svg), 2);
  const aged = wonderSvg(6, "B", { built: 3, tucked: [1, 2, 2] });
  assert.ok(classes(aged).has("sc-pf-back2") && !classes(aged).has("sc-pf-back3"));
  // Out of range values are clamped, an unknown side falls back to A.
  assertClean(wonderSvg(0, "B", { built: 9, tucked: 9 }));
  assert.equal(stagesIn(wonderSvg(0, "B", { built: 9 })).length, 2);
  assert.equal(stagesIn(wonderSvg(0, "C", { built: -2 })).length, 3);
  assert.equal(stagesIn(wonderSvg(0, "A")).filter(([s]) => s === "built").length, 0);
});

test("every stage shows its cost and effect, special effects with their own icons", () => {
  const icon = { dig: "sc-pf-pile", free: "sc-pf-gift", playLast: "sc-pf-seventh", copyGuild: "sc-pf-guild", science: "sc-pf-sci-disc" };
  for (let w = 0; w < WONDERS.length; w++) {
    for (const side of SIDES) {
      const k = WONDERS[w].sides[side].length;
      const svg = wonderSvg(w, side, { built: 0 });
      const tiles = svg.split('<g class="sc-stage ').slice(1);
      assert.equal(tiles.length, k);
      WONDERS[w].sides[side].forEach((st, i) => {
        const tile = tiles[i];
        for (const [fx, cls] of Object.entries(icon)) assert.equal(tile.includes(cls), !!st[fx], `${WONDERS[w].key} ${side} ${i}: ${fx}`);
        if (st.points) assert.match(tile, new RegExp(`>${st.points}</text>`));
        if (st.gold) assert.match(tile, new RegExp(`class="sc-p-text sc-pf-coin\\d-ink"[^>]*>${st.gold}</text>`));
        const units = st.cost.res.reduce((a, b) => a + b, 0);
        const shields = st.shields || 0;
        const choice = (st.produce || []).reduce((a, u) => a + u.length, 0) + (st.trade ? 4 : 0);
        assert.equal((tile.match(/class="sc-p-icon"/g) || []).length - (st.science ? 3 : 0) - (st.points ? 1 : 0), units + shields + choice, `${WONDERS[w].key} ${side} ${i}: one icon a unit`);
      });
    }
  }
});

test("a neighbour's mini board shows a lantern a stage, lit when built", () => {
  for (let w = 0; w < WONDERS.length; w++) {
    for (const side of SIDES) {
      const k = WONDERS[w].sides[side].length;
      for (let built = 0; built <= k; built++) {
        const svg = wonderMini(w, side, built);
        assertClean(svg);
        assert.ok(classes(svg).has("sc-wonder-mini"));
        const lit = (svg.match(/<text[^>]*class="sc-p-text sc-pf-built-ink"[^>]*>[IV]+<\/text>/g) || []).length;
        const dark = (svg.match(/<text[^>]*class="sc-p-text sc-pf-tile-ink"[^>]*>[IV]+<\/text>/g) || []).length;
        assert.deepEqual([lit, dark], [built, k - built]);
      }
    }
  }
});

test("coins and tokens show their value", () => {
  for (const v of [1, 3]) {
    const svg = coinSvg(v);
    assertClean(svg);
    assert.match(svg, new RegExp(`>${v}</text>`));
    assert.ok(classes(svg).has(`sc-coin-${v}`));
  }
  for (const v of [1, 3, 5]) {
    const svg = tokenSvg(v);
    assertClean(svg);
    assert.match(svg, new RegExp(`>${v}</text>`));
    assert.ok(classes(svg).has(`sc-pf-victory${v}`));
  }
  const defeat = tokenSvg(-1);
  assertClean(defeat);
  assert.match(defeat, />−1<\/text>/);
  assert.ok(classes(defeat).has("sc-token-defeat"));
  // A number big enough to read at 20 px: nearly half the piece's height.
  for (const svg of [coinSvg(1), coinSvg(3), tokenSvg(5), tokenSvg(-1)]) assert.ok(+svg.match(/<text[^>]*font-size="([\d.]+)"/)[1] / 24 >= 0.45);
  assertClean(tableSvg());
});

test("pieces.css paints every class, every colour a token with light and dark values", () => {
  const block = (start) => css.slice(css.indexOf("{", css.indexOf(start)) + 1, css.indexOf("}", css.indexOf(start)));
  const tokens = (body) => [...body.matchAll(/(--sc-p-[\w-]+):/g)].map((m) => m[1]).sort();
  const light = tokens(block(":root {"));
  assert.ok(light.length > 50);
  assert.deepEqual(tokens(block(':root:not([data-theme="light"])')), light);
  assert.deepEqual(tokens(block(':root[data-theme="dark"] {')), light);
  const defined = new Set(light);
  for (const [, v] of css.matchAll(/var\((--sc-p-[\w-]+)\)/g)) assert.ok(defined.has(v), `${v} is defined`);
  // The night is a different palette: the sky and the windows change.
  const value = (sel, t) => block(sel).match(new RegExp(`${t}:\\s*([^;]+);`))[1];
  for (const t of ["--sc-p-night", "--sc-p-win", "--sc-p-rhodes-0", "--sc-p-tile"]) assert.notEqual(value(":root {", t), value(':root[data-theme="dark"] {', t), t);

  const all = [];
  for (let w = 0; w < WONDERS.length; w++) for (const side of SIDES) all.push(wonderSvg(w, side, { built: 1, tucked: 2 }), wonderMini(w, side, 1));
  all.push(coinSvg(1), coinSvg(3), tokenSvg(1), tokenSvg(3), tokenSvg(5), tokenSvg(-1), tableSvg());
  // Paints and helpers are styled here; the icons from card-art.js bring their own classes.
  const painted = /^sc-(p[fs]?-[\w-]+|night|cloud)$/;
  for (const c of classes(all.join(""))) if (painted.test(c) && c !== "sc-p-icon") assert.match(css, new RegExp(`\\.${c}(?![\\w-])`), `.${c} is styled`);
  const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.ok(!/animation:/.test(css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"))), "no animation outside the reduced-motion query");
  assert.ok(motion.includes(".sc-stage.sc-new"));
});
