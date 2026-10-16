// Turns the browser tests' JavaScript coverage into lcov and prints the share
// of lines run in each folder; given the unit tests' lcov, it counts a line
// run by either.
//
//   npm run coverage:browser
//   npm run coverage && npm run coverage:browser -- test-artifacts/unit.lcov
//
// BROWSER_COVERAGE=1 makes openBrowser() (test/helpers.js) save each page's
// V8 coverage in test-artifacts/coverage/. Only Chromium reports coverage,
// and only for pages: code in Web Workers (the card deck's worker) and in
// pages a test closes itself isn't counted. A line counts when it has a
// non-blank character and one of them ran; every JavaScript file in public/
// is listed, so one no page loaded shows 0. Writes test-artifacts/coverage.lcov.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COVERAGE = path.join(ROOT, "test-artifacts", "coverage");
const OUT = path.join(ROOT, "test-artifacts", "coverage.lcov");

const isSource = (rel) => rel.endsWith(".js") && !rel.endsWith(".test.js") && !rel.startsWith("test/") && !rel.startsWith("node_modules/");

const sources = new Map();
const source = (rel) => sources.get(rel) ?? sources.set(rel, readFileSync(path.join(ROOT, rel), "utf8")).get(rel);

// The numbers of a file's lines with a non-blank character.
const codeLines = (text) => text.split("\n").flatMap((line, i) => (line.trim() ? [i + 1] : []));

// Every file's lines that ran, by repo-relative path.
const ran = new Map();
const ranIn = (rel) => ran.get(rel) ?? ran.set(rel, new Set()).get(rel);

// One page's script: each function's ranges in order, inner ones (later)
// overwriting outer ones, give whether each character ran.
function addScript({ url, functions }) {
  const rel = path.posix.join("public", decodeURIComponent(new URL(url).pathname));
  if (!isSource(rel) || !existsSync(path.join(ROOT, rel))) return;
  const text = source(rel);
  const hit = new Uint8Array(text.length);
  const outerFirst = [...functions].sort((a, b) => a.ranges[0].startOffset - b.ranges[0].startOffset || b.ranges[0].endOffset - a.ranges[0].endOffset);
  for (const { ranges } of outerFirst) for (const r of ranges) hit.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
  const lines = ranIn(rel);
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") line++;
    else if (hit[i] && text[i].trim()) lines.add(line);
  }
}

for (const name of readdirSync(COVERAGE)) {
  if (name.endsWith(".json")) for (const script of JSON.parse(readFileSync(path.join(COVERAGE, name), "utf8"))) addScript(script);
}

// The unit tests' lcov (npm run coverage): its lines with a count above 0.
const unit = process.argv[2];
if (unit) {
  let rel;
  for (const line of readFileSync(unit, "utf8").split("\n")) {
    if (line.startsWith("SF:")) rel = path.relative(ROOT, line.slice(3)).split(path.sep).join("/");
    else if (line.startsWith("DA:") && isSource(rel) && !rel.startsWith("..")) {
      const [n, count] = line.slice(3).split(",").map(Number);
      if (count > 0) ranIn(rel).add(n);
    }
  }
}

const files = new Set([...readdirSync(path.join(ROOT, "public"), { recursive: true }).map((f) => path.posix.join("public", f.split(path.sep).join("/"))).filter(isSource), ...ran.keys()]);
const lcov = [];
const folders = new Map();
for (const rel of [...files].sort()) {
  const lines = codeLines(source(rel));
  const hits = ran.get(rel) ?? new Set();
  const covered = lines.filter((n) => hits.has(n)).length;
  lcov.push(`SF:${rel}`, ...lines.map((n) => `DA:${n},${hits.has(n) ? 1 : 0}`), `LF:${lines.length}`, `LH:${covered}`, "end_of_record");
  const dir = path.posix.dirname(rel);
  const folder = folders.get(dir) ?? folders.set(dir, { lines: 0, covered: 0 }).get(dir);
  folder.lines += lines.length;
  folder.covered += covered;
}
writeFileSync(OUT, `${lcov.join("\n")}\n`);

const pct = ({ lines, covered }) => `${((100 * covered) / (lines || 1)).toFixed(1)}%`;
const total = { lines: 0, covered: 0 };
console.log(`| Folder | Lines | Run | ${unit ? "Unit + browser" : "Browser"} |\n| --- | ---: | ---: | ---: |`);
for (const [folder, f] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
  total.lines += f.lines;
  total.covered += f.covered;
  console.log(`| ${folder} | ${f.lines} | ${f.covered} | ${pct(f)} |`);
}
console.log(`| **All** | ${total.lines} | ${total.covered} | ${pct(total)} |`);
console.log(`\nlcov: ${path.relative(ROOT, OUT)}`);
