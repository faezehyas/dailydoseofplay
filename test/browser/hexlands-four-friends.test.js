// Headless-browser test for Hexlands between friends: four browsers fill a
// room from the invite link, and three start one with the host's button.
// Each plays a whole game to the end through its own page, every page ending
// on the same state, the same points and "Fair play verified"; nobody's page
// ever knows another's hidden card, and a robber's steal is named only to
// its thief and victim. In the four-player game one offer is made, answered
// and settled by hand. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, recordEvents, eventsSince, noHorizontalScroll, pick } from "../helpers.js";
import { state, resultInView, autoplay, stopAutoplay, played, leaks, watchLeaks, leaked, handShown, handHeld, recordLog, logLines } from "./hexlands.shared.js";

const skip = skipWithoutPlaywright();
const RES = ["wood", "brick", "wool", "grain", "ore"];

async function room(t, names, { target = 8, phone = 1 } = {}) {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  // A laptop unless it's a phone.
  const open = (nickname, opts = {}) => openPage(nickname, { ...(!opts.phone && { viewport: { width: 1366, height: 900 } }), reducedMotion: "reduce", nickname, ...opts });
  const host = await open(names[0]);
  await host.goto(`${srv.base}/hexlands/`);
  await pick(host, "target", target);
  const pages = [host];
  for (const [i, name] of names.slice(1).entries()) {
    const page = await open(name, i + 1 === phone ? { phone: true, colorScheme: "dark" } : {});
    await joinByInvite(host, page, srv);
    pages.push(page);
    await host.locator("#roster li.ready", { hasText: name }).waitFor();
    if (pages.length === 2) assert.ok(await host.locator("#start-game").isDisabled(), "two can't play Hexlands");
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
    await watchLeaks(p);
  }
  return { pages, assertNoErrors };
}

// Plays to the end; checks every page agrees, the audit passed on each, and nobody saw a hidden card.
async function playToTheEnd(t, pages, names) {
  for (const [i, p] of pages.entries()) await autoplay(p, { level: ["easy", "medium", "hard"][i % 3] });
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 300_000, why: "the game ends" });
  await Promise.all(pages.map(stopAutoplay));
  const states = await Promise.all(pages.map(state));
  for (const st of states.slice(1)) assert.deepEqual(st, states[0], "every browser ends on the same state");
  const st = states[0];
  assert.equal(st.players, names.length);
  for (const [i, p] of pages.entries()) {
    assert.deepEqual(await leaked(p), [], `${names[i]}'s page never knew a hidden card that wasn't theirs`);
    assert.deepEqual(await leaks(p), []);
    assert.deepEqual(await handShown(p), await handHeld(p), `${names[i]}'s hand shows their own cards`);
    const { direct } = await played(p);
    assert.deepEqual(direct, [], "every move through the page's own controls");
  }
  const sheets = [];
  for (const [i, p] of pages.entries()) {
    await waitForState(p, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
    assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
    await p.locator("#hx-verdict.ok").waitFor();
    assert.match(await p.locator("#hx-verdict").innerText(), /Fair play verified/);
    assert.equal(await p.locator("#result").innerText(), i === st.winner ? "You won" : `${names[st.winner]} won`);
    sheets.push(await p.locator("#hx-sheet tfoot td").allInnerTexts());
    assert.ok(await resultInView(p), "the result and its points sheet fit without scrolling");
  }
  for (const s of sheets.slice(1)) assert.deepEqual(s, sheets[0], "every page shows the same points");
  assert.ok(Number(sheets[0][0]) >= st.target, "the winner reached the target");
  t.diagnostic(`${names.length} players: ${st.moves} moves, ${names[st.winner]} won with ${sheets[0][0]}`);
  return st;
}

// Every steal is named to its thief ("You steal wool from Bo") and its victim
// ("Ada steals your wool"), and to everyone else is just a card.
async function checkSteals(pages, names) {
  const steals = (await eventsSince(pages[0])).flatMap((r) => r.events.filter((e) => e.type === "steal"));
  assert.ok(steals.length > 0, "the robber stole at least once");
  const faces = await pages[0].evaluate((slots) => slots.map((s) => window.ddp.match.face(s)), steals.map((e) => e.slot));
  for (const [p, page] of pages.entries()) {
    const lines = await logLines(page);
    const name = (q) => (q === p ? "You" : names[q]);
    let at = 0;
    for (const [k, { thief, victim }] of steals.entries()) {
      const res = RES[Math.floor(faces[k] / 19)];
      const want =
        p === thief ? [`You steal ${res} from ${names[victim]}`] : p === victim ? [`${names[thief]} steals your ${res}`, `${names[thief]} steals a card from you`] : [`${name(thief)} steals a card from ${name(victim)}`];
      const found = lines.findIndex((l, i) => i >= at && want.includes(l));
      assert.ok(found >= 0, `${names[p]}'s log: ${want[0]} (steal ${k + 1} of ${steals.length}) in ${JSON.stringify(lines.slice(at).filter((l) => /steal/.test(l)))}`);
      at = found + 1;
    }
    const involved = steals.filter((e) => e.thief === p || e.victim === p).length;
    const named = lines.filter((l) => new RegExp(`steals? (your )?(${RES.join("|")})`).test(l)).length;
    assert.ok(named <= involved, `${names[p]}'s log names only the cards of steals they were part of`);
  }
}

