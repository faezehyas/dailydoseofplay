// Shared by the Stonecrown browser tests: the page helpers.
import { waitForState } from "../helpers.js";
export { bg, resultInView } from "./ludo.shared.js";

export const state = (page) => page.evaluate(() => window.ddp.match.state);

// Plays this page's picks through the page's own controls: what the robot at
// `level` would do, by tapping the card in the hand (or in the discards while
// digging), "Other way to pay" until the robot's purchase is the one shown,
// then Build, Build free, Wonder stage, Sell for 3, or Build nothing, and
// Continue when the war scene waits for it. Moves
// the page makes for you (a dig with nothing to build) are the page's. hold:
// phases left to the test. window.__scPlayed counts each kind of move played,
// window.__scDirect any the controls couldn't make.
export function autoplay(page, { level = "medium", hold = [] } = {}) {
  return page.evaluate(
    async ({ level, hold }) => {
      const { chooseMove } = await import("/stonecrown/robot.js");
      const { canBuild, canStage, designOf } = await import("/stonecrown/rules.js");
      clearInterval(window.__autoplay);
      window.__scPlayed ??= {};
      window.__scDirect ??= [];
      let plan = null;
      const $ = (sel) => document.querySelector(sel);
      const click = (sel) => {
        const node = typeof sel === "string" ? $(sel) : sel;
        if (!node || node.disabled || node.hidden) return false;
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      };
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      const zero = [0, 0, 0, 0, 0, 0, 0];
      // How many taps on "Other way to pay" bring the page to this purchase: the page starts on the cheapest.
      const wayOf = (list, buy) => Math.max(0, list.findIndex((b) => same(b.left, buy?.left ?? zero) && same(b.right, buy?.right ?? zero)));
      const kindOf = (st, move, face) => {
        const bought = move.buy && [...move.buy.left, ...move.buy.right].some((n) => n > 0) ? "-bought" : "";
        if (move.dig !== undefined) return move.dig < 0 ? "nothing" : "dig";
        if (move.discard !== undefined) return "sell";
        if (move.stage !== undefined) return `stage${bought}`;
        if (move.free) return "build-free";
        return canBuild(st, window.ddp.match.me, designOf(st.players, face(move.build))).chain ? "build-chain" : `build${bought}`;
      };
      const tick = () => {
        // The war scene waits for Continue.
        if (click(".ws:not([hidden]) .ws-go")) return;
        const m = window.ddp.match;
        if (!m || m.phase !== "playing" || !$(".stonecrown.my-turn")) return;
        const st = m.state;
        if (hold.includes(st.phase)) return;
        const face = (s) => m.face(s);
        const key = `${m.m}:${st.age}:${st.round}:${st.phase}`;
        if (plan?.key !== key) {
          const move = chooseMove(st, m.me, Math.random, face, { level });
          if (!move) return;
          plan = { key, move, kind: kindOf(st, move, face), tries: 0, other: 0 };
        }
        const { move, kind } = plan;
        if (++plan.tries > 40) {
          // The controls never offered it: play it directly, and say so.
          window.__scDirect.push(`${st.phase}:${kind}`);
          plan.tries = -1e9;
          return m.play(move);
        }
        if (plan.tries === 1) {
          const name = `${st.phase}:${kind}`;
          window.__scPlayed[name] = (window.__scPlayed[name] ?? 0) + 1;
        }
        const slot = move.build ?? move.stage ?? move.discard ?? move.dig;
        if (slot >= 0) {
          const card = $(`#sc-hand .sc-hcard[data-slot="${slot}"]`);
          if (!card) return;
          if (!card.classList.contains("sel")) return click(card);
        } else return click("#sc-nothing");
        if (kind === "dig") return click("#sc-dig");
        if (kind === "sell") return click("#sc-sell");
        if (kind === "build-free") return click("#sc-free");
        if (kind.startsWith("stage")) {
          const ways = wayOf(canStage(st, m.me).purchases, move.buy);
          if (plan.other < ways) return click("#sc-other-stage") && plan.other++;
          return click("#sc-stage");
        }
        if (kind === "build-bought" || kind === "build") {
          const ways = wayOf(canBuild(st, m.me, designOf(st.players, face(slot))).purchases, move.buy);
          if (plan.other < ways) return click("#sc-other") && plan.other++;
        }
        return click("#sc-build");
      };
      window.__autoplay = setInterval(tick, 40);
    },
    { level, hold },
  );
}
export const stopAutoplay = (page) => page.evaluate(() => clearInterval(window.__autoplay));

// What autoplay played, by phase and kind, and what it had to play without the controls.
export const played = (page) => page.evaluate(() => ({ played: window.__scPlayed ?? {}, direct: window.__scDirect ?? [] }));

