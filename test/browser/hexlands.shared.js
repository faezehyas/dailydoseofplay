// Shared by the Hexlands browser tests: the page helpers.
export { bg, resultInView } from "./ludo.shared.js";

export const state = (page) => page.evaluate(() => window.ddp.match.state);

// Plays this page's choices through the page's own controls: what the robot
// at `level` would do, by tapping the spots on the island, the steppers and
// the buttons of the action panel. A choice two taps long (a build, then its
// spot) keeps its move between ticks. Moves the page makes for you (Monopoly's
// give, showing point cards to win) are the page's. hold: phases left to the
// test (free roads are still placed); hoard: end every turn and turn down every offer, so cards pile up.
// window.__hxPlayed counts each kind of move played, window.__hxDirect any
// the controls couldn't make.
export function autoplay(page, { level = "medium", hold = [], hoard = false } = {}) {
  return page.evaluate(async ({ level, hold, hoard }) => {
    const { chooseMove } = await import("/hexlands/robot.js");
    const { resourceOf, devKind, counts } = await import("/hexlands/rules.js");
    clearInterval(window.__autoplay);
    window.__hxPlayed ??= {};
    window.__hxDirect ??= [];
    let plan = null;
    const $ = (sel) => document.querySelector(sel);
    const click = (sel) => {
      const node = typeof sel === "string" ? $(sel) : sel;
      if (!node || node.disabled) return false;
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    };
    const spot = (id) => click(`.hx-spot[data-spot="${id}"]`);
    // Steps a picker (discard, give, want, plenty) to these counts.
    const stepTo = (name, want) => {
      for (let r = 0; r < 5; r++) {
        for (let guard = 0; guard < 20; guard++) {
          const n = Number($(`#hx-${name}-pick .hx-stepper.r-${r} .hx-step-n`)?.textContent);
          if (n === want[r]) break;
          if (!click(`#hx-${name}-${n < want[r] ? "more" : "less"}-${r}`)) return false;
        }
      }
      return true;
    };
    const kindOf = (move) => Object.keys(move).find((k) => !["pay", "ms", "take", "want", "steal", "resource"].includes(k));
    const tick = () => {
      const m = window.ddp.match;
      if (!m || m.phase !== "playing" || !$(".hexlands.my-turn")) return;
      const st = m.state;
      if (hold.includes(st.phase) && !st.freeRoads) return;
      const face = (s) => m.face(s);
      const key = `${m.m}:${st.moves}:${st.phase}`;
      const hoarded = hoard && (st.phase === "answer" ? { decline: true } : st.phase === "main" && !st.freeRoads ? { end: true } : null);
      if (plan?.key !== key) plan = { key, move: hoarded || chooseMove(st, m.me, Math.random, face, { level }), tries: 0 };
      const { move } = plan;
      const kind = kindOf(move);
      if (++plan.tries > 25) {
        // The controls never offered it: play it directly, and say so.
        window.__hxDirect.push(`${st.phase}:${kind}`);
        plan.tries = -1e9;
        return m.play(move);
      }
      if (plan.tries === 1) window.__hxPlayed[`${st.phase}:${kind}`] = (window.__hxPlayed[`${st.phase}:${kind}`] ?? 0) + 1;
      const cardsFor = (slots) => counts(slots, face);
      if (st.phase === "setup") return spot(move.settle ?? move.road);
      if (move.roll) return click("#hx-roll");
      if (move.discard) return stepTo("discard", cardsFor(move.discard)) && click("#hx-discard");
      if (st.phase === "robber") {
        if (click(`#hx-victim-${move.steal}`)) return;
        return spot(move.robber);
      }
      if (move.accept) return click("#hx-accept");
      if (move.decline) return click("#hx-decline");
      if (move.partner !== undefined) return click(move.partner < 0 ? "#hx-calloff" : `#hx-partner-${move.partner}`);
      if (move.end) return click("#hx-end");
      if (move.buy) return click("#hx-build-dev");
      for (const [k, build] of [["road", "road"], ["settle", "settlement"], ["city", "city"]]) {
        if (move[k] === undefined) continue;
        if (spot(move[k])) return;
        if (st.freeRoads) return;
        return $(`#hx-build-${build}.on`) || click(`#hx-build-${build}`);
      }
      if (move.play !== undefined) {
        const dev = devKind(face(move.play));
        if (dev === "plenty" && $("#hx-plenty")) return stepTo("plenty", [0, 1, 2, 3, 4].map((r) => move.take.filter((t) => t === r).length)) && click("#hx-plenty");
        if (dev === "monopoly" && $("#hx-mono-0")) return click(`#hx-mono-${move.resource}`);
        if (dev === "knight" && click("#hx-knight-first")) return;
        return click(`.hx-dev.playable[data-kind="${dev}"]`);
      }
      if (move.bank || move.offer) {
        if (!$("#hx-tab-bank")) return click("#hx-trade");
        if (move.bank) {
          if (!$("#hx-tab-bank.on")) return click("#hx-tab-bank");
          const give = resourceOf(face(move.bank[0]));
          if (!$(`#hx-bank-give-${give}.on`)) return click(`#hx-bank-give-${give}`);
          if (!$(`#hx-bank-take-${move.take}.on`)) return click(`#hx-bank-take-${move.take}`);
          return click("#hx-bank-trade");
        }
        if (!$("#hx-tab-players.on")) return click("#hx-tab-players");
        return stepTo("give", cardsFor(move.offer)) && stepTo("want", move.want) && click("#hx-offer-send");
      }
    };
    window.__autoplay = setInterval(tick, 40);
  }, { level, hold, hoard });
}
export const stopAutoplay = (page) => page.evaluate(() => clearInterval(window.__autoplay));

