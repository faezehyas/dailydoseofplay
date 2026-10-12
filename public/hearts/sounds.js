// Hearts sounds. The card games' shared set (engine/cards/card-sounds.js)
// handles the cards (a riffle, a deal flick, a card played, cards gathered
// for the next shuffle) and plays your turn, a refusal and the timer. All of
// Hearts' own are synthesized: the pass whooshing off, a trick swept in,
// hearts breaking (a heartbeat), the queen of spades (an ominous low note),
// the points tallying and a fanfare for shooting the moon. A win or a loss
// plays the result chimes (engine/chimes.js).
import { defineSounds } from "../engine/sound.js";
import { tone, noise } from "../engine/synth.js";
import { cardSounds, tableSounds, note, bell } from "../engine/cards/card-sounds.js";

const SYNTH = {
  // Three cards whisked across the felt: an airy rising sweep.
  pass: (a, o, t) => {
    noise(a, o, t, { dur: 0.34, gain: 0.12, freq: 700, to: 3600, q: 0.6, attack: 0.08 });
    noise(a, o, t + 0.05, { dur: 0.22, gain: 0.05, type: "highpass", freq: 5000, attack: 0.05 });
  },
  // A trick swept to its winner: a soft brush that settles.
  sweep: (a, o, t) => {
    noise(a, o, t, { dur: 0.26, gain: 0.12, freq: 2400, to: 900, q: 0.7, attack: 0.03 });
    tone(a, o, t + 0.2, { freq: 160, to: 110, dur: 0.07, gain: 0.05 });
  },
  // Hearts are broken: two low, soft beats of a heart.
  broken: (a, o, t) => {
    for (const [d, g] of [[0, 1], [0.24, 0.75]]) {
      tone(a, o, t + d, { freq: 72, to: 46, dur: 0.18, gain: 0.32 * g, attack: 0.008 });
      noise(a, o, t + d, { kind: "brown", dur: 0.12, gain: 0.25 * g, type: "lowpass", freq: 260, attack: 0.006 });
    }
    tone(a, o, t + 0.5, { freq: note(7), dur: 0.5, gain: 0.025, type: "triangle", attack: 0.04 });
  },
  // The queen of spades lands: a deep, dark note under a thud.
  queen: (a, o, t) => {
    noise(a, o, t, { kind: "brown", dur: 0.2, gain: 0.35, type: "lowpass", freq: 220, attack: 0.004 });
    tone(a, o, t, { freq: 58.27, dur: 1.2, gain: 0.16, type: "sawtooth", attack: 0.02 });
    tone(a, o, t, { freq: 69.3, dur: 1.1, gain: 0.08, type: "sine", attack: 0.03 });
    tone(a, o, t + 0.04, { freq: 87.31, to: 82.41, dur: 1.0, gain: 0.05, type: "triangle", attack: 0.05 });
  },
  // A point counted onto the score: a small soft tick, a little higher each time.
  tally: (a, o, t, { n = 0 } = {}) => {
    tone(a, o, t, { freq: 620 + Math.min(n, 26) * 22, dur: 0.05, gain: 0.05, type: "triangle" });
  },
  // Shooting the moon: a rising run that rings out on bells.
  moon: (a, o, t) => {
    [5, 7, 9, 10, 12].forEach((n, i) => tone(a, o, t + i * 0.09, { freq: note(n), dur: 0.24, gain: 0.05, type: "triangle" }));
    tone(a, o, t + 0.45, { freq: note(15), dur: 1.1, gain: 0.05, type: "sine", attack: 0.02 });
    tone(a, o, t + 0.45, { freq: note(17), dur: 1.0, gain: 0.035, type: "sine", attack: 0.03 });
    bell(a, o, t + 0.45, note(20), 0.04, 1.4);
    noise(a, o, t + 0.42, { dur: 0.9, gain: 0.018, type: "highpass", freq: 7500, attack: 0.1 });
  },
};

export const sounds = defineSounds({
  ...cardSounds,
  ...tableSounds,
  pass: { role: "action", synth: SYNTH.pass, trim: 9 },
  sweep: { role: "action", offset: -3, synth: SYNTH.sweep, trim: 12 },
  broken: { role: "highlight", synth: SYNTH.broken, trim: 4.1 },
  queen: { role: "highlight", synth: SYNTH.queen, trim: 4.1 },
  tally: { role: "cue", synth: SYNTH.tally, trim: 11.1 },
  moon: { role: "fanfare", synth: SYNTH.moon, trim: 6 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
