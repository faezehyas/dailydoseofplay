// Headless-browser test for Hearts: four friends in four browsers fill a
// room from the invite link (the host's Start button is ready from three),
// pass three cards each in secret, play a whole hand and see it audited, then
// play a rematch until one of them leaves. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";
import { state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./hearts.shared.js";

const skip = skipWithoutPlaywright();

// A card in a fanned hand shows only its left edge: tap there.
const EDGE = { x: 6, y: 40 };

test("four friends play Hearts in four browsers: a secret pass, a whole hand audited, a rematch, then one leaves", { skip, timeout: 420_000 }, async (t) => {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  // A laptop unless it's a phone.
  const open = (nickname, opts = {}) => openPage(nickname, { ...(!opts.phone && { viewport: { width: 1366, height: 900 } }), reducedMotion: "reduce", nickname, ...opts });
  // The host picks one hand a game, so a whole game is one hand.
  const host = await open("Ada");
  await host.goto(`${srv.base}/hearts/`);
  await pick(host, "target", 0);
  const friends = [];
  for (const [name, opts] of [["Bo", { phone: true, colorScheme: "dark" }], ["Cy", {}], ["Di", {}]]) {
    const page = await open(name, opts);
    await joinByInvite(host, page, srv);
    friends.push(page);
    if (friends.length === 1) {
      await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
      assert.ok(await host.locator("#start-game").isDisabled(), "two can't play Hearts");
    }
    if (friends.length === 2) {
      // Three in: the Start button could start a three-player game now.
      await host.locator("#roster li.ready", { hasText: "Cy" }).waitFor();
      assert.match(await host.locator("#start-game").innerText(), /3 players/);
      assert.ok(await host.locator("#start-game").isEnabled());
    }
  }
  // The fourth fills the room, which starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  for (const [seat, p] of pages.entries()) {
    // The next player sits on your left, then across, then on your right; colours follow the seat everywhere.
    const shown = await p.locator(".pc-seat").evaluateAll((els) => els.map((e) => [Number(e.dataset.seat), [...e.classList].find((c) => c.startsWith("pos-"))]));
    assert.deepEqual(shown, [[(seat + 1) % 4, "pos-left"], [(seat + 2) % 4, "pos-top"], [(seat + 3) % 4, "pos-right"]]);
    assert.equal(await p.locator(".pc-trick-spot.pos-bottom.p-" + seat).count(), 1, "your card lands in front of you");
    assert.equal(await p.locator(".pc-seat.p-1, .pc-me.p-1").count(), 1);
    await waitForState(p, () => document.querySelectorAll(".hr-hcard").length === 13);
  }
  assert.match(await host.locator("#hr-config").innerText(), /^One hand a game · pass three/);
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");

  // Everyone picks three; the first three to pick wait for the fourth, and nobody receives before.
  const st0 = await state(host);
  assert.equal(st0.phase, "pass");
  const order = [0, 1, 2, 3].map((k) => (st0.opener + k) % 4);
  const picks = [];
  for (const seat of order.slice(0, 3)) {
    const p = pages[seat];
    await waitForState(p, () => document.querySelectorAll(".hr-hcard.pickable").length === 13);
    const slots = (await p.locator(".hr-hcard").evaluateAll((els) => els.map((e) => Number(e.dataset.slot)))).slice(0, 3);
    for (const s of slots) await p.locator(`.hr-hcard[data-slot="${s}"]`).click({ position: EDGE });
    assert.match(await p.locator("#hr-pass").innerText(), /Pass left/);
    await p.click("#hr-pass");
    picks[seat] = slots;
    await waitForState(p, (ddp, n) => ddp.match.state.picks.filter(Boolean).length >= n, picks.filter(Boolean).length);
  }
  for (const p of pages) assert.deepEqual((await state(p)).received.flat(), [], "nobody has received yet");
  // The last picker uses the keyboard: Enter on three cards, then P.
  const last = pages[order[3]];
  await waitForState(last, () => document.querySelectorAll(".hr-hcard.pickable").length === 13);
  await last.locator(".hr-hcard").first().focus();
  for (let k = 0; k < 3; k++) {
    await last.keyboard.press("Enter");
    await waitForState(last, (_, n) => document.querySelectorAll(".hr-hcard.picked").length === n, k + 1, { timeout: 5_000 });
    await last.keyboard.press("ArrowRight");
  }
  assert.equal(await last.locator(".hr-hcard.picked").count(), 3);
  await host.screenshot({ path: `${ARTIFACTS}/hr-1-four-pass.png` });
  await last.keyboard.press("p");
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.state.phase !== "pass", undefined, { timeout: 30_000 });
  // Each seat holds what its right-hand neighbour passed, and reads it once its envelopes are open; nobody else does.
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.state.received[ddp.match.me].every((s) => ddp.match.face(s) !== null));
  const st1 = await state(host);
  for (let seat = 0; seat < 4; seat++) {
    const from = (seat + 3) % 4;
    if (picks[from]) assert.deepEqual(st1.picks[from], picks[from]);
    assert.ok(st1.received[seat].every((s) => st1.picks[from].includes(s)), "what's left of the pass is what the neighbour picked");
    for (const s of st1.received[seat]) {
      // Unless it's already been played (the 2 of clubs), open to all.
      if (await host.evaluate((x) => window.ddp.match.slots[x].open, s)) continue;
      const known = await Promise.all(pages.map((p) => p.evaluate((x) => window.ddp.match.face(x), s)));
      known.forEach((f, k) => assert.equal(f !== null, k === seat || k === from, `seat ${k} reads slot ${s} passed from ${from} to ${seat}`));
    }
  }
  // The cards passed to you are marked (the 2 of clubs may already have gone to the first trick).
  for (const p of pages) await waitForState(p, (ddp) => document.querySelectorAll(".hr-hcard.received").length === ddp.match.state.received[ddp.match.me].length);
  // A seat's only legal card plays by itself (the 2 of clubs, then a lone club), and may be a passed one: count them all at one moment.
  const [kept, unplayed] = await host.evaluate(() => {
    const st = window.ddp.match.state;
    const played = [...st.trick.map((x) => x.slot), ...st.won.flat()];
    return [st.received.flat().length, st.picks.flat().filter((s) => !played.includes(s)).length];
  });
  assert.equal(kept, unplayed, "every passed card not yet played is still marked as passed");

  await Promise.all(pages.map(autoplay));
  await waitForState(host, (ddp) => ddp.match.state.tricks >= 4 || ddp.match.phase !== "playing", undefined, { timeout: 120_000 });
  await friends[0].screenshot({ path: `${ARTIFACTS}/hr-2-four-mobile-dark.png`, fullPage: true });
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 240_000 });
  await Promise.all(pages.map(stopAutoplay));
  for (const p of pages) {
    assert.deepEqual(await leaks(p), [], "no seat knew another's card during play");
    assert.deepEqual(await domLeaks(p), []);
  }
  const states = await Promise.all(pages.map(state));
  for (const st of states.slice(1)) assert.deepEqual(st, states[0], "all four browsers end on the same state");
  const st = states[0];
  assert.equal(st.history.length, 1);
  assert.equal(st.history[0].raw.reduce((a, b) => a + b, 0), 26);
  for (const p of pages) {
    await waitForState(p, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
    assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
    await p.locator("#hr-sheet").waitFor();
    assert.match(await p.locator("#hr-verdict").innerText(), /Fair play verified/);
  }
  assert.deepEqual((await host.locator("#hr-sheet tfoot td").allInnerTexts()).map(Number), [0, 1, 2, 3].map((p) => st.scores[p]));
  assert.ok(await resultInView(friends[0]), "the score sheet fits a phone without scrolling");
  assert.ok(await resultInView(host), "and a laptop");
  await host.screenshot({ path: `${ARTIFACTS}/hr-3-four-over.png` });
  await friends[0].screenshot({ path: `${ARTIFACTS}/hr-4-four-over-mobile.png` });

  // A rematch: the scores carry on, as one hand a game adds up across rematches.
  for (const p of pages) await p.click("#rematch");
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing", undefined, { timeout: 60_000 });
  assert.deepEqual((await host.locator(".pb-score").innerText()).match(/-?\d+/g).map(Number), [0, 1, 2, 3].map((p) => st.scores[p]));
  await Promise.all(pages.map(autoplay));
  await waitForState(host, (ddp) => ddp.match.state.tricks >= 2 || ddp.match.phase !== "playing", undefined, { timeout: 90_000 });
  await Promise.all(pages.map(stopAutoplay));
  // Cy leaves: their key went with them, so this hand stops, and a robot takes their seat from the next.
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) {
    await waitForState(p, (ddp) => ddp.match.phase === "aborted" && ddp.match.abortSeat === 2);
    await p.locator("body", { hasText: "Cy left. Every card needs every player's key" }).waitFor();
    await p.locator(".pb-name", { hasText: "Cy (robot)" }).waitFor();
  }
  // The host leaves: the game is over for everyone.
  await host.close();
  for (const p of [friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Ada (left the game|.*lost)/);
    assert.match(await p.locator("#hr-ended").innerText(), /game is over for all 4 of you[\s\S]*Ada: -?\d+ points? \(left\)/);
    assert.match(await p.locator("#hr-ended").innerText(), /The game stopped before the end, so it wasn't checked\./);
  }
  assertNoErrors();
});