// Watches every match on the page (yours and, in a robot game, each robot's)
// for a card it may not know, all game long, on every update and event:
// a face known for a card not shown to everyone that this seat never held
// (someone else's hand, their pick, a tucked or sold card, the discards it
// never dug, the guilds left out). A card passed on stays known to the seat
// that passed it, as at a real table. With dom, the page itself is scanned
// too, its text, every label and attribute and the log: it may name only
// the cards in the cities, your own hand, the cards you tucked or sold, the
// discards while you dig through them, and what those cards chain with;
// never a card it knows that has gone where you can't see it (a hand you
// passed on, someone's pick, the discard pile). The page is judged against
// the game as it stands, so dom wants reduced motion: with animations, the
// hand you just passed on is still flying. leaked() is what it saw.
export function watchLeaks(page, { dom = false } = {}) {
  return page.evaluate(
    async ({ dom }) => {
      const { CARDS } = await import("/stonecrown/cards.js");
      const { designOf } = await import("/stonecrown/rules.js");
      window.__scLeaks = [];
      window.__scScans = { scans: 0, names: 0 };
      clearInterval(window.__scLeakWatch);
      const held = new WeakMap(); // match → slots its seat held
      window.__scHeld = held;
      const mineGone = new WeakMap(); // match → slots its seat tucked, sold or discarded
      const watched = new WeakSet();
      const note = (leak) => !window.__scLeaks.includes(leak) && window.__scLeaks.push(leak);
      const check = (m) => {
        if (!m?.slots || !m.state || m.phase === "over") return;
        const mine = held.get(m);
        m.slots.forEach((s, id) => s.owner === m.me && mine.add(id));
        m.slots.forEach((s, id) => {
          if (s.face !== null && !s.gone && !s.open && !mine.has(id)) note(`${m.m}:${m.me}:slot ${id}`);
        });
      };
      const watch = (m) => {
        if (!m?.on || watched.has(m)) return;
        watched.add(m);
        held.set(m, new Set());
        mineGone.set(m, new Set());
        m.on("update", () => (check(m), scanSoon(m)));
        m.on("events", ({ events }) => {
          for (const e of events) if ((e.type === "discard" || e.type === "stage") && e.p === m.me) mineGone.get(m).add(e.slot);
          check(m);
          scanSoon(m);
        });
        check(m);
      };
      const chainNames = (card) => [...CARDS.filter((c) => c.from.includes(card.key)), ...card.from.flatMap((k) => CARDS.filter((c) => c.key === k))].map((c) => c.name);
      const pattern = (name) => new RegExp(`(^|[^\\w'])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w'])`);
      const patterns = new Map(CARDS.map((c) => [c.name, pattern(c.name)]));
      const SKIP = new Set(["d", "points", "transform", "viewBox", "class", "style", "fill", "stroke", "cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "opacity", "xmlns", "stroke-width", "x1", "x2", "y1", "y2", "fill-opacity", "stroke-linecap", "stroke-linejoin", "font-size", "font-weight", "text-anchor", "dominant-baseline", "letter-spacing", "font-family", "stroke-dasharray", "stroke-opacity", "paint-order", "id", "tabindex", "type", "role", "hidden", "focusable", "aria-hidden", "aria-live", "aria-pressed", "dx", "dy"]);
      // The page's words: its text and every attribute but the drawing ones.
      const words = () => {
        const parts = [document.body.textContent];
        for (const n of document.body.querySelectorAll("*")) for (const a of n.attributes) if (!SKIP.has(a.name)) parts.push(a.value);
        return parts.join("\n");
      };
      // Where a name shows, for the report: the innermost element whose text has it, or an attribute.
      const shownAt = (re) => {
        const tag = (n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${n.classList.length ? `.${[...n.classList].join(".")}` : ""}`;
        for (const n of document.body.querySelectorAll("*")) {
          for (const a of n.attributes) if (!SKIP.has(a.name) && re.test(a.value)) return `${tag(n)}[${a.name}]`;
          if (re.test(n.textContent) && ![...n.children].some((c) => re.test(c.textContent))) return `${tag(n)} text`;
        }
        return "?";
      };
      const scanPage = (m) => {
        const st = m?.state;
        if (!st?.age || m.phase !== "playing") return;
        const des = (s) => designOf(st.players, m.face(s));
        const mine = held.get(m) ?? new Set();
        const ok = new Set([...st.hands[m.me], ...st.stages[m.me], ...mineGone.get(m)]);
        if (st.phase === "dig" && st.digger === m.me) st.discard.forEach((s) => ok.add(s));
        const okIds = new Set([...st.city.flat().map((c) => c.id), ...[...ok].map(des)]);
        const okNames = new Set([...okIds].filter((id) => id >= 0).flatMap((id) => [CARDS[id].name, ...chainNames(CARDS[id])]));
        const hidden = new Map();
        m.slots.forEach((s, id) => {
          if (s.face === null || s.gone || s.open || ok.has(id) || !mine.has(id)) return;
          const name = CARDS[des(id)]?.name;
          if (name && !okNames.has(name)) hidden.set(name, id);
        });
        if (!hidden.size) return;
        window.__scScans.scans++;
        window.__scScans.names += hidden.size;
        const text = words();
        for (const [name, id] of hidden) {
          if (!patterns.get(name).test(text)) continue;
          const where = st.hands.findIndex((h) => h.includes(id));
          const pile = where >= 0 ? `seat ${where}'s hand` : st.discard.includes(id) ? "the discards" : st.stages.findIndex((h) => h.includes(id)) >= 0 ? "a wonder" : "somewhere";
          note(`${m.m}:${m.me}:shows ${name} (slot ${id}, in ${pile}, age ${st.age} turn ${st.round} ${st.phase}) in ${shownAt(patterns.get(name))}`);
        }
      };
      // Once the page has drawn an update of its own match, and every 100 ms.
      let queued = false;
      function scanSoon(m) {
        if (!dom || queued || m !== window.ddp.match) return;
        queued = true;
        setTimeout(() => {
          queued = false;
          scanPage(window.ddp.match);
        }, 0);
      }
      const all = () => [window.ddp.match, ...(window.ddp.robots ?? []).map((r) => r.match)];
      window.__scLeakWatch = setInterval(() => {
        all().forEach(watch);
        all().forEach(check);
        if (dom) scanPage(window.ddp.match);
      }, 100);
      all().forEach(watch);
    },
    { dom },
  );
}
export const leaked = (page) => page.evaluate(() => window.__scLeaks);
// How often the page was scanned while it knew cards it mustn't show, and how many such cards it looked for in all.
export const scanned = (page) => page.evaluate(() => window.__scScans);

// Every face this page's match knows that isn't open and that its seat never
// held, now (watchLeaks() keeps what each seat held).
export const leaks = (page) =>
  page.evaluate(() => {
    const m = window.ddp.match;
    const mine = window.__scHeld?.get(m) ?? new Set();
    return m.slots.flatMap((s, id) => (s.face !== null && !s.gone && !s.open && s.owner !== m.me && !mine.has(id) ? [id] : []));
  });

// Your hand as the page draws it matches your cards, by design.
export const handShown = (page) => page.evaluate(() => [...document.querySelectorAll("#sc-hand .sc-hcard")].map((b) => Number(b.firstElementChild.dataset.id)).sort((a, b) => a - b));
export const handHeld = (page) =>
  page.evaluate(async () => {
    const { designOf } = await import("/stonecrown/rules.js");
    const m = window.ddp.match;
    return m.state.hands[m.me].map((s) => designOf(m.state.players, m.face(s))).sort((a, b) => a - b);
  });

// The coins each seat's panel (or, across the table, its pill) shows (yours
// in your stats) once the table has caught up with the game: the coins each
// holds. Fails after 20 s.
export const coinsShown = (page) =>
  waitForState(
    page,
    () => {
      const m = window.ddp.match;
      const shown = m.state.coins.map((_, p) => {
        const node = p === m.me ? document.querySelector(".sc-me-stats .sc-stat.coins") : document.querySelector(`:is(.sc-seat, .sc-across-pill)[data-seat="${p}"] .sc-stat.coins`);
        return Number(node?.textContent.match(/\d+/)?.[0]);
      });
      return shown.every((n, p) => n === m.state.coins[p]);
    },
    undefined,
    { why: "every seat shows its coins" },
  );

// Keeps every line the page's log ("What happened") ever showed: the log
// itself keeps the latest 80. logLines() reads them, oldest first.
export function recordLog(page) {
  return page.evaluate(() => {
    const lines = [];
    const update = () => {
      for (const li of [...document.querySelectorAll("#sc-log li")].reverse()) {
        const line = lines.find((l) => l.node === li);
        if (line) line.text = li.textContent;
        else lines.push({ node: li, text: li.textContent });
      }
    };
    window.__scLog = lines;
    new MutationObserver(update).observe(document.querySelector("#sc-log"), { childList: true, subtree: true, characterData: true });
    update();
  });
}
export const logLines = (page) => page.evaluate(() => window.__scLog.map((l) => l.text));
