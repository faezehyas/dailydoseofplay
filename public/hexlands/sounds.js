// Hexlands sounds. The card games' shared set (engine/cards/card-sounds.js)
// handles the cards and plays your turn, a refusal and the timer. Hexlands'
// own are synthesized, in C major pentatonic so whatever lands together
// sounds sweet: two wooden dice tumbling on the board, a little different
// each roll; a card from the bank in each resource's timbre (a woody knock,
// a clay clink, a fluffy puff with a tiny bleat, a rustle of wheat with a
// chime, a crystal ping); a road set down, a settlement hammered together, a
// city with a flourish; the robber's comic stomp and a sly swipe; a mystery
// card drawn; a knight's flourish, a progress card's sparkle; trades offered,
// struck and called off; and two fanfares, for longest road and largest
// army. A win or a loss plays the result chimes (engine/chimes.js).
import { defineSounds } from "../engine/sound.js";
import { tone, noise, decay } from "../engine/synth.js";
import { cardSounds, tableSounds, note, bell } from "../engine/cards/card-sounds.js";

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const vary = (x, by) => x * (1 + (Math.random() * 2 - 1) * by);

// An oscillator held at `gain` for most of `dur`, then let go: a voice that
// sustains, unlike decay()'s pluck.
function held(a, o, t, { dur, gain, attack = 0.02 }) {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(gain * 0.6, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(o);
  return g;
}

// A warm brass note: two slightly detuned saws through a filter that opens
// on the attack ("bwah") and closes as it fades.
function horn(a, o, t, freq, { dur = 0.3, gain = 0.05 } = {}) {
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(freq * 1.2, t);
  f.frequency.exponentialRampToValueAtTime(freq * 4.5, t + 0.05);
  f.frequency.exponentialRampToValueAtTime(freq * 2, t + dur);
  f.connect(held(a, o, t, { dur, gain, attack: 0.025 }));
  for (const d of [0.998, 1.003]) {
    const osc = a.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq * d;
    osc.connect(f);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

// A soft mallet on wood: the note, its bright fourth harmonic, a tap.
function marimba(a, o, t, freq, gain = 0.12, dur = 0.3) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 3.9, dur: 0.05, gain: gain * 0.2 });
  noise(a, o, t, { dur: 0.014, gain: gain * 0.4, freq: 2400, q: 1.2 });
}

// A wooden piece set down on the board.
function clack(a, o, t, gain = 0.2) {
  noise(a, o, t, { dur: 0.028, gain, freq: 900, q: 1.3 });
  tone(a, o, t, { freq: 210, to: 120, dur: 0.06, gain: gain * 0.5 });
}

// A little hammer on a peg: a bright tick over the wood it strikes.
function tap(a, o, t, gain = 0.12) {
  noise(a, o, t, { dur: 0.012, gain, freq: 3400, q: 2 });
  tone(a, o, t, { freq: vary(1650, 0.03), to: 1480, dur: 0.04, gain: gain * 0.35, type: "triangle" });
  tone(a, o, t, { freq: 460, dur: 0.035, gain: gain * 0.4 });
}

// A heavy wooden block settling into place.
function thunk(a, o, t, gain = 0.3) {
  tone(a, o, t, { freq: 150, to: 82, dur: 0.14, gain });
  noise(a, o, t, { kind: "brown", dur: 0.1, gain: gain * 0.8, type: "lowpass", freq: 420 });
  noise(a, o, t, { dur: 0.03, gain: gain * 0.35, freq: 750, q: 1 });
}

// A card slid across the table.
function flick(a, o, t, freq = 2600, gain = 0.1) {
  noise(a, o, t, { dur: 0.05, gain, freq, to: freq * 0.6, q: 0.9 });
}

// A plucked string, short and round.
function pluck(a, o, t, freq, gain = 0.07) {
  tone(a, o, t, { freq, dur: 0.12, gain, type: "triangle" });
  tone(a, o, t, { freq: freq * 2, dur: 0.04, gain: gain * 0.3 });
}

// A big foot coming down on wood.
function stomp(a, o, t, gain = 0.35) {
  tone(a, o, t, { freq: 88, to: 40, dur: 0.22, gain, attack: 0.006 });
  noise(a, o, t, { kind: "brown", dur: 0.16, gain: gain * 0.8, type: "lowpass", freq: 260, attack: 0.005 });
  noise(a, o, t, { dur: 0.04, gain: gain * 0.25, freq: 520, q: 1 });
}

