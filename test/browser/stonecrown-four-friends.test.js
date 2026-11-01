// Headless-browser test for Stonecrown between friends: four browsers fill a
// room from the invite link, and three start one with the host's button,
// through the real server. Each plays a whole game to the end through its own
// page, every page ending on the same state, the same score sheet and "Fair
// play verified". All game long, nobody's match knows a card it shouldn't,
// and nobody's page names one, in its text, its labels or its log: another
// seat's hand or pick, a card tucked under a wonder or sold, the discard pile
// (unless you are digging through it), the guilds left out. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, recordEvents, eventsSince, noHorizontalScroll, pick } from "../helpers.js";
import { state, resultInView, autoplay, stopAutoplay, played, leaks, watchLeaks, leaked, scanned, handShown, handHeld, coinsShown, recordLog, logLines } from "./stonecrown.shared.js";

const skip = skipWithoutPlaywright();

async function room(t, names, { side = "A", phone = 1 } = {}) {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  // A laptop unless it's a phone.
  const open = (nickname, opts = {}) => openPage(nickname, { ...(!opts.phone && { viewport: { width: 1366, height: 900 } }), reducedMotion: "reduce", nickname, ...opts });
  const host = await open(names[0]);
  await host.goto(`${srv.base}/stonecrown/`);
  await pick(host, "side", side);
  const pages = [host];
  for (const [i, name] of names.slice(1).entries()) {
    const page = await open(name, i + 1 === phone ? { phone: true, colorScheme: "dark" } : {});
    await joinByInvite(host, page, srv);
    pages.push(page);
    await host.locator("#roster li.ready", { hasText: name }).waitFor();
    if (pages.length === 2) assert.ok(await host.locator("#start-game").isDisabled(), "two can't play Stonecrown");
  }
  if (names.length === 3) {
    assert.match(await host.locator("#start-game").innerText(), /3 players/);
    await host.click("#start-game");
  }
  // Four fill the room, which starts by itself.
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), names.map((_, i) => i));
  for (const p of pages) {
    await recordEvents(p);
    await recordLog(p);
    await watchLeaks(p, { dom: true });
  }
  return { pages, assertNoErrors };
}

// Plays to the end; checks every page agrees, the audit passed on each, and nobody saw or showed a hidden card.
async function playToTheEnd(t, pages, names) {
  for (const [i, p] of pages.entries()) await autoplay(p, { level: ["easy", "medium", "hard"][i % 3] });
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 400_000, why: "the game ends" });
  await Promise.all(pages.map(stopAutoplay));
  const states = await Promise.all(pages.map(state));
  for (const st of states.slice(1)) assert.deepEqual(st, states[0], "every browser ends on the same state");
  const st = states[0];
  assert.equal(st.players, names.length);
  for (const [i, p] of pages.entries()) {
    assert.deepEqual(await leaked(p), [], `${names[i]}'s match never knew, and their page never named, a hidden card that wasn't theirs to see`);
    assert.deepEqual(await leaks(p), []);
    const scans = await scanned(p);
    assert.ok(scans.scans > 20, `${names[i]}'s page was scanned while it knew cards it mustn't show: ${JSON.stringify(scans)}`);
    assert.deepEqual(await handShown(p), await handHeld(p), `${names[i]}'s hand shows their own cards`);
    await coinsShown(p);
    const { direct } = await played(p);
    assert.deepEqual(direct, [], "every move through the page's own controls");
  }
  const sheets = [];
  for (const [i, p] of pages.entries()) {
    await waitForState(p, (ddp) => ddp.match.verdict, undefined, { timeout: 90_000 });
    assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
    await p.locator("#sc-verdict.ok").waitFor();
    assert.match(await p.locator("#sc-verdict").innerText(), /Fair play verified/);
    if (st.winners.length === 1) assert.equal(await p.locator("#result").innerText(), i === st.winner ? "You won" : `${names[st.winner]} won`);
    sheets.push(await p.locator("#sc-sheet tfoot td").allInnerTexts());
    assert.equal(await p.locator("#sc-sheet thead th[scope=col]").count(), names.length + 1, "a column a player on the score sheet");
    assert.ok(await resultInView(p), "the result fits without scrolling");
  }
  for (const s of sheets.slice(1)) assert.deepEqual(s, sheets[0], "every page shows the same totals");
  t.diagnostic(`${names.length} players: ${st.moves} moves, ${st.winners.map((p) => names[p]).join(" and ")} won with ${sheets[0][0]}; wonders ${st.wonders.map((w) => `${w.w}${w.side}`).join(" ")}`);
  return st;
}

