// Your record against the robots, per game and per number of players at the
// table, kept only on this device. It never counts on a leaderboard. The
// result panel (result.js) records each finished robot match; the lobby shows
// the totals with Reset.
//
// ddp-robot-record = { [slug]: { [players]: { win, draw, loss } } }
import { load, store } from "./shell.js";

const KEY = "ddp-robot-record";
const OUTCOMES = ["win", "draw", "loss"];

const count = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function readAll() {
  try {
    const raw = JSON.parse(load(KEY));
    return isObject(raw) ? raw : {};
  } catch {
    return {};
  }
}

// outcome: "win", "draw" or "loss"; players: how many sat at the table, you included.
export function recordRobotResult(slug, outcome, players = 2) {
  if (!OUTCOMES.includes(outcome) || !Number.isInteger(players) || players < 2) return;
  const all = readAll();
  const game = isObject(all[slug]) ? all[slug] : {};
  const row = isObject(game[players]) ? game[players] : {};
  game[players] = Object.fromEntries(OUTCOMES.map((o) => [o, count(row[o]) + (o === outcome ? 1 : 0)]));
  all[slug] = game;
  store(KEY, JSON.stringify(all));
}

// { win, draw, loss, games } for one game, and the same for each table size in byPlayers.
export function robotRecord(slug) {
  const total = { win: 0, draw: 0, loss: 0, games: 0, byPlayers: {} };
  const game = readAll()[slug];
  for (const [players, row] of Object.entries(isObject(game) ? game : {})) {
    if (!isObject(row)) continue;
    const one = Object.fromEntries(OUTCOMES.map((o) => [o, count(row[o])]));
    one.games = one.win + one.draw + one.loss;
    if (!one.games) continue;
    total.byPlayers[players] = one;
    for (const o of [...OUTCOMES, "games"]) total[o] += one[o];
  }
  return total;
}

export function resetRobotRecord(slug) {
  const all = readAll();
  delete all[slug];
  store(KEY, Object.keys(all).length ? JSON.stringify(all) : null);
}