// A tuba: a low saw through a dark filter, with a little sag in its pitch.
function tuba(a, o, t, freq, { dur = 0.26, gain = 0.09, to = freq * 0.98 } = {}) {
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(freq * 2, t);
  f.frequency.exponentialRampToValueAtTime(freq * 4, t + 0.04);
  f.frequency.exponentialRampToValueAtTime(freq * 2, t + dur);
  const osc = a.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(f).connect(held(a, o, t, { dur, gain, attack: 0.03 }));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A wooden die striking the board: the knock of its edge, the hollow
// "tok" of the cube, and the board answering underneath.
function knock(a, o, t, pitch, gain) {
  noise(a, o, t, { dur: 0.018, gain, freq: 2100 * pitch, q: 3 });
  tone(a, o, t, { freq: 1000 * pitch, to: 900 * pitch, dur: 0.04, gain: gain * 0.2, type: "triangle" });
  tone(a, o, t, { freq: 2750 * pitch, dur: 0.016, gain: gain * 0.05 });
  tone(a, o, t, { freq: 180, to: 115, dur: 0.06, gain: gain * 0.3 });
}

// One die thrown: it bounces, each hop quicker and softer, then rocks to rest.
function die(a, o, t) {
  const pitch = vary(1, 0.12);
  const hops = 4 + Math.floor(Math.random() * 3);
  let gap = vary(0.1, 0.2);
  let gain = vary(0.3, 0.1);
  for (let i = 0; i < hops; i++) {
    knock(a, o, t, pitch * vary(1, 0.07), gain);
    t += gap;
    gap *= vary(0.68, 0.1);
    gain *= vary(0.7, 0.12);
  }
  knock(a, o, t, pitch * 1.08, gain * 0.6);
  knock(a, o, t + vary(0.03, 0.3), pitch * 0.95, gain * 0.4);
}

// A card from the bank, in each resource's timbre. Each picks one of three
// notes, so a roll that pays many at once lands as a chord, not a pile-up.
const RESOURCE = [
  // Wood: a soft knock on a hollow log.
  (a, o, t) => {
    const f = note(pick([3, 4, 5]));
    noise(a, o, t, { dur: 0.014, gain: 0.08, freq: 1100, q: 2 });
    tone(a, o, t, { freq: f, dur: 0.2, gain: 0.14 });
    tone(a, o, t, { freq: f * 3.9, dur: 0.035, gain: 0.025 });
    tone(a, o, t, { freq: f / 2, to: f * 0.45, dur: 0.08, gain: 0.08 });
  },
  // Brick: two terracotta clinks, the second a step lower.
  (a, o, t) => {
    const f = note(pick([9, 10, 11]));
    for (const [d, k, g] of [[0, 1, 1], [0.075, 0.891, 0.7]]) {
      noise(a, o, t + d, { dur: 0.012, gain: 0.21 * g, freq: 2800, q: 2.5 });
      tone(a, o, t + d, { freq: f * k, dur: 0.09, gain: 0.18 * g, type: "triangle" });
      tone(a, o, t + d, { freq: f * k * 2.32, dur: 0.035, gain: 0.054 * g });
    }
  },
  // Wool: a fluffy puff, and a lamb's tiny "meh-eh".
  (a, o, t) => {
    noise(a, o, t, { dur: 0.22, gain: 0.54, type: "lowpass", freq: 1100, to: 450, q: 0.5, attack: 0.04 });
    const f = note(pick([7, 8, 9]));
    const dur = 0.26;
    const osc = a.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, t + 0.03);
    osc.frequency.exponentialRampToValueAtTime(f * 0.94, t + 0.03 + dur);
    const wobble = a.createGain();
    wobble.gain.value = 0.6;
    const lfo = a.createOscillator();
    lfo.frequency.value = 17;
    const depth = a.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(wobble.gain);
    osc.connect(wobble).connect(decay(a, o, t + 0.03, 0.16, dur, 0.03));
    for (const n of [osc, lfo]) {
      n.start(t + 0.03);
      n.stop(t + 0.05 + dur);
    }
  },
  // Grain: wheat brushing together, and a light chime.
  (a, o, t) => {
    for (let i = 0; i < 4; i++) {
      noise(a, o, t + i * 0.03 + Math.random() * 0.015, { dur: 0.06, gain: 0.11, freq: vary(5000, 0.25), q: 1.2, attack: 0.008 });
    }
    noise(a, o, t, { dur: 0.2, gain: 0.055, type: "highpass", freq: 3500, attack: 0.03 });
    bell(a, o, t + 0.06, note(pick([12, 13, 14])), 0.055, 0.45);
  },
  // Ore: a crystal's bright ping, shimmering, with a glint a fifth above.
  (a, o, t) => {
    const f = note(pick([13, 14, 15]));
    noise(a, o, t, { dur: 0.008, gain: 0.048, type: "highpass", freq: 6000 });
    tone(a, o, t, { freq: f, dur: 0.45, gain: 0.06 });
    tone(a, o, t, { freq: f * 1.006, dur: 0.4, gain: 0.03 });
    tone(a, o, t, { freq: f * 2.01, dur: 0.1, gain: 0.012 });
    tone(a, o, t + 0.05, { freq: f * 1.5, dur: 0.3, gain: 0.017 });
  },
];

