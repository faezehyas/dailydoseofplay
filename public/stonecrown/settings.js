// Stonecrown's settings: the wonder sides, the time per move and the robots'
// level. The player count (3 or 4) is the lobby's, as in Hexlands.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig, MOVE_SECONDS } from "./rules.js";

// The summary names only the rules that differ from the classic ones.
const GROUPS = [
  {
    name: "side",
    legend: "Wonder sides",
    options: [["A", "A", "simpler"], ["B", "B", "trickier"], ["random", "Mixed", "each player's own"]],
    summary: (v) => (v === "B" ? "B sides" : v === "random" ? "Mixed sides" : ""),
  },
  { name: "moveSeconds", legend: "Time per move", options: MOVE_SECONDS.map((s) => [s, s ? `${s} s` : "No limit"]), summary: (v, l) => (v ? `${l} a move` : "No time limit") },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l, c, robots) => `${l} ${robots > 1 ? "robots" : "robot"}` },
];

export const settings = gameSettings({
  key: "ddp-stonecrown-settings",
  prefix: "sc",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "Three or four players. Wonders are always dealt at random; Mixed gives each player side A or B at random. With friends, the settings of whoever creates the room apply to everyone. When time runs out, a card is picked for you.",
});
