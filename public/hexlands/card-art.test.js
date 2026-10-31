import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resourceGlyph, resourceCard, devCard, cardBack, RESOURCE_TITLES, DEV_KINDS, DEV_TEXT } from "./card-art.js";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const CSS = read("./card-art.css");

// Tags nest and close, and every attribute is quoted: enough to catch broken markup.
function assertWellFormed(svg, what) {
  const stack = [];
  for (const [, close, name, attrs, self] of svg.matchAll(/<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g)) {
    if (close) assert.equal(stack.pop(), name, `${what}: </${name}> closes the open tag`);
    else if (!self) stack.push(name);
    assert.doesNotMatch(attrs, /&(?![a-z]+;|#\d+;)/, `${what}: escaped attributes`);
  }
  assert.deepEqual(stack, [], `${what}: every tag closes`);
  const stripped = svg.replace(/<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g, "");
  assert.doesNotMatch(stripped, /[<>]/, `${what}: no stray or malformed tags`);
}

// No ids (a card may show many times on one page) and nothing fetched.
function assertSelfContained(svg, what) {
  assert.doesNotMatch(svg, /\sid=|href|url\(|<image|<script|<style|\son\w+=/i, `${what}: no ids or references`);
}

// Every colour class has a rule, and every token it uses is defined for light and dark.
function assertColoursDefined(svg, what) {
  const blocks = [/:root \{([^}]*)\}/, /:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/, /:root\[data-theme="dark"\] \{([^}]*)\}/].map((re) => CSS.match(re)[1]);
  for (const [, kind, name] of svg.matchAll(/hx-c([fs])-([\w-]+)/g)) {
    const prop = kind === "f" ? "fill" : "stroke";
    assert.match(CSS, new RegExp(`\\.hx-c${kind}-${name} \\{\\s*${prop}: var\\(--hx-card-${name}\\);`), `${what}: .hx-c${kind}-${name} has a rule`);
    for (const b of blocks) assert.match(b, new RegExp(`--hx-card-${name}:`), `${what}: --hx-card-${name} is defined in every theme`);
  }
}

const cards = [
  ...RESOURCE_TITLES.map((title, r) => [title, resourceCard(r)]),
  ...DEV_KINDS.map((k) => [DEV_TEXT[k].title, devCard(k)]),
  ["back", cardBack()],
];

test("every card is well-formed, self-contained SVG with both layouts", () => {
  for (const [what, svg] of cards) {
    assertWellFormed(svg, what);
    assertSelfContained(svg, what);
    assertColoursDefined(svg, what);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="hx-card [^"]*" viewBox="0 0 100 140" role="img" aria-label="[^"]+">/, `${what}: one card's root`);
    if (what !== "back") {
      assert.match(svg, /class="hx-full-face"/, `${what}: the full layout`);
      assert.match(svg, /class="hx-mini-face"/, `${what}: the small layout`);
    }
  }
});

test("each resource and development card is drawn and named", () => {
  RESOURCE_TITLES.forEach((title, r) => {
    const svg = resourceCard(r);
    assert.match(svg, new RegExp(`aria-label="${title}"`));
    assert.match(svg, new RegExp(`>${title}</text>`));
    assert.ok(svg.includes(resourceGlyph(r)), `${title}: its glyph`);
  });
  for (const k of DEV_KINDS) {
    const svg = devCard(k);
    assert.match(svg, new RegExp(`hx-dev-${k}`));
    assert.match(svg, new RegExp(`>${DEV_TEXT[k].title}</text>`));
    for (const line of DEV_TEXT[k].effect) assert.ok(svg.includes(`>${line}</text>`), `${k}: "${line}"`);
  }
  assert.equal(new Set(cards.map(([, svg]) => svg)).size, cards.length, "no two cards alike");
});

