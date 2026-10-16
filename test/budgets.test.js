// Page weight: the modules each page loads through static imports (from
// home.js or a game's main.js), and their bytes, stay within
// test/fixtures/budgets.json. The budgets are the size when they were set
// plus 10%; a failure names the module that grew most since. To set them
// again after a deliberate change:
//
//   UPDATE_BUDGETS=1 node --test test/budgets.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMPORT } from "./helpers.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const BUDGETS = new URL("./fixtures/budgets.json", import.meta.url);
const HEADROOM = 1.1;

// Each page's entry module, as a path in public/.
const PAGES = {
  home: "home.js",
  ...Object.fromEntries(
    readdirSync(PUBLIC)
      .filter((slug) => existsSync(path.join(PUBLIC, slug, "main.js")))
      .map((slug) => [slug, `${slug}/main.js`]),
  ),
};

// The modules entry loads through static imports, with their bytes.
function staticGraph(entry) {
  const seen = new Set([entry]);
  for (const file of seen) {
    for (const m of readFileSync(path.join(PUBLIC, file), "utf8").matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (spec) seen.add(spec.startsWith("/") ? spec.slice(1) : path.posix.join(path.posix.dirname(file), spec));
    }
  }
  return new Map([...seen].map((file) => [file, statSync(path.join(PUBLIC, file)).size]));
}

const graphs = Object.fromEntries(Object.entries(PAGES).map(([page, entry]) => [page, staticGraph(entry)]));
const total = (graph) => [...graph.values()].reduce((a, b) => a + b, 0);

if (process.env.UPDATE_BUDGETS) {
  const pages = Object.fromEntries(Object.entries(graphs).map(([page, g]) => [page, { modules: Math.ceil(g.size * HEADROOM), bytes: Math.ceil(total(g) * HEADROOM) }]));
  const modules = Object.fromEntries(Object.values(graphs).flatMap((g) => [...g]).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BUDGETS, `${JSON.stringify({ pages, modules }, null, 2)}\n`);
}

const budgets = JSON.parse(readFileSync(BUDGETS, "utf8"));

// The module of graph that grew most since the budgets were set (a new one from 0).
function grewMost(graph) {
  const growth = ([file, size]) => size - (budgets.modules[file] ?? 0);
  const [file, size] = [...graph].sort((a, b) => growth(b) - growth(a))[0];
  const before = budgets.modules[file];
  return before === undefined ? `${file} is new (${size} bytes)` : `${file} grew most (${before} → ${size} bytes)`;
}

for (const [page, graph] of Object.entries(graphs)) {
  test(`${page}: its modules and their bytes stay within budget`, () => {
    const budget = budgets.pages[page];
    assert.ok(budget, `${page} has no budget in test/fixtures/budgets.json`);
    assert.ok(graph.size <= budget.modules, `${page} loads ${graph.size} modules, over its budget of ${budget.modules}: ${grewMost(graph)}`);
    assert.ok(total(graph) <= budget.bytes, `${page} loads ${total(graph)} bytes of JavaScript, over its budget of ${budget.bytes}: ${grewMost(graph)}`);
  });
}