// One offer by hand: the host offers a card for one a friend holds, that
// friend accepts, the rest say no, and the host picks the friend.
async function tradeByHand(pages, names) {
  const [host] = pages;
  await stopAutoplay(host);
  await autoplay(host, { level: "medium", hold: ["main"] });
  let deal = null;
  for (let turn = 0; turn < 20 && !deal; turn++) {
    await waitForState(host, () => (document.querySelector(".hexlands.my-turn") && window.ddp.match.state.phase === "main" && !window.ddp.match.state.freeRoads) || window.ddp.match.phase !== "playing", undefined, { timeout: 120_000, why: "the host's main phase" });
    if ((await host.evaluate(() => window.ddp.match.phase)) !== "playing") return null;
    const mine = (await handHeld(host)).piles;
    const theirs = await Promise.all(pages.slice(1).map(async (p) => (await handHeld(p)).piles));
    const give = mine.findIndex((n) => n > 0);
    for (const [i, hand] of theirs.entries()) {
      const want = hand.findIndex((n, r) => n > 0 && r !== give);
      if (give >= 0 && want >= 0 && !deal) deal = { give, want, to: i + 1 };
    }
    if (!deal) {
      await host.click("#hx-end");
      await waitForState(host, () => !document.querySelector(".hexlands.my-turn"));
    }
  }
  assert.ok(deal, "the host gets a turn with a card to trade for one a friend holds");
  await Promise.all(pages.map(stopAutoplay));
  const { give, want, to } = deal;
  const before = await Promise.all([host, pages[to]].map(handHeld));
  await host.click("#hx-trade");
  await host.click("#hx-tab-players");
  await host.click(`#hx-give-more-${give}`);
  await host.click(`#hx-want-more-${want}`);
  assert.equal(await host.locator("#hx-give-pick legend").innerText(), `You give: 1 ${RES[give]}`);
  await host.screenshot({ path: `${ARTIFACTS}/hx-friends-offer.png` });
  await host.click("#hx-offer-send");
  for (const [q, p] of pages.entries()) {
    if (q === 0) continue;
    await p.locator("#hx-offer", { hasText: `${names[0]} offers` }).waitFor();
    if (q === to) await p.click("#hx-accept");
    else await p.click("#hx-decline", { timeout: 5000 }).catch(() => {}); // or turned down for them, if they lack the card
  }
  await host.locator(`#hx-partner-${to}`).waitFor();
  const answers = await host.locator("#hx-offer .hx-answers li .ans").allInnerTexts();
  assert.deepEqual(answers, pages.slice(1).map((_, i) => (i + 1 === to ? "Deal" : "No thanks")));
  await host.click(`#hx-partner-${to}`);
  for (const p of pages) await waitForState(p, () => window.ddp.match.state.phase === "main" && !window.ddp.match.state.trade);
  const after = await Promise.all([host, pages[to]].map(handHeld));
  assert.deepEqual(after[0].piles, before[0].piles.map((n, r) => n - (r === give) + (r === want)), "the host gave one and got one");
  assert.deepEqual(after[1].piles, before[1].piles.map((n, r) => n + (r === give) - (r === want)), "and the friend the other way");
  const line = (p) => `${p === 0 ? "You trade" : `${names[0]} trades`} 1 ${RES[give]} with ${p === to ? "you" : names[to]} for 1 ${RES[want]}`;
  for (const [p, page] of pages.entries()) await page.locator("#hx-log li", { hasText: line(p) }).first().waitFor({ state: "attached" });
  return deal;
}

test("four friends play Hexlands in four browsers to the end, with an offer settled by hand and a steal named only to its thief and victim", { skip, timeout: 480_000 }, async (t) => {
  const names = ["Ada", "Bo", "Cy", "Di"];
  const { pages, assertNoErrors } = await room(t, names);
  const [host, phone] = pages;
  assert.equal(await host.locator("#hx-config").innerText(), "Game to 8");
  assert.ok(await noHorizontalScroll(phone), "four players fit a 360 px phone");
  for (const p of pages) assert.equal(await p.locator(".pb-who").count(), 4);

  // A few rounds of play, then the offer.
  for (const [i, p] of pages.entries()) await autoplay(p, { level: ["easy", "medium", "hard"][i % 3] });
  await waitForState(host, (ddp) => ddp.match.state.phase !== "setup", undefined, { timeout: 120_000 });
  const deal = await tradeByHand(pages, names);
  assert.ok(deal, "the offer was made before the game ended");
  await phone.screenshot({ path: `${ARTIFACTS}/hx-friends-mobile-dark.png`, fullPage: true });

  await playToTheEnd(t, pages, names);
  await checkSteals(pages, names);
  await host.screenshot({ path: `${ARTIFACTS}/hx-friends-over.png` });
  await phone.screenshot({ path: `${ARTIFACTS}/hx-friends-over-mobile.png` });

  // The host leaves: the game is over for everyone.
  await host.close();
  for (const p of pages.slice(1)) await p.locator("#ended").waitFor({ timeout: 20_000 });
  assertNoErrors();
});

test("three friends play Hexlands to 10 in three browsers: the same result and a verified game on every page", { skip, timeout: 420_000 }, async (t) => {
  const names = ["Ada", "Bo", "Cy"];
  const { pages, assertNoErrors } = await room(t, names, { target: 10, phone: 2 });
  assert.equal(await pages[0].locator("#hx-config").innerText(), "Game to 10");
  await playToTheEnd(t, pages, names);
  await checkSteals(pages, names);
  assertNoErrors();
});
