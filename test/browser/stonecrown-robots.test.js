// Headless-browser test for Stonecrown: a game against two robots on a 360 px
// phone, from the lobby's settings to the "Fair play verified" result: picks
// made by touch (a card built, one bought from a neighbour, a wonder stage
// and a sale), a hand that shows only your cards, the sounds and the mute
// button, the move clock picking a card when time runs out, reduced motion,
// a rematch and dark mode, never scrolling sideways. Skips if Playwright is
// missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, waitForPhase, noHorizontalScroll, pick, recordEvents, eventsSince } from "../helpers.js";
import { state, resultInView, autoplay, stopAutoplay, played, leaks, watchLeaks, leaked, handShown, handHeld, coinsShown, recordLog, logLines } from "./stonecrown.shared.js";

const skip = skipWithoutPlaywright();

const myTurn = (page) => waitForState(page, () => !!document.querySelector(".stonecrown.my-turn") || window.ddp.match.phase !== "playing", undefined, { timeout: 120_000, why: "my pick" });

// What each card in your hand can do now: built as it stands (paid from your
// own production, or buying from a neighbour), or by a chain; and whether
// the next wonder stage can be raised.
const options = (page) =>
  page.evaluate(async () => {
    const { canBuild, canStage, designOf } = await import("/stonecrown/rules.js");
    const { CARDS } = await import("/stonecrown/cards.js");
    const m = window.ddp.match;
    const st = m.state;
    const buys = (b) => !!b && [...b.left, ...b.right].some((n) => n > 0);
    const cards = st.hands[m.me].map((slot) => {
      const id = designOf(st.players, m.face(slot));
      const b = canBuild(st, m.me, id);
      return { slot, name: CARDS[id]?.name, build: b.ok && (b.chain || b.purchases.length > 0), buy: !b.chain && buys(b.purchases[0]) };
    });
    return { cards, stage: canStage(st, m.me).ok };
  });

// Taps the card and then a button, and waits for the turn to resolve.
async function tapPick(page, slot, button) {
  const turn = await page.evaluate(() => `${window.ddp.match.state.age}:${window.ddp.match.state.round}`);
  assert.ok(await page.locator(button).isDisabled(), "nothing to do before a card is picked");
  await page.locator(`#sc-hand .sc-hcard[data-slot="${slot}"]`).tap();
  await page.locator(`#sc-hand .sc-hcard.sel[data-slot="${slot}"]`).waitFor();
  assert.ok(await noHorizontalScroll(page), "a picked card and its buttons fit the phone");
  const words = await page.locator(button).innerText();
  await page.locator(button).tap();
  await waitForState(page, (ddp, t) => `${ddp.match.state.age}:${ddp.match.state.round}` !== t || ddp.match.phase !== "playing", turn, { timeout: 60_000, why: "the turn resolves" });
  return words;
}

