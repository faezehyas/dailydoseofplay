import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardSvg, cardBack, cardText, resourceIcon, scienceIcon, coinIcon, shieldIcon, pointsIcon, neighbourIcon, colourIcon, effectIcon } from "./card-art.js";
import { CARDS, COLORS, RESOURCES, SYMBOLS } from "./cards.js";

const CSS = readFileSync(new URL("./card-art.css", import.meta.url), "utf8");
const TAG = /<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g;

// Tags nest and close, and every attribute is quoted: enough to catch broken markup.
function assertWellFormed(svg, what) {
  const stack = [];
  for (const [, close, name, attrs, self] of svg.matchAll(TAG)) {
    if (close) assert.equal(stack.pop(), name, `${what}: </${name}> closes the open tag`);
    else if (!self) stack.push(name);
    assert.doesNotMatch(attrs, /&(?![a-z]+;|#\d+;)/, `${what}: escaped attributes`);
  }
  assert.deepEqual(stack, [], `${what}: every tag closes`);
  assert.doesNotMatch(svg.replace(TAG, ""), /[<>]/, `${what}: no stray or malformed tags`);
  assert.doesNotMatch(svg, /NaN|undefined|Infinity|null/, `${what}: every number is a number`);
}

// No ids (a card may show many times on one page) and nothing fetched.
function assertSelfContained(svg, what) {
  assert.doesNotMatch(svg, /\sid=|href|url\(|<image|<script|<style|<foreignObject|\son\w+=/i, `${what}: no ids or references`);
}

const blockOf = (re) => {
  const m = CSS.match(re);
  assert.ok(m, `card-art.css has ${re}`);
  return Object.fromEntries([...m[1].matchAll(/--sc-([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
};
const THEMES = {
  light: blockOf(/\n:root \{([^}]*)\}/),
  media: blockOf(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/),
  dark: blockOf(/\n:root\[data-theme="dark"\] \{([^}]*)\}/),
};
const rule = (sel) => CSS.match(new RegExp(`\\n${sel.replace(/\./g, "\\.")} \\{([^}]*)\\}`))?.[1];

// Every colour class has a rule, and every token it reaches is defined in every theme.
function assertColoursDefined(svg, what) {
  for (const [, kind, name] of svg.matchAll(/class="[^"]*?\bsc-([fs])-([\w-]+)/g)) {
    const body = rule(`.sc-${kind}-${name}`);
    assert.ok(body, `${what}: .sc-${kind}-${name} has a rule`);
    const token = body.match(/var\(--sc-([\w-]+)\)/)[1];
    if (/^t\d$/.test(token)) continue;
    for (const [theme, b] of Object.entries(THEMES)) assert.ok(token in b, `${what}: --sc-${token} is defined for ${theme}`);
  }
  for (const [, c] of svg.matchAll(/\bsc-c-([\w-]+)/g)) {
    const body = rule(`.sc-c-${c}`);
    assert.ok(body, `${what}: .sc-c-${c} sets its tones`);
    for (let i = 0; i < 5; i++) for (const [theme, b] of Object.entries(THEMES)) assert.ok(`${c}-${i}` in b && body.includes(`--sc-t${i}: var(--sc-${c}-${i})`), `${what}: tone ${i} of ${c} for ${theme}`);
  }
}
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => unescape(m[1]));
const nodes = (svg) => (svg.match(/<[a-z]/g) || []).length;

test("every design renders full and mini, well-formed and self-contained", () => {
  for (const c of CARDS) {
    for (const size of ["full", "mini"]) {
      const svg = cardSvg(c.id, { size }), what = `${c.key} (${size})`;
      assertWellFormed(svg, what);
      assertSelfContained(svg, what);
      assertColoursDefined(svg, what);
      const root = svg.match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="([^"]+)" viewBox="0 0 100 140"( preserveAspectRatio="xMidYMin slice")? role="img" aria-label="([^"]+)">/);
      assert.ok(root, `${what}: one card's root`);
      assert.equal(root[1], `sc-card sc-c-${c.color}${size === "mini" ? " sc-mini" : ""}`);
      assert.equal(Boolean(root[2]), size === "mini", `${what}: only the mini slices from the top`);
      assert.equal(unescape(root[3]), cardText(c.id), `${what}: labelled in words`);
    }
  }
  assert.equal(cardSvg(0), cardSvg(0, { size: "full" }), "full by default");
  assert.throws(() => cardSvg(CARDS.length), RangeError);
});

test("each full card names itself, its age and both ends of its chains", () => {
  const roman = ["", "I", "II", "III"];
  for (const c of CARDS) {
    const svg = cardSvg(c.id), words = texts(svg);
    assert.ok(words.join(" ").includes(c.name), `${c.key}: its name`);
    assert.ok(words.includes(roman[c.age]), `${c.key}: its age`);
    for (const k of c.from) assert.ok(words.includes(CARDS.find((d) => d.key === k).name), `${c.key}: built free from ${k}`);
    for (const d of CARDS.filter((d) => d.from.includes(c.key))) assert.ok(words.includes(d.name), `${c.key}: builds ${d.key} free`);
    const big = [...svg.matchAll(/font-size="([\d.]+)"[^>]*>[^<]*<\/text>/g)].map((m) => +m[1]);
    assert.ok(Math.max(...big) >= 10.4, `${c.key}: the name is big enough to read on a phone`);
  }
});

test("each building has its own scene, and the two ages of a grey card share one", () => {
  const sceneOf = (id) => cardSvg(id).match(/<svg x="0" y="0"[^>]*>([\s\S]*?)<\/svg>/)[1];
  const byKey = new Map();
  for (const c of CARDS) {
    const s = sceneOf(c.id);
    if (byKey.has(c.key)) assert.equal(s, byKey.get(c.key), `${c.key}: one scene in both ages`);
    byKey.set(c.key, s);
  }
  assert.equal(new Set(byKey.values()).size, byKey.size, "no two buildings alike");
  assert.equal(new Set(CARDS.map((c) => cardSvg(c.id))).size, CARDS.length, "no two cards alike");
  const guildHalls = CARDS.filter((c) => c.color === "purple").map((c) => sceneOf(c.id));
  assert.equal(new Set(guildHalls).size, 10, "every guild its own hall");
});

test("a mini card is light and keeps nothing tiny", () => {
  for (const c of CARDS) {
    const full = cardSvg(c.id), mini = cardSvg(c.id, { size: "mini" });
    assert.ok(nodes(mini) < nodes(full) * 0.75, `${c.key}: far fewer nodes (${nodes(mini)} of ${nodes(full)})`);
    for (const [, size] of mini.matchAll(/<text[^>]*font-size="([\d.]+)"/g)) assert.ok(+size >= 8, `${c.key}: mini text ${size} units`);
    assert.doesNotMatch(mini, /<svg x=/, `${c.key}: no scene`);
  }
});

test("costs show one pip a unit and coins as a coin", () => {
  for (const c of CARDS) {
    const svg = cardSvg(c.id), units = c.cost.res.reduce((a, b) => a + b, 0) + (c.cost.coins ? 1 : 0);
    const effectRes = c.produce ? c.produce.flat().length : c.trade ? c.trade.kinds.length : 0;
    const res = (svg.match(/class="sc-f-(wood|stone|clay|ore|glass|cloth-dk|papyrus)"/g) || []).length;
    // every resource glyph has exactly one of these fills
    assert.equal(res, units - (c.cost.coins ? 1 : 0) + effectRes, `${c.key}: ${units} cost pips`);
    if (c.cost.coins) assert.ok(texts(svg).includes(String(c.cost.coins)), `${c.key}: its coin cost`);
  }
});

test("text is escaped in words and labels", () => {
  const card = CARDS[13], name = card.name;
  card.name = 'Odd <b> & "Well"';
  try {
    for (const size of ["full", "mini"]) {
      const svg = cardSvg(card.id, { size });
      assertWellFormed(svg, "odd name");
      assert.ok(svg.includes("Odd &lt;b&gt; &amp; &quot;Well&quot;"), `${size}: escaped`);
    }
  } finally {
    card.name = name;
  }
});

test("the backs show their age, and guilds share age III's", () => {
  for (const age of [1, 2, 3]) {
    for (const size of ["full", "mini"]) {
      const svg = cardBack(age, { size });
      assertWellFormed(svg, `back ${age}`);
      assertSelfContained(svg, `back ${age}`);
      assertColoursDefined(svg, `back ${age}`);
      assert.match(svg, new RegExp(`class="sc-card sc-back sc-c-back${age}${size === "mini" ? " sc-mini" : ""}"`));
      assert.ok(texts(svg).includes(["", "I", "II", "III"][age]));
    }
    assert.equal((cardBack(age).match(/class="sc-f-lamp"/g) || []).length, age * 3, `${age} lantern(s), each with its glow`);
  }
  assert.equal(cardBack(0), cardBack(1));
  assert.equal(cardBack(9), cardBack(3));
});

test("the icons are whole svgs in a 24-unit box", () => {
  const icons = [
    ...RESOURCES.map((r) => resourceIcon(r)),
    ...SYMBOLS.map((_, s) => scienceIcon(s)),
    scienceIcon("any"),
    coinIcon(),
    coinIcon(3),
    shieldIcon(),
    pointsIcon(7),
    neighbourIcon("left"),
    neighbourIcon("right"),
    ...COLORS.map((c) => colourIcon(c)),
  ];
  for (const svg of icons) {
    assertWellFormed(svg, svg.slice(0, 80));
    assertSelfContained(svg, svg.slice(0, 80));
    assertColoursDefined(svg, svg.slice(0, 80));
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="sc-icon sc-icon-[\w-]+" viewBox="-12 -12 24 24" role="img" aria-label="[^"]+">/);
  }
  assert.equal(new Set(icons).size, icons.length, "every icon its own");
  assert.ok(texts(pointsIcon(7)).includes("7") && texts(coinIcon(3)).includes("3"));
  assert.notEqual(neighbourIcon("left"), neighbourIcon("right"));
  for (const c of CARDS) {
    const svg = effectIcon(c.id);
    assertWellFormed(svg, `effect ${c.key}`);
    assertColoursDefined(svg, `effect ${c.key}`);
  }
});

test("the words say what each card does", () => {
  assert.equal(cardText(CARDS.find((c) => c.key === "olive-press").id), "Olive Press, age II yellow card. Free to build. 1 coin now for each brown card in your and your neighbours' cities.");
  assert.match(cardText(CARDS.find((c) => c.key === "east-road").id), /from your right neighbour \(east\) for 1 coin/);
  assert.match(cardText(CARDS.find((c) => c.key === "sanctuary").id), /Costs 1 wood, 1 clay and 1 glass\. Worth 3 points\. Free if you have Shrine\. Makes Temple of All free\.$/);
  assert.match(cardText(CARDS.find((c) => c.key === "tacticians-guild").id), /1 point at the end for each defeat token in your neighbours' cities/);
  for (const c of CARDS) assert.doesNotMatch(cardText(c.id), /undefined|NaN|\s\s/);
});

test("the CSS defines the same tokens for light and dark, under its own prefix", () => {
  const names = (b) => Object.keys(b);
  assert.deepEqual(names(THEMES.media), names(THEMES.light));
  assert.deepEqual(names(THEMES.dark), names(THEMES.light));
  assert.deepEqual(THEMES.media, THEMES.dark);
  // pieces.js owns --sc-p-* and sc-pf-*/sc-ps-*
  assert.doesNotMatch(CSS, /--sc-p-|\.sc-p[fs]-/);
});

// WCAG AA: 4.5:1 for words and numbers, 3:1 for symbols, in both themes.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
test("names and numbers meet WCAG AA on every colour, light and dark", () => {
  const pairs = [
    ...[...COLORS, "back1", "back2", "back3"].map((c) => ["cream", `${c}-4`, 4.5]),
    ...["back1", "back2", "back3"].map((c) => ["cream", `${c}-3`, 4.5]),
    ["ink", "gold", 4.5],
    ["ink", "cream", 4.5],
    ["coin-ink", "coin", 4.5],
    ["crown-ink", "crown", 4.5],
    ["defeat-lt", "defeat", 4.5],
    ["muted", "cream", 3],
    ["arrow", "cream", 3],
  ];
  for (const theme of ["light", "dark"]) {
    for (const [fg, bg, min] of pairs) {
      const ratio = contrast(THEMES[theme][fg], THEMES[theme][bg]);
      assert.ok(ratio >= min, `${theme}: --sc-${fg} on --sc-${bg} is ${ratio.toFixed(2)}:1, under ${min}:1`);
    }
  }
});
