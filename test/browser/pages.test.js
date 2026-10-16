// Headless-browser test for the pages around the games: the web manifest
// parses, its icons load at their stated type and size, and its start_url
// opens the home page; the privacy page lists every localStorage key the code
// writes (read from public/ at test time); the 404 page is a 404 with the
// shared header and a way home. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { skipWithoutPlaywright, openBrowser } from "../helpers.js";

const skip = skipWithoutPlaywright();

test("the web manifest parses, its icons load at their type and size, and its start_url opens the home page", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("page", { viewport: { width: 360, height: 740 } });
  await page.goto(`${srv.base}/`);
  const href = await page.locator('link[rel="manifest"]').evaluate((link) => link.href);
  const manifest = await page.evaluate((href) => fetch(href).then((r) => r.json()), href);
  for (const field of ["name", "short_name", "start_url", "display", "icons"]) assert.ok(manifest[field], `the manifest has ${field}`);

  for (const icon of manifest.icons) {
    const src = new URL(icon.src, href).href;
    const loaded = await page.evaluate(async (src) => {
      const type = (await fetch(src)).headers.get("content-type");
      const img = new Image();
      img.src = src;
      await img.decode();
      return { type, size: `${img.naturalWidth}x${img.naturalHeight}` };
    }, src);
    assert.equal(loaded.type, icon.type, `${icon.src} is served as ${icon.type}`);
    if (icon.sizes === "any") assert.notEqual(loaded.size, "0x0", `${icon.src} draws`);
    else assert.equal(loaded.size, icon.sizes, `${icon.src} is ${icon.sizes}`);
  }

  const start = await page.goto(new URL(manifest.start_url, href).href);
  assert.equal(start.status(), 200, "start_url loads");
  await page.locator(".game-card h2 a").first().waitFor();
  assert.equal(await page.title(), manifest.name, "start_url is the home page");
  assertNoErrors();
});

// Every localStorage key the code writes: the first argument of each
// setItem() or store() call in public/, a string or a constant of its file.
// When it is a parameter of the function around it (store(key, …),
// gameSettings({ key })), its keys are what callers pass there.
function storedKeys() {
  const files = readdirSync("public", { recursive: true })
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && !f.includes("vendor"))
    .map((f) => ({ name: f, src: readFileSync(`public/${f}`, "utf8") }));
  const constant = (src, name) => src.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1];
  const keys = new Set();
  for (const { name, src } of files) {
    for (const { 1: arg, index } of src.matchAll(/(?<!function )(?:\.setItem|\bstore)\(\s*([\w"-]+)/g)) {
      const literal = arg.match(/^"(.+)"$/)?.[1] ?? constant(src, arg);
      if (literal) {
        keys.add(literal);
        continue;
      }
      const fn = [...src.slice(0, index).matchAll(/function (\w+)\(([^)]*)\)/g)].findLast(([, , params]) => new RegExp(`\\b${arg}\\b`).test(params))?.[1];
      assert.ok(fn, `public/${name}: can't tell which key ${arg} is`);
      const passed = files.flatMap(({ src }) => [...src.matchAll(new RegExp(`\\b${fn}\\(\\s*(?:\\{[^)]*?\\b${arg}: )?([\\w"-]+)`, "g"))].map(([, a]) => a.match(/^"(.+)"$/)?.[1] ?? constant(src, a)));
      for (const key of passed.filter(Boolean)) keys.add(key);
    }
  }
  return keys;
}

test("the privacy page lists every localStorage key the code writes", { skip, timeout: 60_000 }, async (t) => {
  const keys = storedKeys();
  for (const key of ["ddp-name", "ddp-settings", "ddp-lessons", "ddp-robot-record", "ddp-ttt-settings", "ddp-hearts-settings"]) assert.ok(keys.has(key), `found ${key} in the code`);
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("page", { viewport: { width: 360, height: 740 } });
  await page.goto(`${srv.base}/privacy/`);
  const listed = new Set(await page.locator("main code").allInnerTexts());
  for (const key of keys) assert.ok(listed.has(key), `the privacy page lists ${key}`);
  assertNoErrors();
});

test("the 404 page is a 404, with the shared header and a way home", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, errors, assertNoErrors } = await openBrowser(t);
  const page = await open("page", { viewport: { width: 360, height: 740 } });
  const res = await page.goto(`${srv.base}/no-such-page/`);
  assert.equal(res.status(), 404);
  await page.locator("header").waitFor();
  assert.match(await page.locator("body").ariaSnapshot(), /^- banner:\n\s+- navigation "Site":\n\s+- link "Daily Dose of Play"/m, "the shared header");
  assert.equal(await page.getByRole("banner").getByRole("link", { name: "Daily Dose of Play" }).getAttribute("href"), "/");
  assert.equal(await page.locator("main").getByRole("link", { name: "See all games" }).getAttribute("href"), "/", "a way home in the page itself");
  // The page's own status is logged as a console error.
  assert.deepEqual(errors.splice(0).filter((e) => !e.endsWith("status of 404 (Not Found)")), []);
  assertNoErrors();
});
