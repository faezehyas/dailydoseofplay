// Shared by the Hearts browser tests: the page helpers.
export { bg, resultInView } from "./ludo.shared.js";

export const state = (page) => page.evaluate(() => window.ddp.match.state);

// Plays this page's choices through the page's own controls: what the Medium
// robot would do, by tapping three cards and Pass, or a lit card. The 2 of
// clubs, an only legal card and the next hand are the game's.
export function autoplay(page) {
  return page.evaluate(async () => {
    const { chooseMove } = await import("/hearts/robot.js");
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const m = window.ddp.match;
      if (!m || m.phase !== "playing" || document.querySelector(".hr-fly .pc-card")) return;
      const tap = (slot) => document.querySelector(`.hr-hcard[data-slot="${slot}"]`)?.click();
      const pass = document.querySelector("#hr-pass:not([hidden]):not([disabled])");
      if (pass) return pass.click();
      const st = m.state;
      if (st.phase === "pass" && !st.picks[m.me] && document.querySelector(".hr-hcard.pickable")) {
        if (document.querySelector(".hr-hcard.picked")) return;
        const move = chooseMove({ ...st, turn: m.me }, m.me, Math.random, (s) => m.face(s), { level: "medium" });
        return move.pass.forEach(tap);
      }
      if (st.phase === "play" && m.canMove() && document.querySelector(".hr-hcard.playable")) {
        const move = chooseMove(st, m.me, Math.random, (s) => m.face(s), { level: "medium" });
        if (move.play !== undefined) tap(move.play);
      }
    }, 40);
  });
}
export const stopAutoplay = (page) => page.evaluate(() => clearInterval(window.__autoplay));

// Every face this page's match knows is open, in its own hand, or one it passed on.
export const leaks = (page) =>
  page.evaluate(() => {
    const m = window.ddp.match;
    const passed = new Set(m.sealed.filter((p) => p.from === m.me).map((p) => p.slot));
    return m.slots.flatMap((s, id) => (s.face !== null && !s.gone && !s.open && s.owner !== m.me && !passed.has(id) ? [id] : []));
  });

// Faces drawn anywhere on this page that its match may not show during play.
export const domLeaks = (page) =>
  page.evaluate(() => {
    const m = window.ddp.match;
    const passed = new Set(m.sealed.filter((p) => p.from === m.me).map((p) => p.slot));
    const ok = new Set(m.slots.flatMap((s, id) => (s.face !== null && (s.open || s.owner === m.me || passed.has(id)) ? [s.face] : [])));
    // Three players: the deck's faces skip the 2 of diamonds (27).
    const card = (f) => (m.players === 3 && f >= 27 ? f + 1 : f);
    const allowed = new Set([...ok].map(card));
    return [...document.querySelectorAll(".hearts [data-face]")].map((n) => n.dataset.face).filter((f) => f !== "null" && !allowed.has(Number(f)));
  });