// A roll that pays many cards at once would land them as one loud thud.
// Instead each card that would start on top of the last waits its turn a
// moment later and a little softer, so they cascade like a handful of coins.
const STEP = 0.045;
const lastCard = new WeakMap();
function cascade(a, t) {
  const last = lastCard.get(a);
  const stacked = last && t > last.at - 0.4 && t < last.at + STEP;
  const card = stacked ? { at: last.at + STEP, n: last.n + 1 } : { at: t + Math.random() * 0.01, n: 0 };
  lastCard.set(a, card);
  return { at: card.at, gain: Math.max(0.45, 0.82 ** card.n) };
}

const SYNTH = {
  // Two wooden dice tumbling on the board.
  roll: (a, o, t) => {
    die(a, o, t);
    die(a, o, t + vary(0.045, 0.5));
  },
  // A card of resource `r` from the bank.
  gain: (a, o, t, { r = 0 } = {}) => {
    const { at, gain } = cascade(a, t);
    const g = a.createGain();
    g.gain.value = gain;
    g.connect(o);
    (RESOURCE[r] ?? RESOURCE[0])(a, g, at);
  },
  // A road slid into place, and a note.
  "build-road": (a, o, t) => {
    noise(a, o, t, { dur: 0.07, gain: 0.04, freq: 1500, to: 900, q: 0.8, attack: 0.02 });
    clack(a, o, t + 0.06);
    marimba(a, o, t + 0.065, note(pick([5, 7])), 0.1);
  },
  // A settlement: tap, tap with the hammer, the house thunks down, and a
  // happy little rise.
  "build-settlement": (a, o, t) => {
    tap(a, o, t);
    tap(a, o, t + 0.11, 0.1);
    thunk(a, o, t + 0.25);
    marimba(a, o, t + 0.3, note(7));
    marimba(a, o, t + 0.38, note(10));
  },
  // A city: busier hammering, two heavy blocks, then a rising run that rings
  // out on a chord.
  "build-city": (a, o, t) => {
    tap(a, o, t);
    tap(a, o, t + 0.08, 0.09);
    tap(a, o, t + 0.16, 0.11);
    thunk(a, o, t + 0.28, 0.32);
    thunk(a, o, t + 0.4, 0.26);
    [5, 7, 8, 10].forEach((n, i) => marimba(a, o, t + 0.46 + i * 0.07, note(n), 0.1));
    for (const n of [10, 12, 13]) tone(a, o, t + 0.74, { freq: note(n), dur: 0.7, gain: 0.025, type: "triangle", attack: 0.02 });
    bell(a, o, t + 0.74, note(15), 0.025, 0.9);
  },
  // The robber: two big comic stomps, a tuba under each.
  robber: (a, o, t) => {
    stomp(a, o, t);
    tuba(a, o, t, note(-4));
    stomp(a, o, t + 0.3, 0.38);
    tuba(a, o, t + 0.3, note(-6), { dur: 0.42, to: note(-7) });
  },
  // A sly swipe of a card, and a cheeky pluck, pluck.
  steal: (a, o, t) => {
    noise(a, o, t, { dur: 0.16, gain: 0.1, freq: 500, to: 4500, q: 1.5, attack: 0.1 });
    pluck(a, o, t + 0.17, note(4));
    pluck(a, o, t + 0.25, note(8));
  },
  // Cards handed back to the bank, and a soft sigh down.
  discard: (a, o, t) => {
    [2600, 2300, 2000].forEach((f, i) => flick(a, o, t + i * 0.06, f));
    tone(a, o, t + 0.12, { freq: note(4), to: note(2), dur: 0.28, gain: 0.04, type: "triangle", attack: 0.02 });
  },
  // A card drawn from the development pile, with a whole-tone shimmer of
  // mystery.
  buy: (a, o, t) => {
    noise(a, o, t, { dur: 0.28, gain: 0.08, freq: 1500, to: 3200, q: 0.7, attack: 0.06 });
    [0, 2, 4, 6, 8, 10].forEach((s, i) => {
      const f = 523.25 * 2 ** (s / 12);
      tone(a, o, t + 0.1 + i * 0.045, { freq: f, dur: 0.35, gain: 0.02 });
      tone(a, o, t + 0.1 + i * 0.045, { freq: f * 2, dur: 0.12, gain: 0.006 });
    });
  },
  // A knight: a sword drawn, then a horn's "ta-ta-taa".
  knight: (a, o, t) => {
    noise(a, o, t, { dur: 0.25, gain: 0.04, type: "highpass", freq: 5000, attack: 0.01 });
    tone(a, o, t, { freq: 3150, dur: 0.3, gain: 0.01 });
    tone(a, o, t, { freq: 4270, dur: 0.22, gain: 0.006 });
    horn(a, o, t + 0.12, note(3), { dur: 0.11 });
    horn(a, o, t + 0.24, note(3), { dur: 0.11 });
    horn(a, o, t + 0.36, note(5), { dur: 0.45 });
  },
  // A progress card: a puff of magic and a glockenspiel run.
  progress: (a, o, t) => {
    noise(a, o, t, { dur: 0.3, gain: 0.05, freq: 800, to: 3500, q: 0.8, attack: 0.15 });
    [10, 11, 12, 13, 14, 15].forEach((n, i) => bell(a, o, t + 0.08 + i * 0.045, note(n), 0.025, 0.5));
    noise(a, o, t + 0.3, { dur: 0.35, gain: 0.015, type: "highpass", freq: 7500, attack: 0.04 });
  },
  // A trade struck: cards crossing the table, and a friendly "ba-ding".
  trade: (a, o, t) => {
    flick(a, o, t, 2800);
    flick(a, o, t + 0.05, 2000);
    marimba(a, o, t + 0.07, note(5), 0.1);
    bell(a, o, t + 0.15, note(10), 0.04, 0.6);
    bell(a, o, t + 0.15, note(12), 0.03, 0.6);
  },
  // An offer on the table: a curious "hm?".
  offer: (a, o, t) => {
    flick(a, o, t, 2400, 0.06);
    tone(a, o, t + 0.03, { freq: note(5), dur: 0.12, gain: 0.05, type: "triangle" });
    tone(a, o, t + 0.13, { freq: note(7), to: note(8), dur: 0.2, gain: 0.05, type: "triangle" });
  },
  // No deal: a gentle shrug down.
  nodeal: (a, o, t) => {
    tone(a, o, t, { freq: note(4), dur: 0.14, gain: 0.05, type: "triangle" });
    tone(a, o, t + 0.13, { freq: note(2), dur: 0.26, gain: 0.05, type: "triangle" });
  },
  // Longest road: road pieces laid at a run, and the horns answer.
  longest: (a, o, t) => {
    [5, 6, 7, 8, 9, 10].forEach((n, i) => marimba(a, o, t + i * 0.055, note(n), 0.09));
    for (const n of [5, 7, 8]) horn(a, o, t + 0.36, note(n), { dur: 0.75, gain: 0.03 });
    bell(a, o, t + 0.36, note(15), 0.025, 1);
  },
  // Largest army: a drum roll, a march up the horns, a timpani under the last.
  army: (a, o, t) => {
    for (let i = 0; i < 6; i++) noise(a, o, t + i * 0.04, { dur: 0.04, gain: 0.03 + i * 0.012, freq: 2400, q: 0.8 });
    [3, 5, 7].forEach((n, i) => horn(a, o, t + 0.26 + i * 0.12, note(n), { dur: 0.12, gain: 0.04 }));
    for (const n of [8, 10]) horn(a, o, t + 0.62, note(n), { dur: 0.7, gain: 0.03 });
    tone(a, o, t + 0.62, { freq: 98, to: 82, dur: 0.5, gain: 0.25 });
    noise(a, o, t + 0.62, { kind: "brown", dur: 0.3, gain: 0.2, type: "lowpass", freq: 300 });
  },
};

