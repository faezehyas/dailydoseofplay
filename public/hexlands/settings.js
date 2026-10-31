// Hexlands' settings: the points to win, the time per move and the robots'
// level.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

// The summary names only the rules that differ from the classic ones.
const GROUPS = [
  { name: "target", legend: "Game", options: [[10, "To 10", "classic"], [8, "To 8", "shorter"]], summary: (v) => (v === 10 ? "" : "Game to 8") },
  { name: "moveSeconds", legend: "Time per move", options: [[0, "No limit"], [30, "30 s"], [60, "60 s"], [120, "120 s"]], summary: (v, l) => (v ? `${l} a move` : "No time limit") },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l, c, robots) => `${l} ${robots > 1 ? "robots" : "robot"}` },
];

export const settings = gameSettings({
  key: "ddp-hexlands-settings",
  prefix: "hx",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "Three or four players. With friends, the settings of whoever creates the room apply to everyone. When time runs out, a sensible move is made for you.",
});