// What autoplay played, by phase and kind, and what it had to play without the controls.
export const played = (page) => page.evaluate(() => ({ played: window.__hxPlayed ?? {}, direct: window.__hxDirect ?? [] }));

// Every face this page's match knows that it may not: a hidden card (not open,
// not spent) in someone else's hand or in the development pile.
export const leaks = (page) =>
  page.evaluate(() => {
    const m = window.ddp.match;
    return m.slots.flatMap((s, id) => (s.face !== null && !s.gone && !s.open && s.owner !== m.me ? [id] : []));
  });

// Watches every match on the page (yours and, in a robot game, each robot's)
// for a face it may not know, all game long: a steal shows the stolen card to
// the thief alone. leaked() is what it saw.
export function watchLeaks(page) {
  return page.evaluate(() => {
    window.__hxLeaks = [];
    clearInterval(window.__hxLeakWatch);
    window.__hxLeakWatch = setInterval(() => {
      for (const m of [window.ddp.match, ...(window.ddp.robots ?? []).map((r) => r.match)]) {
        if (!m?.slots || m.phase === "over") continue;
        m.slots.forEach((s, id) => {
          const leak = `${m.m}:${m.me}:${id}`;
          if (s.face !== null && !s.gone && !s.open && s.owner !== m.me && !window.__hxLeaks.includes(leak)) window.__hxLeaks.push(leak);
        });
      }
    }, 100);
  });
}
export const leaked = (page) => page.evaluate(() => window.__hxLeaks);

// Your hand as the page draws it matches your cards, and nobody else's:
// the five piles' counts, then the development cards by kind.
export const handShown = (page) =>
  page.evaluate(() => {
    const piles = [...document.querySelectorAll("#hx-hand .hx-pile[data-r]")].map((n) => Number(n.querySelector(".hx-count").textContent));
    const devs = [...document.querySelectorAll("#hx-hand .hx-dev")].flatMap((n) => Array(Number(n.querySelector(".hx-count")?.textContent.slice(1) ?? 1)).fill(n.dataset.kind)).sort();
    return { piles, devs };
  });
export const handHeld = (page) =>
  page.evaluate(async () => {
    const { counts, devKind } = await import("/hexlands/rules.js");
    const m = window.ddp.match;
    const face = (s) => m.face(s);
    return { piles: counts(m.state.hands[m.me], face), devs: m.state.devs[m.me].map((s) => devKind(face(s))).sort() };
  });

// The card counts each seat's pill shows, and the cards each seat holds.
export const seatCards = (page) =>
  page.evaluate(() => {
    const st = window.ddp.match.state;
    const shown = st.hands.map((_, p) => Number(document.querySelector(`.pb-who.p-${p} .hx-n.cards`)?.textContent));
    return { shown, held: st.hands.map((h) => h.length) };
  });

// Keeps every line the page's log ("What happened") ever showed, in its last
// wording (a card only you saw is named once its face arrives): the log
// itself keeps the latest 60. logLines() reads them, oldest first.
export function recordLog(page) {
  return page.evaluate(() => {
    const lines = [];
    const update = () => {
      for (const li of document.querySelectorAll("#hx-log li")) {
        const line = lines.find((l) => l.node === li);
        if (line) line.text = li.textContent;
        else lines.push({ node: li, text: li.textContent });
      }
    };
    window.__hxLog = lines;
    new MutationObserver(update).observe(document.querySelector("#hx-log"), { childList: true, subtree: true, characterData: true });
    update();
  });
}
export const logLines = (page) => page.evaluate(() => window.__hxLog.map((l) => l.text));