test("Stonecrown against two robots on a 360 px phone: picks by touch, a hidden hand, sounds, mute, the clock and a verified game", { skip, timeout: 600_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { phone: true, colorScheme: "light", clock: true, seed: "stonecrown-robots", init: () => (window.ddpSounds = []) });
  const heard = () => page.evaluate(() => window.ddpSounds.slice());

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="stonecrown"] h2 a, .game-card[data-slug="stonecrown"]');
  await page.locator("#play-robot").waitFor();
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 30);
  await page.click('label:has(input[name="sc-players"][value="3"])');
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/sc-1-settings-mobile.png`, fullPage: true });
  assert.equal(await page.locator("#play-robot").innerText(), "Play vs 2 robots");
  await page.tap("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  await watchLeaks(page);
  await recordEvents(page);
  await recordLog(page);
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot 1[\s\S]*Robot 2/);
  assert.equal(await page.locator("#sc-config").innerText(), "A sides · 30 s a move · Hard robots");
  assert.ok(await noHorizontalScroll(page), "the table, your hand and both neighbours fit a 360 px phone");

  // The first pick, by touch: a card you can build, built.
  await myTurn(page);
  assert.equal((await state(page)).age, 1);
  assert.match(await page.locator("#sc-status").innerText(), /Pick a card/);
  assert.deepEqual(await handShown(page), await handHeld(page), "your hand shows your own seven cards");
  assert.equal((await handHeld(page)).length, 7);
  await page.screenshot({ path: `${ARTIFACTS}/sc-2-hand-mobile.png` });
  const first = (await options(page)).cards.find((c) => c.build && !c.buy) ?? (await options(page)).cards.find((c) => c.build);
  assert.ok(first, "something in the first hand can be built");
  await tapPick(page, first.slot, "#sc-build");
  assert.ok((await state(page)).city[0].some((c) => c.slot === first.slot), `${first.name} is in your city`);
  await page.locator("#sc-log li", { hasText: `You build ${first.name}` }).first().waitFor({ state: "attached" });
  const sounds = await heard();
  for (const name of ["deal", "turn", "tap", "pick", "reveal", "build"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);

  // A card bought from a neighbour, a wonder stage and a sale, each by touch, as the hands allow.
  const done = { buy: null, stage: null, sell: null };
  for (let turn = 0; turn < 14 && !(done.buy && done.stage && done.sell); turn++) {
    await myTurn(page);
    if ((await state(page)).phase !== "pick") continue;
    const { cards, stage } = await options(page);
    const buy = !done.buy && cards.find((c) => c.build && c.buy);
    if (buy) {
      const words = await tapPick(page, buy.slot, "#sc-build");
      assert.match(words, /Robot [12]/, "the build button says which neighbour is paid");
      done.buy = buy;
      continue;
    }
    if (!done.stage && stage) {
      done.stage = cards[0];
      const words = await tapPick(page, cards[0].slot, "#sc-stage");
      assert.match(words, /^Wonder stage I\b/);
      continue;
    }
    if (!done.sell && (turn >= 3 || done.stage)) {
      done.sell = cards[0];
      await tapPick(page, cards[0].slot, "#sc-sell");
      continue;
    }
    const any = cards.find((c) => c.build) ?? cards[0];
    await tapPick(page, any.slot, any.build ? "#sc-build" : "#sc-sell");
  }
  t.diagnostic(`by touch: ${JSON.stringify(done)}`);
  const events = (await eventsSince(page)).flatMap((r) => r.events);
  assert.ok(done.sell && events.some((e) => e.type === "discard" && e.p === 0 && e.slot === done.sell.slot && !e.seventh), "you sold a card");
  await page.locator("#sc-log li", { hasText: `You sell ${done.sell.name} for 3 coins` }).first().waitFor({ state: "attached" });
  assert.ok(done.stage && events.some((e) => e.type === "stage" && e.p === 0 && e.slot === done.stage.slot && e.n === 0), "you raised your wonder's first stage");
  await page.locator("#sc-log li", { hasText: `You build wonder stage I, tucking ${done.stage.name}` }).first().waitFor({ state: "attached" });
  assert.ok(done.buy, "a hand held a card to buy from a neighbour");
  const bought = events.find((e) => e.type === "build" && e.p === 0 && e.slot === done.buy.slot);
  assert.ok(bought && bought.bought.left + bought.bought.right > 0, "and the build paid a neighbour");
  await page.locator("#sc-log li", { hasText: new RegExp(`^You build ${done.buy.name} \\(paid .*Robot [12]`) }).first().waitFor({ state: "attached" });
  await coinsShown(page);
  for (const name of ["stage", "sell", "pass"]) assert.ok((await heard()).includes(name), `played ${name}`);

  // Muted: nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const quiet = (await heard()).length;
  const moves = (await state(page)).moves;
  await autoplay(page, { level: "hard" });
  await waitForState(page, (ddp, n) => ddp.match.state.moves > n + 6 || ddp.match.phase !== "playing", moves, { timeout: 120_000 });
  await stopAutoplay(page);
  assert.equal((await heard()).length, quiet, "no sound while muted");
  await page.click("#sound-toggle");

  // The clock: leave a pick alone and a card is picked for you.
  await waitForState(page, () => !!document.querySelector(".stonecrown.my-turn #sc-timer.p-0:not([hidden])"), undefined, { timeout: 120_000, why: "my clock runs" });
  assert.equal(await page.locator("#sc-timer").getAttribute("aria-label"), "Time for your pick");
  const from = await page.evaluate(() => `${window.ddp.match.state.age}:${window.ddp.match.state.round}:${window.ddp.match.state.phase}`);
  await page.screenshot({ path: `${ARTIFACTS}/sc-3-timer-mobile.png` });
  await page.clock.fastForward("00:31");
  await waitForState(page, (ddp) => ddp.match.step?.commits[ddp.match.me] || !document.querySelector(".stonecrown.my-turn"), undefined, { timeout: 15_000, why: "a card picked for me" });
  await page.locator("#toast", { hasText: "Time's up" }).waitFor({ state: "attached" });
  await waitForState(page, (ddp, f) => `${ddp.match.state.age}:${ddp.match.state.round}:${ddp.match.state.phase}` !== f, from, { timeout: 30_000, why: "the turn the clock picked for resolves" });

  // The rest at speed, with reduced motion.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await autoplay(page, { level: "hard" });
  await waitForState(page, (ddp) => ddp.match.phase === "over", undefined, { timeout: 300_000 });
  await stopAutoplay(page);
  // The last move reaches each robot's table after mine: wait for theirs to end too.
  await waitForPhase(page);
  const st = await state(page);
  for (let k = 0; k < 2; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  assert.deepEqual(await leaked(page), [], "no match on the page ever knew a hidden card it shouldn't");
  assert.deepEqual(await leaks(page), []);
  assert.deepEqual(await handShown(page), await handHeld(page));
  const { played: kinds, direct } = await played(page);
  t.diagnostic(`${st.moves} moves, won by ${st.winners.join(" and ")}; played ${JSON.stringify(kinds)}`);
  assert.deepEqual(direct, [], "every move through the page's own controls");
  await page.locator("#result").waitFor();
  assert.match(await page.locator("#result").innerText(), /^(You won|Robot \d won)$|draw|tie|share/i);
  await page.locator("#sc-verdict.ok").waitFor({ timeout: 60_000 });
  assert.match(await page.locator("#sc-verdict").innerText(), /Fair play verified/);
  assert.equal(await page.locator("#sc-sheet thead th[scope=col]").count(), 4, "a column a player on the score sheet, and one for the rows");
  const totals = (await page.locator("#sc-sheet tfoot td").allInnerTexts()).map(Number);
  assert.equal(totals[0], Math.max(...totals), "the sheet starts with the best total");
  assert.equal(Number(await page.locator("#sc-sheet tfoot td.best").first().innerText()), totals[0], "the winner's total stands out");
  const all = await heard();
  for (const name of ["war", "score"]) assert.ok(all.includes(name), `played ${name}`);
  assert.ok(all.some((s) => /^(win|over|draw)-paper$/.test(s)), "the result chime, in its paper timbre");
  assert.ok(await resultInView(page), "the result fits the phone without scrolling");
  assert.ok(await noHorizontalScroll(page));
  const lines = await logLines(page);
  assert.ok(lines.some((l) => /^War/.test(l) || /war/i.test(l)), "the log tells the war");
  await page.screenshot({ path: `${ARTIFACTS}/sc-4-robot-over-mobile.png` });

  // The robots accept a rematch; dark mode still fits the phone.
  const m = await page.evaluate(() => window.ddp.match.m);
  await page.click("#rematch");
  await waitForState(page, (ddp, n) => ddp.match.m === n + 1 && ddp.match.phase === "playing", m, { timeout: 60_000 });
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/sc-5-robot-dark-mobile.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assertNoErrors();
});
