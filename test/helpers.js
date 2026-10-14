import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createApp } from "../server/app.js";
import { rngFromSeed, sfc32 } from "../public/engine/rng.js";

// Start the real HTTP + signaling server in-process on a random port.
export async function startServer({ publicDir, allowedOrigins, clientIpHeader, appleTeamId, androidCertSha256, limits, now } = {}) {
  const { server, wss, signaling } = await createApp({ publicDir, allowedOrigins, clientIpHeader, appleTeamId, androidCertSha256, limits, now, log: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    wss,
    signaling,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// An import in a module's source: group 1 or 2 is a static import's
// specifier, group 3 a dynamic import()'s.
export const IMPORT = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

// ---------- browser tests ----------
// Playwright stays out of package.json: it is loaded on first use, from
// PLAYWRIGHT_MODULE, a local install or the global one.

export const ARTIFACTS = path.resolve("test-artifacts");

let playwright;
export function loadPlaywright() {
  if (playwright !== undefined) return playwright;
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"];
  try {
    candidates.push(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {}
  for (const c of candidates.filter(Boolean)) {
    try {
      return (playwright = require(c));
    } catch {}
  }
  return (playwright = null);
}

// A browser test's skip option: false, or why it can't run.
export const skipWithoutPlaywright = () => !loadPlaywright() && "Playwright not installed";

// What each page opened by openBrowser() reports when a wait times out.
const pageInfo = new WeakMap();

// A browser and a server for one test, both closed after it. open(name,
// options) gives a page in a context of its own; errors collects every page
// error and console error as "name: message".
export async function openBrowser(t, { server, browserType = process.env.BROWSER || "chromium", launch = {} } = {}) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer(server);
  const args = browserType === "chromium" ? ["--no-sandbox", "--disable-background-timer-throttling", "--autoplay-policy=no-user-gesture-required"] : [];
  const browser = await loadPlaywright()[browserType].launch({ ...launch, args: [...args, ...(launch.args ?? [])] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  // phone is a 360 × 740 touch screen; robotPace speeds robots up (1 is a
  // player's pace); seed makes Math.random and every robot seeded; clock
  // installs a fake clock before the first page loads; init is an init
  // script, or a list of them. Anything else goes to browser.newContext().
  async function open(name, { nickname, phone, viewport, colorScheme, reducedMotion, robotPace = 0.1, seed, clock, init = [], ...context } = {}) {
    const ctx = await browser.newContext({
      ...(phone && { viewport: { width: 360, height: 740 }, hasTouch: true }),
      ...(viewport && { viewport }),
      ...(colorScheme && { colorScheme }),
      ...(reducedMotion && { reducedMotion }),
      ...context,
    });
    await ctx.addInitScript((pace) => (globalThis.ddpRobotPace = pace), robotPace);
    if (seed !== undefined) await ctx.addInitScript(seedPage(seed));
    if (nickname) await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    for (const script of [init].flat()) await ctx.addInitScript(script);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    if (clock) await page.clock.install(clock === true ? undefined : clock);
    pageInfo.set(page, { test: t.name, errors });
    return page;
  }
  return { srv, browser, errors, open, assertNoErrors: () => assert.deepEqual(errors, []) };
}

// Waits until fn(window.ddp, arg), run in the page, is truthy and still is
// settle ms later, and returns it. On a timeout it fails with why, the
// match's phase, turn, move count and last event, the page errors, and a
// screenshot in test-artifacts/.
export async function waitForState(page, fn, arg, { timeout = 20_000, settle = 0, why = "" } = {}) {
  // Rebuilt here so the page gets window.ddp as the first argument.
  const check = new Function("arg", `return (${fn})(window.ddp, arg);`);
  const end = Date.now() + timeout;
  try {
    for (;;) {
      await page.waitForFunction(check, arg, { timeout: Math.max(1, end - Date.now()) });
      if (settle) await page.waitForTimeout(settle);
      const value = await page.evaluate(check, arg);
      if (value) return value;
    }
  } catch (err) {
    if (err.name !== "TimeoutError") throw err;
    const info = pageInfo.get(page) ?? { test: "browser-test", errors: [] };
    const shot = path.join(ARTIFACTS, `${info.test.replace(/[^\w-]+/g, "-").slice(0, 80)}-timeout.png`);
    mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const summary = await page
      .evaluate(() => {
        const m = window.ddp?.match;
        if (!m) return "no match";
        const st = m.state ?? {};
        const moves = Array.isArray(st.moves) ? st.moves.length : (st.moves ?? st.ply);
        const last = window.ddpEvents?.at(-1);
        return `phase ${m.phase}, turn ${st.turn}, moves ${moves}, last event ${last ? JSON.stringify(last.events).slice(0, 200) : "not recorded"}`;
      })
      .catch((e) => `page gone (${e.message.split("\n")[0]})`);
    throw new Error(`${why || "waitForState"} timed out after ${timeout} ms: ${fn}\n  ${summary}\n  errors: ${JSON.stringify(info.errors)}\n  screenshot: ${shot}`);
  }
}

// Every page's match, and every robot's in it, reached phase.
export async function waitForPhase(pages, phase = "over", options = {}) {
  await Promise.all(
    [pages].flat().map((p) =>
      waitForState(p, (ddp, ph) => ddp.match?.phase === ph && ddp.robots.every((r) => r.match?.phase === ph), phase, { why: `every match reaches ${phase}`, ...options }),
    ),
  );
}

// Waits until every page's match and every robot's give the same
// pick(match) (serialised), and returns it.
export async function waitForSameState(pages, pick = (m) => m.state, { timeout = 20_000 } = {}) {
  const read = new Function(`const pick = (${pick}); const d = window.ddp; return [d.match, ...d.robots.map((r) => r.match)].filter(Boolean).map((m) => JSON.stringify(pick(m)));`);
  const end = Date.now() + timeout;
  let seen;
  for (;;) {
    seen = (await Promise.all([pages].flat().map((p) => p.evaluate(read)))).flat();
    if (seen.every((s) => s === seen[0])) return JSON.parse(seen[0]);
    if (Date.now() > end) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`the pages never agreed on ${pick} within ${timeout} ms:\n  ${seen.map((s) => s.slice(0, 300)).join("\n  ")}`);
}

// The host opens a friend room (unless it has one) and each guest joins
// from the invite link.
export async function joinByInvite(host, guests, srv) {
  if (!(await host.locator("#room-code").isVisible())) await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const code = (await host.locator("#room-code").innerText()).trim();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  for (const guest of [guests].flat()) {
    await guest.goto(invite);
    await guest.click("#join-room");
  }
  return { code, invite };
}

// Records every "events" the page's matches emit, with a copy of the state
// right after, in window.ddpEvents: tests check what happened rather than
// race the next move. eventsSince(page, ply) is the records from the
// ply-th on.
export function recordEvents(page) {
  return page.evaluate(() => {
    if (window.ddpEvents) return;
    window.ddpEvents = [];
    const ddp = window.ddp;
    const watched = new WeakSet();
    const watch = (match) => {
      if (!match || watched.has(match)) return;
      watched.add(match);
      match.on("events", ({ player, move, events }) => window.ddpEvents.push({ m: match.m, player, move, events, state: structuredClone(match.state) }));
    };
    let match = ddp.match;
    watch(match);
    Object.defineProperty(ddp, "match", {
      configurable: true,
      enumerable: true,
      get: () => match,
      set(m) {
        match = m;
        watch(m);
      },
    });
  });
}

export const eventsSince = (page, ply = 0) => page.evaluate((n) => window.ddpEvents.slice(n), ply);

// An init script that seeds the page's Math.random and every robot's
// choices (robotRng() in engine/robot-pace.js), so a robot game plays the
// same every run.
export function seedPage(seed) {
  const s = JSON.stringify(String(seed));
  return `(() => {\n${sfc32}\n${rngFromSeed}\nMath.random = rngFromSeed(${s});\nglobalThis.ddpRobotSeed = ${s};\n})();`;
}

// The page doesn't scroll sideways.
export const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// Picks a game setting in the lobby card, opening its summary first.
export async function pick(page, name, value) {
  const id = await page.locator("details.settings").first().getAttribute("id");
  if (!(await page.locator(`#${id}[open]`).count())) await page.click(`#${id} > summary`);
  await page.click(`#${id} label:has(input[name="${id.replace(/-settings$/, "")}-${name}"][value="${value}"])`);
}
