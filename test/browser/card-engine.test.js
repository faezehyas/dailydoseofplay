// Headless-browser test of the card engine (public/engine/card-match.js):
// four robots play the test card game from test/fixtures in one page, as a
// robot game would, under the site's real security headers. The deck's
// WebAssembly must load in its Web Worker, every audit must pass, and the
// page's own thread must stay free while the deck is shuffled.
//
//   node --test test/browser/card-engine.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skipWithoutPlaywright, openBrowser } from "../helpers.js";

const skip = skipWithoutPlaywright();
const FIXTURE = readFileSync(new URL("../fixtures/toy-cards.js", import.meta.url), "utf8").replaceAll("../../public/engine/", "/engine/");

test("four robots play a card game in one page, with the deck in a Web Worker", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("page");
  const workers = [];
  page.on("worker", (w) => workers.push(w.url()));
  // The test game isn't part of the site: serve it from the same origin for this page only.
  await page.route("**/__test__/toy-cards.js", (route) => route.fulfill({ contentType: "text/javascript", body: FIXTURE }));
  await page.goto(`${srv.base}/`);

  const result = await page.evaluate(async () => {
    const { localRoom } = await import("/engine/room.js");
    const { startCardRobot } = await import("/engine/card-match.js");
    const toy = await import("/__test__/toy-cards.js");
    // How long the page's thread was ever busy: its long tasks, and how late a 10 ms timer fired.
    let longest = 0;
    new PerformanceObserver((list) => list.getEntries().forEach((e) => (longest = Math.max(longest, e.duration)))).observe({ type: "longtask" });
    let late = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      late = Math.max(late, now - last - 10);
      last = now;
    }, 10);
    const t0 = performance.now();
    const rules = toy.makeRules({ deckSize: 52, hand: 7, maxTurns: 30 });
    const sessions = localRoom({ game: "cards", names: ["A", "B", "C", "D"] });
    const robots = sessions.map((s) => startCardRobot(s, { rules, choose: toy.chooseMove, delay: 0 }));
    let started = 0;
    robots[0].match.on("start", () => (started = performance.now() - t0));
    while (!robots.every((r) => r.match.verdict || r.match.phase === "aborted")) await new Promise((r) => setTimeout(r, 20));
    clearInterval(timer);
    return {
      verdicts: robots.map((r) => r.match.verdict ?? r.match.abortReason),
      agree: robots.every((r) => JSON.stringify(r.match.state) === JSON.stringify(robots[0].match.state)),
      startedMs: Math.round(started),
      totalMs: Math.round(performance.now() - t0),
      longestTaskMs: Math.round(longest),
      timerLateMs: Math.round(late),
    };
  });
  t.diagnostic(`deck ready after ${result.startedMs} ms, game and audit done after ${result.totalMs} ms; longest task ${result.longestTaskMs} ms, timer up to ${result.timerLateMs} ms late`);
  assertNoErrors();
  assert.deepEqual(result.verdicts, [{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
  assert.ok(result.agree, "every seat ends with the same state");
  assert.deepEqual(workers.map((u) => new URL(u).pathname), ["/engine/deck-worker.js"], "one deck worker for the whole page");
  // Seconds of shuffling and proofs happen in the worker, so the page's thread stays free.
  assert.ok(result.longestTaskMs < 200, `a ${result.longestTaskMs} ms task blocked the page`);
  assert.ok(result.timerLateMs < 200, `a timer fired ${result.timerLateMs} ms late`);
});

test("a proof that crashes the deck worker is blamed on its input, and the jobs behind it run on a fresh worker", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open } = await openBrowser(t);
  const page = await open("page");
  const workers = [];
  page.on("worker", (w) => workers.push(w.url()));
  await page.goto(`${srv.base}/`);
  const result = await page.evaluate(async () => {
    const { deckService, DeckError } = await import("/engine/deck-service.js");
    const deck = deckService();
    const ctx = (s) => `crash/${s}`;
    const keys = await Promise.all([0, 1].map((s) => deck.keygen(ctx(s))));
    const { joint } = await deck.joinKeys(keys.map((k, s) => ({ hello: k.hello, context: ctx(s) })));
    const cards = await deck.newDeck(10);
    const { proof } = await deck.shuffle(joint, keys[0].secret, cards);
    const bad = proof.slice();
    bad[2268] = 255; // traps the module (see public/engine/deck-crash.test.js)
    const crash = deck.verifyShuffle(joint, 0, cards, bad).then(
      () => "accepted",
      (e) => (e instanceof DeckError ? `DeckError crashed=${e.crashed}` : `${e.name}: ${e.message}`),
    );
    const behind = deck.verifyShuffle(joint, 0, cards, proof).then((out) => out.length);
    return { crash: await crash, behind: await behind, after: (await deck.newDeck(3)).length };
  });
  assert.deepEqual(result, { crash: "DeckError crashed=true", behind: 10, after: 3 });
  assert.equal(workers.length, 2, "a fresh worker replaced the crashed one");
});