export const sounds = defineSounds({
  ...cardSounds,
  ...tableSounds,
  roll: { role: "action", synth: SYNTH.roll, trim: 9.2 },
  gain: { role: "action", offset: -4, synth: SYNTH.gain, trim: 4.9 },
  "build-road": { role: "action", synth: SYNTH["build-road"], trim: 5.4 },
  "build-settlement": { role: "highlight", synth: SYNTH["build-settlement"], trim: 2.8 },
  "build-city": { role: "highlight", offset: 1, synth: SYNTH["build-city"], trim: 3.4 },
  robber: { role: "highlight", synth: SYNTH.robber, trim: 0.7 },
  steal: { role: "action", synth: SYNTH.steal, trim: 11.6 },
  discard: { role: "action", synth: SYNTH.discard, trim: 14.8 },
  buy: { role: "action", synth: SYNTH.buy, trim: 13.4 },
  knight: { role: "highlight", synth: SYNTH.knight, trim: 8.4 },
  progress: { role: "highlight", synth: SYNTH.progress, trim: 11.7 },
  trade: { role: "action", synth: SYNTH.trade, trim: 5.1 },
  offer: { role: "ui", synth: SYNTH.offer, trim: 10.2 },
  nodeal: { role: "ui", synth: SYNTH.nodeal, trim: 9.3 },
  longest: { role: "fanfare", offset: -2, synth: SYNTH.longest, trim: 8.7 },
  army: { role: "fanfare", offset: -2, synth: SYNTH.army, trim: 2.6 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
