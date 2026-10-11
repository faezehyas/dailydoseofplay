// "How to play": the same sections, in the same order, in every game. A game
// writes its text in how-to-play.js and passes it to startGameShell(), which
// puts the panel under the game. Leave out any section that doesn't apply.
//
//   howToPlayPanel({ goal, players, setup, turn, winning, settings, fairPlay, keyboard }, top)
//
// top is an optional node shown first, such as the link to the game's tutorial.
// A section is a string (one paragraph) or an array (a list); **text** is bold.
// madeBy(credits) is the panel's last line, from the game's credits in games.json.
import { el } from "./shell.js";

export const SECTIONS = {
  goal: "Goal",
  players: "Players",
  setup: "Setup",
  turn: "On your turn",
  winning: "Winning",
  settings: "Settings and clocks",
  fairPlay: "Fair play",
  keyboard: "Keyboard",
};

const rich = (text) => text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? el("strong", {}, part) : part));

export function howToPlayPanel(sections, top = null) {
  for (const key of Object.keys(sections)) if (!SECTIONS[key]) throw new Error(`How to play: unknown section "${key}"`);
  return el(
    "details",
    { class: "card rules", id: "how-to-play" },
    el("summary", {}, "How to play"),
    top,
    Object.entries(SECTIONS)
      .filter(([key]) => sections[key])
      .flatMap(([key, title]) => {
        const body = sections[key];
        return [el("h3", {}, title), Array.isArray(body) ? el("ul", {}, body.map((item) => el("li", {}, rich(item)))) : el("p", {}, rich(body))];
      }),
  );
}

// "Made by @handle", each handle linked to its GitHub profile.
export function madeBy(credits) {
  return el("p", { class: "made-by" }, "Made by ", credits.flatMap(({ github }, i) => [i > 0 && ", ", el("a", { href: `https://github.com/${github}` }, `@${github}`)]));
}
