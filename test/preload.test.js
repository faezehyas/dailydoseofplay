// Each game page preloads the engine modules its main.js imports, so the
// browser fetches them at once instead of one import level at a time, and
// shows its lobby while they load. The lists come from the real import graph,
// so they can't go stale: dynamic import()s load later and aren't preloaded.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMPORT } from "./helpers.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const GAMES = JSON.parse(readFileSync(path.join(PUBLIC, "games.json"), "utf8")).games.filter((g) => g.status === "ready");

// The engine modules main.js loads through static imports, as /engine/… paths.
function engineImports(slug) {
  const seen = new Set([`${slug}/main.js`]);
  for (const file of seen) {
    for (const m of readFileSync(path.join(PUBLIC, file), "utf8").matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      seen.add(spec.startsWith("/") ? spec.slice(1) : path.posix.join(path.posix.dirname(file), spec));
    }
  }
  return [...seen].filter((f) => f.startsWith("engine/")).map((f) => `/${f}`);
}

const preloads = (html) => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);

for (const { slug, name, description } of GAMES) {
  const html = readFileSync(path.join(PUBLIC, slug, "index.html"), "utf8");

  test(`${slug}: index.html preloads exactly the engine modules main.js imports`, () => {
    const wanted = engineImports(slug);
    const listed = preloads(html);
    const problems = [
      ...wanted.filter((href) => !listed.includes(href)).map((href) => `public/${slug}/index.html is missing  <link rel="modulepreload" href="${href}" />`),
      ...listed.filter((href) => !wanted.includes(href)).map((href) => `public/${slug}/index.html preloads ${href}, which main.js doesn't import: remove it`),
    ];
    assert.deepEqual(problems, []);
  });

  test(`${slug}: index.html shows the game's icon, title and description while the lobby loads`, () => {
    const icon = `<div class="lobby-icon" style="view-transition-name: icon-${slug}"><img src="/${slug}/icon.svg" alt="" /></div>`;
    const top = `<section id="lobby">\\s*<div class="card lobby-card">\\s*${icon}\\s*<h1>${name}</h1>\\s*<p class="tagline">([^<]*)</p>`;
    const found = html.match(new RegExp(top));
    assert.ok(found, `public/${slug}/index.html: the placeholder in #lobby starts with ${icon}, <h1>${name}</h1> (its name in games.json) and its tagline`);
    assert.equal(found[1].replaceAll("&amp;", "&"), description, `public/${slug}/index.html: the tagline is the game's description in games.json`);
    assert.match(html, /<noscript>/, `public/${slug}/index.html says the games need JavaScript`);
  });
}