// A card tucked under a wonder or sold is named only in its owner's log;
// everyone else reads "a card" and a stage with nothing tucked named.
async function checkHiddenInLogs(pages, names) {
  const events = (await eventsSince(pages[0])).flatMap((r) => r.events);
  const sales = events.filter((e) => e.type === "discard" && !e.seventh);
  const stages = events.filter((e) => e.type === "stage");
  assert.ok(sales.length + stages.length > 0, "someone tucked or sold a card");
  for (const [p, page] of pages.entries()) {
    const lines = await logLines(page);
    for (const q of names.keys()) {
      if (q === p) continue;
      const theirSales = lines.filter((l) => l.startsWith(`${names[q]} sells `));
      assert.ok(theirSales.every((l) => l === `${names[q]} sells a card for 3 coins`), `${names[p]}'s log names none of ${names[q]}'s sales: ${JSON.stringify(theirSales)}`);
      const theirStages = lines.filter((l) => l.startsWith(`${names[q]} builds wonder stage`));
      assert.ok(theirStages.every((l) => !/tucking/.test(l)), `${names[p]}'s log names none of ${names[q]}'s tucked cards: ${JSON.stringify(theirStages)}`);
    }
    const mine = (type) => events.filter((e) => e.type === type && e.p === p && !e.seventh).length;
    assert.equal(lines.filter((l) => /^You sell (?!a card)/.test(l)).length, mine("discard"), `${names[p]}'s log names each card they sold`);
    assert.equal(lines.filter((l) => /^You build wonder stage [IV]+, tucking /.test(l)).length, mine("stage"), `${names[p]}'s log names each card they tucked`);
  }
}

test("four friends play Stonecrown in four browsers to the end: the same result, a verified game and no hidden card shown on any page", { skip, timeout: 600_000 }, async (t) => {
  const names = ["Ada", "Bo", "Cy", "Di"];
  const { pages, assertNoErrors } = await room(t, names, { side: "random" });
  const [host, phone] = pages;
  assert.equal(await host.locator("#sc-config").innerText(), "Mixed sides");
  assert.ok(await noHorizontalScroll(phone), "four players fit a 360 px phone");
  for (const p of pages) assert.equal(await p.locator(".pb-who").count(), 4);
  assert.equal(await host.locator("#sc-across").count(), 1, "with four, the player across sits in the top bar");

  await playToTheEnd(t, pages, names);
  await checkHiddenInLogs(pages, names);
  assert.ok(await noHorizontalScroll(phone));
  await host.screenshot({ path: `${ARTIFACTS}/sc-friends-over.png` });
  await phone.screenshot({ path: `${ARTIFACTS}/sc-friends-over-mobile-dark.png` });

  // The host leaves: the game is over for everyone.
  await host.close();
  for (const p of pages.slice(1)) await p.locator("#ended").waitFor({ timeout: 20_000 });
  assertNoErrors();
});

test("three friends play Stonecrown on B sides in three browsers: the same result and a verified game on every page", { skip, timeout: 480_000 }, async (t) => {
  const names = ["Ada", "Bo", "Cy"];
  const { pages, assertNoErrors } = await room(t, names, { side: "B", phone: 2 });
  assert.equal(await pages[0].locator("#sc-config").innerText(), "B sides");
  const st = await playToTheEnd(t, pages, names);
  assert.ok(st.wonders.every((w) => w.side === "B"));
  await checkHiddenInLogs(pages, names);
  assertNoErrors();
});
