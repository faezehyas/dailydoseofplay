## Summary

<!-- What changes and why. For a new game: Closes #<proposal issue>. -->

## Rules and deviations

<!-- A new game: a short rules summary and any change from the rules source. Otherwise delete this section. -->

## Protocol

<!-- TurnMatch, CardMatch, or custom like Sea Battle, and why. Delete if no game changed. -->

## Screenshots

<!-- 360 px and 1280 px wide, in light and dark. Delete if nothing visible changed. -->

| | Light | Dark |
|---|---|---|
| 360 px | | |
| 1280 px | | |

## Known limitations

<!-- What doesn't work yet, or "None". -->

## Tests run

- [ ] `npm test`
- [ ] `npm run test:browser` (passed, or skipped because Playwright is missing)
- [ ] By hand: friend match in two windows with rematch and leave, and a game against the robot

## Checklist

See [Checklist before opening the PR](https://github.com/Faezehyas/dailydoseofplay/blob/main/CONTRIBUTING.md#checklist-before-opening-the-pr) for the details behind each line.

- [ ] Pure, unit-tested `rules.js`; illegal moves throw `RuleError`
- [ ] The robot plays legal moves, and robot-vs-robot games always finish
- [ ] No hidden information over the wire; all randomness from `SharedRandom`
- [ ] `playerBar()`, `resultPanel()` and `celebrate()` from the engine, not the game's own
- [ ] 360 px with no sideways scroll, also with two 20-letter names; light and dark; touch and keyboard
- [ ] Theme tokens only: colours, fonts and timings; each player keeps one colour
- [ ] A new `localStorage` key is listed on the privacy page
- [ ] Original name, text, art and sounds; nothing copied from papergames
- [ ] `games.json`, `GAMES.md` and the README updated
- [ ] No new dependencies, no build step, nothing under `server/`, no secrets
- [ ] Commits follow Conventional Commits
