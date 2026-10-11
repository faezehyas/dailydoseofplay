// Writes the README's Contributors list from the credits in public/games.json:
// one line per GitHub handle, with the games they made, in games.json order.
//
//   node scripts/credits.js
//
// test/readme.test.js fails when the README's list is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const START = "<!-- credits:start -->";
const END = "<!-- credits:end -->";
const README = new URL("../README.md", import.meta.url);
const GAMES = new URL("../public/games.json", import.meta.url);

function contributorsList(games) {
  const made = new Map();
  for (const game of games) for (const { github } of game.credits ?? []) made.set(github, [...(made.get(github) ?? []), game.name]);
  return [...made].map(([github, names]) => `- [@${github}](https://github.com/${github}): ${names.join(", ")}`).join("\n");
}

// The README with its list (between the credits markers) replaced.
export function withContributors(readme, games) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error(`README.md needs ${START} and ${END}`);
  return `${readme.slice(0, start + START.length)}\n${contributorsList(games)}\n${readme.slice(end)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { games } = JSON.parse(readFileSync(GAMES, "utf8"));
  writeFileSync(README, withContributors(readFileSync(README, "utf8"), games));
}
