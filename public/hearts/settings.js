// Hearts' settings: the game's length, passing, the moon, the jack of
// diamonds, the time per move, the robots' level, and the
// four-colour deck (that one only changes how cards look on this device).
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

// The summary names only the rules that differ from the classic ones, and
// leaves out the card colours, which are yours alone.
const GROUPS = [
  { name: "target", legend: "Game", options: [[100, "To 100", "classic"], [50, "To 50", "shorter"], [0, "One hand", "scores add up across rematches"]], summary: (v) => (v === 100 ? "" : v ? "Game to 50" : "One hand a game") },
  { name: "passing", legend: "Passing", options: [[true, "On", "classic: three cards"], [false, "Off"]], summary: (v) => (v ? "" : "No passing") },
  { name: "moon", legend: "Shooting the moon", options: [["others", "Others +26", "classic"], ["minus", "Shooter −26"]], summary: (v) => (v === "minus" ? "Moon: shooter −26" : "") },
  { name: "jack", legend: "Jack of diamonds", options: [[false, "Off", "classic"], [true, "−10", "whoever takes it"]], summary: (v) => (v ? "Jack of diamonds −10" : "") },
  { name: "moveSeconds", legend: "Time per move", options: [[0, "No limit"], [15, "15 s"], [30, "30 s"], [60, "60 s"]], summary: (v, l) => (v ? `${l} a move` : "No time limit") },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l, c, robots) => `${l} ${robots > 1 ? "robots" : "robot"}` },
  { name: "fourColor", legend: "Card colours", scope: "view", options: [[false, "Two colours"], [true, "Four colours", "♦ blue · ♣ green"]], summary: () => "" },
];

export const settings = gameSettings({
  key: "ddp-hearts-settings",
  prefix: "hr",
  groups: GROUPS,
  normalize: normalizeConfig,
  playerNotes: { 3: "17 cards each" },
  hint: "Three or four players. With friends, the settings of whoever creates the room apply to everyone, except card colours, which are yours. When time runs out, a sensible card (or pass) is played for you.",
});