test("each resource glyph is its own shape in a 24 x 24 box", () => {
  const glyphs = RESOURCE_TITLES.map((_, r) => resourceGlyph(r));
  assert.equal(new Set(glyphs.map((g) => g.replace(/ class="[^"]*"/g, ""))).size, 5, "shapes differ, not only colours");
  glyphs.forEach((g, r) => {
    assertWellFormed(g, RESOURCE_TITLES[r]);
    assertSelfContained(g, RESOURCE_TITLES[r]);
    assertColoursDefined(g, RESOURCE_TITLES[r]);
    assert.match(g, /^<g class="hx-glyph hx-glyph-\w+">/);
    for (const [, v] of g.matchAll(/\s(?:c?[xy]|x[12]|y[12])="(-?[\d.]+)"/g)) assert.ok(+v >= 0 && +v <= 24, `${RESOURCE_TITLES[r]}: ${v} is in the box`);
  });
});

test("the CSS defines the same tokens for light and dark", () => {
  const names = (re) => [...CSS.match(re)[1].matchAll(/--([\w-]+):/g)].map((m) => m[1]);
  const light = names(/:root \{([^}]*)\}/);
  assert.deepEqual(names(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/), light);
  assert.deepEqual(names(/:root\[data-theme="dark"\] \{([^}]*)\}/), light);
  assert.ok(light.every((t) => t.startsWith("hx-card-")));
});

// The home tile's art: also the source of the link preview (og.jpg).
test("icon.svg is 16:10 art with nothing fetched and no text", () => {
  const svg = read("./icon.svg");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 320 200">/);
  assertWellFormed(svg.replace(/<!--[\s\S]*?-->/g, ""), "icon.svg");
  assert.doesNotMatch(svg, /<script|<image|<text|\son\w+=|@import|(href|src)="(?!#)|url\((?!#)/i);
});

// The rules home.js and CONTRIBUTING set for a preview: small, script-free,
// tokens only, scoped selectors, and a 3 to 5 second animation.
test("preview.svg follows the tile preview rules", () => {
  const svg = read("./preview.svg");
  assert.ok(Buffer.byteLength(svg) < 10 * 1024, `under 10 KB (${Buffer.byteLength(svg)} bytes)`);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 320 200" class="tile-preview pv-hx">/);
  assertWellFormed(svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/, ""), "preview.svg");
  assert.doesNotMatch(svg, /<script|<image|\son\w+=|@import|(href|src)="(?!#)|url\((?!#)/i);
  const style = svg.match(/<style>([\s\S]*?)<\/style>/)[1];
  const body = svg.replace(/<style>[\s\S]*?<\/style>/, "");
  assert.doesNotMatch(style + body, /#[0-9a-f]{3,8}\b(?![\w-])|rgba?\(|hsla?\(/i, "colours come from tokens only");
  assert.doesNotMatch(body, /\s(fill|stroke|stop-color)="(?!none|currentColor)/, "no colour attributes");
  for (const rule of style.replace(/@keyframes[\w\s-]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "").split("}").filter((r) => r.trim())) {
    for (const sel of rule.split("{")[0].split(",")) assert.match(sel.trim(), /^\.pv-hx[\s.:[]/, `selector "${sel.trim()}" is scoped`);
  }
  for (const [, name] of style.matchAll(/@keyframes\s+([\w-]+)/g)) assert.match(name, /^hexlands-/);
  for (const [, id] of body.matchAll(/\sid="([^"]+)"/g)) assert.match(id, /^hexlands-/);

  // When the last piece stops: its --d plus the length of its move.
  const seconds = (v) => parseFloat(v) * (v.endsWith("ms") ? 0.001 : 1);
  const own = new Map([...style.matchAll(/\.pv-hx \.([\w-]+)\s*\{[^}]*animation-duration:\s*([\d.]+m?s)/g)].map((m) => [m[1], seconds(m[2])]));
  assert.doesNotMatch(style, /animation:/, "no animation shorthand: it would reset the shared delay and pause");
  const shared = { pop: 0.32, fade: 0.32, gone: 0.32, draw: 0.32, slide: 0.45, fall: 0.5, lit: 0.5 };
  let last = 0;
  for (const [, cls, styleAttr = ""] of body.matchAll(/class="([^"]+)"(?:\s+style="([^"]*)")?/g)) {
    const names = cls.split(/\s+/);
    const d = seconds(styleAttr.match(/--d:\s*([\d.]+m?s)/)?.[1] ?? "0s");
    const l = styleAttr.match(/--l:\s*([\d.]+m?s)/)?.[1];
    for (const c of names) {
      const len = c === "lit" && l ? seconds(l) : (own.get(c) ?? shared[c]);
      if (len !== undefined) last = Math.max(last, d + len);
    }
  }
  assert.ok(last >= 3 && last <= 5, `the last move ends between 3 and 5 s (${last.toFixed(2)} s)`);
});
