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

<!-- The tests you ran and their results, and what you checked by hand (step 8 of the recipe in CONTRIBUTING.md). -->

## Checklist

<!-- For a new game. On other PRs, tick what applies and delete the rest. Each line is explained in CONTRIBUTING.md. -->

- [ ] `public/<slug>/` has `index.html`, `style.css`, `main.js`, `rules.js`, `robot.js`, `how-to-play.js`, `icon.svg`, `og.jpg` and tests
- [ ] `rules.js` is pure and unit-tested; illegal moves throw `RuleError`
- [ ] The robot plays legal, decent moves, and robot-vs-robot games always finish
- [ ] Friend match in two windows: invite link, auto-join, full game, rematch, leave
- [ ] No hidden information on the wire: `CardMatch` for hidden cards, commitments like Sea Battle for the rest
- [ ] All randomness comes from `SharedRandom`
- [ ] `layout` passed to `startGameShell()`; no `max-width` on the view's top-level box
- [ ] Names, turn, score and Leave come from `playerBar()`
- [ ] The result, Rematch and Leave come from `resultPanel()`
- [ ] The panel's `onShow` plays `celebrate()`; no win or lose sounds of the game's own
- [ ] 360 px with no sideways scroll, also with two 20-letter names; light and dark; touch and keyboard
- [ ] Coral or teal text uses `--accent-text` or `--accent-2-text`; controls are outlined in `--control-border`
- [ ] No fonts or timings of its own: timers carry `mono`, transitions use `--dur-*` and `--ease-*`
- [ ] Each player keeps one colour: `.mine` and `.theirs` use `--mine` and `--theirs`, and the root has `data-you`
- [ ] A new `localStorage` key is listed on the privacy page
- [ ] Sounds, if any, are in `sounds.js` with a role each, and `sound-levels.test.js` passes
- [ ] Original name, text and art; nothing copied from papergames
- [ ] `games.json` entry added as `ready`; the game moved to "Shipped" in `GAMES.md`; README updated
- [ ] `npm test` passes; `npm run test:browser` passes or is reported as skipped
- [ ] No new dependencies, no build step, nothing changed under `server/`, no secrets
- [ ] Every commit message follows Conventional Commits
