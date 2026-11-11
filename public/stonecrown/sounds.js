// Stonecrown sounds. The card games' shared set (engine/cards/card-sounds.js)
// plays your turn, a refusal and the timer. Stonecrown's own are synthesized
// in D major pentatonic, so whatever lands together sounds sweet, and its
// music is a plucked lyre: paper cards slid, laid down, flipped and fanned
// out for each age; a chisel on stone for a building, with a note for its
// colour; a carved block settling for a wonder stage; coins dropped on your
// pile for a sale, rising for coins you get, slid across the table to pay a
// neighbour, while a cart rumbles over the bridge with what they sold, or a
// raft is hauled across on its rope; the bridge's stones set one by one, or
// a stall's awning snapped open; the stacks of hands dragged round to the
// next seat; a far-off drum and horn for the war, shields stepping into line
// one by one, and the result stamped on each border; a little fanfare for a
// victory token, a soft thud for a defeat; a rustle through the discards;
// and a tally tick for each score row. A win or a loss plays the result
// chimes (engine/chimes.js).
import { defineSounds } from "../engine/sound.js";
import { tone, noise, noiseBuf, pentatonic } from "../engine/synth.js";
import { cardSounds, tableSounds } from "../engine/cards/card-sounds.js";
import { COLORS } from "./cards.js";

const note = pentatonic(293.66); // D4 up

const vary = (x, by) => x * (1 + (Math.random() * 2 - 1) * by);

// ---------- the lyre ----------
// A plucked string (Karplus-Strong): the pluck circles a delay line one
// period long, losing its highs each lap, as a real string does. Rendered
// once per context and pitch, then played as a buffer.
const strings = new WeakMap();
function stringBuf(a, freq, ring) {
  let byNote = strings.get(a);
  if (!byNote) strings.set(a, (byNote = new Map()));
  const key = `${freq.toFixed(2)}:${ring}`;
  if (byNote.has(key)) return byNote.get(key);
  const sr = a.sampleRate;
  const len = Math.round(sr * ring);
  const y = new Float32Array(len);
  // The two-point average in the loop delays half a sample.
  const d = sr / freq - 0.5;
  const burst = Math.ceil(d);
  const loss = 10 ** (-3 / (freq * ring)); // -60 dB by the end
  // The string's shape as the finger lets go, a fifth of the way along (a
  // round tone, strong in its fundamental), roughened with a little noise.
  const pos = 0.2;
  const ex = new Float32Array(burst);
  let soft = 0;
  let mean = 0;
  for (let n = 0; n < burst; n++) {
    soft += 0.5 * (Math.random() * 2 - 1 - soft);
    ex[n] = (n < pos * burst ? n / (pos * burst) : (burst - n) / ((1 - pos) * burst)) + 0.45 * soft;
    mean += ex[n] / burst;
  }
  const read = (i) => {
    if (i < 0) return 0;
    const j = Math.floor(i);
    return y[j] + (y[j + 1] - y[j]) * (i - j);
  };
  for (let n = 0; n < len; n++) y[n] = (n < burst ? ex[n] - mean : 0) + loss * 0.5 * (read(n - d) + read(n - d - 1));
  // Any offset left would thump as the note starts and ends.
  for (let n = 0, x1 = 0, y1 = 0; n < len; n++) {
    const x = y[n];
    y[n] = y1 = x - x1 + 0.995 * y1;
    x1 = x;
  }
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  const fade = Math.round(sr * 0.04);
  for (let n = 0; n < len; n++) y[n] = (y[n] / (peak || 1)) * Math.min(1, (len - n) / fade);
  const buf = a.createBuffer(1, len, sr);
  buf.getChannelData(0).set(y);
  byNote.set(key, buf);
  return buf;
}

// A lyre string plucked, warmed by its wooden body.
function lyre(a, o, t, freq, gain = 0.1, ring = 1.1) {
  const src = a.createBufferSource();
  src.buffer = stringBuf(a, freq, ring);
  const body = a.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.value = Math.min(9000, freq * 8);
  body.Q.value = 0.5;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(body).connect(g).connect(o);
  src.start(t);
}

// A few strings brushed low to high.
function strum(a, o, t, steps, gain = 0.07, ring = 1.2, gap = 0.035) {
  steps.forEach((s, i) => lyre(a, o, t + i * gap, note(s), gain, ring));
}

// A small bronze bell: the note and two quieter, inharmonic partials.
function bell(a, o, t, freq, gain = 0.04, dur = 0.7) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 2.76, dur: dur * 0.4, gain: gain * 0.25 });
  tone(a, o, t, { freq: freq * 5.4, dur: dur * 0.18, gain: gain * 0.1 });
}

// ---------- what rolls, laps or drags ----------
// A gain curve that swells to `gain` a part `rise` of the way through and
// dies away again, with no corner for the ear to catch.
function swell(gain, rise) {
  const curve = new Float32Array(48);
  for (let i = 0; i < curve.length; i++) {
    const x = i / (curve.length - 1);
    curve[i] = gain * (x < rise ? Math.sin((Math.PI / 2) * (x / rise)) : Math.cos((Math.PI / 2) * ((x - rise) / (1 - rise)))) ** 2;
  }
  return curve;
}

// Noise that swells and dies away rather than strikes, its filter
// travelling from `freq` to `to`.
function wash(a, o, t, { kind = "white", type = "bandpass", freq = 800, to = freq, q = 1, dur = 0.4, gain = 0.1, rise = 0.4 } = {}) {
  const src = a.createBufferSource();
  src.buffer = noiseBuf(a, kind);
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to !== freq) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.value = 0;
  g.gain.setValueCurveAtTime(swell(gain, rise), t, dur);
  src.connect(f).connect(g).connect(o);
  src.start(t, Math.random() * 2);
  src.stop(t + dur + 0.02);
}

// A wet rope creaking as it takes the strain: it sticks and slips, quicker
// as it tightens, and the rope's own fibres ring with each slip.
function creak(a, o, t, { dur = 0.24, gain = 0.05, from = 30, to = 50 } = {}) {
  const osc = a.createOscillator();
  osc.type = "sawtooth";
  const rate = new Float32Array(10);
  for (let i = 0; i < rate.length; i++) rate[i] = vary(from + ((to - from) * i) / (rate.length - 1), 0.07);
  osc.frequency.setValueCurveAtTime(rate, t, dur);
  const g = a.createGain();
  g.gain.value = 0;
  g.gain.setValueCurveAtTime(swell(gain, 0.55), t, dur);
  g.connect(o);
  for (const [freq, q, k] of [[640, 7, 1], [1480, 9, 0.45]]) {
    const f = a.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = vary(freq, 0.05);
    f.Q.value = q;
    const part = a.createGain();
    part.gain.value = k;
    osc.connect(f).connect(part).connect(g);
  }
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A drop falling back into the river: a small round note that leaps up.
function plip(a, o, t, freq, gain = 0.02) {
  tone(a, o, t, { freq, to: freq * 1.7, dur: 0.055, gain, attack: 0.006 });
}

// Wood knocked on wood: a dry tock, its pitch the size of the piece.
function knock(a, o, t, gain = 0.1, pitch = 1) {
  tone(a, o, t, { freq: 340 * pitch, to: 270 * pitch, dur: 0.045, gain });
  tone(a, o, t, { freq: 790 * pitch, to: 700 * pitch, dur: 0.02, gain: gain * 0.25 });
  noise(a, o, t, { dur: 0.018, gain: gain * 0.7, freq: 1100 * pitch, q: 1.8 });
}

// ---------- paper ----------
// A card slid over another: noise whose filter travels with it.
function slide(a, o, t, { dur = 0.08, gain = 0.1, from = 1600, to = 3000, q = 0.8, attack = 0.025 } = {}) {
  noise(a, o, t, { dur, gain, freq: from, to, q, attack });
}

// A card laid on the table: a papery pat with a little body under it.
function pat(a, o, t, gain = 0.14) {
  noise(a, o, t, { dur: 0.03, gain, freq: 1150, q: 1.2 });
  noise(a, o, t, { dur: 0.018, gain: gain * 0.35, type: "highpass", freq: 4200 });
  tone(a, o, t, { freq: 175, to: 115, dur: 0.045, gain: gain * 0.3 });
}

// A card turned over: the whip of air as it swings, the snap as it lands.
function flip(a, o, t, gain = 0.1) {
  noise(a, o, t, { dur: 0.06, gain: gain * 0.7, freq: 1300, to: 4200, q: 0.7, attack: 0.04 });
  noise(a, o, t + 0.055, { dur: 0.014, gain: gain * 0.5, type: "highpass", freq: 3200 });
  pat(a, o, t + 0.058, gain * 0.9);
}

// ---------- stone ----------
// A mallet on a chisel biting stone: the steel's brief ring, the grit, the
// knock of the mallet, and a chip or two skittering away.
function chisel(a, o, t, gain = 0.12, pitch = 1) {
  noise(a, o, t, { dur: 0.035, gain, freq: 2700 * pitch, q: 1.6 });
  tone(a, o, t, { freq: 3170 * pitch, dur: 0.08, gain: gain * 0.16 });
  tone(a, o, t, { freq: 4630 * pitch, dur: 0.045, gain: gain * 0.08 });
  tone(a, o, t, { freq: 660 * pitch, to: 540 * pitch, dur: 0.03, gain: gain * 0.35 });
  for (let i = 0; i < 2; i++) noise(a, o, t + 0.03 + Math.random() * 0.06, { dur: 0.007, gain: gain * 0.22, type: "highpass", freq: 5200 });
}

// A dressed stone set in its course; a bigger stone has a lower `pitch`.
function block(a, o, t, gain = 0.2, pitch = 1) {
  tone(a, o, t, { freq: 250 * pitch, to: 150 * pitch, dur: 0.07, gain: gain * 0.6 });
  noise(a, o, t, { dur: 0.04, gain, freq: 950 * pitch, q: 1.1 });
  noise(a, o, t, { kind: "brown", dur: 0.07, gain: gain * 0.7, type: "lowpass", freq: 500 * pitch });
}

// A great carved block lowered into place: deep, with a rock as it beds.
function slab(a, o, t, gain = 0.3) {
  tone(a, o, t, { freq: 118, to: 56, dur: 0.32, gain, attack: 0.005 });
  tone(a, o, t, { freq: 230, to: 140, dur: 0.12, gain: gain * 0.4 });
  noise(a, o, t, { kind: "brown", dur: 0.26, gain: gain * 0.9, type: "lowpass", freq: 340, attack: 0.004 });
  noise(a, o, t, { dur: 0.06, gain: gain * 0.35, freq: 720, q: 1 });
  tone(a, o, t + 0.085, { freq: 96, to: 60, dur: 0.16, gain: gain * 0.35 });
  noise(a, o, t + 0.085, { kind: "brown", dur: 0.1, gain: gain * 0.35, type: "lowpass", freq: 300 });
}

// ---------- coins ----------
// A bronze coin's ring: warm, with the inharmonic partials of a small disc.
function clink(a, o, t, freq, gain = 0.05, dur = 0.24) {
  noise(a, o, t, { dur: 0.006, gain: gain * 0.9, type: "highpass", freq: 5000 });
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 1.47, dur: dur * 0.7, gain: gain * 0.42 });
  tone(a, o, t, { freq: freq * 2.09, dur: dur * 0.45, gain: gain * 0.22 });
  tone(a, o, t, { freq: freq * 2.83, dur: dur * 0.3, gain: gain * 0.1 });
}

// A coin dropped on a pile: its ring, dulled by the coins under it, and the
// pile answering.
function drop(a, o, t, freq, gain = 0.05) {
  clink(a, o, t, freq, gain, 0.12);
  noise(a, o, t, { dur: 0.03, gain: gain * 1.8, freq: 1500, q: 1.2 });
  tone(a, o, t, { freq: 420, to: 300, dur: 0.035, gain: gain * 0.8 });
  clink(a, o, t + vary(0.03, 0.2), freq * 1.06, gain * 0.3, 0.06);
}

// A coin pushed across a wooden table: a dry, gritty scrape with the faint
// ring of the coin riding on it.
function scrape(a, o, t, freq, dur = 0.2, gain = 0.05) {
  noise(a, o, t, { dur, gain, freq: 2600, to: 1900, q: 3, attack: dur * 0.3 });
  noise(a, o, t, { dur, gain: gain * 0.5, freq: 800, q: 1.2, attack: dur * 0.3 });
  tone(a, o, t, { freq, dur, gain: gain * 0.12, attack: dur * 0.4 });
  tone(a, o, t, { freq: freq * 1.47, dur: dur * 0.8, gain: gain * 0.06, attack: dur * 0.4 });
}

// ---------- war ----------
// A big frame drum, struck with the hand: a deep boom, and the skin's
// higher thump that small speakers can still play.
function drum(a, o, t, gain = 0.3) {
  tone(a, o, t, { freq: 100, to: 56, dur: 0.38, gain, attack: 0.004 });
  tone(a, o, t, { freq: 190, to: 125, dur: 0.12, gain: gain * 0.5 });
  noise(a, o, t, { kind: "brown", dur: 0.24, gain: gain * 0.7, type: "lowpass", freq: 260, attack: 0.003 });
  noise(a, o, t, { dur: 0.04, gain: gain * 0.3, freq: 520, q: 1 });
}

// A long bronze horn: two detuned saws through a filter that opens slowly,
// as a horn blown from far away does.
function horn(a, o, t, freq, { dur = 0.5, gain = 0.05, open = 3 } = {}) {
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 1;
  f.frequency.setValueAtTime(freq * 1.1, t);
  f.frequency.exponentialRampToValueAtTime(freq * open, t + 0.12);
  f.frequency.exponentialRampToValueAtTime(freq * 1.3, t + dur);
  const g = a.createGain();
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.08);
  g.gain.exponentialRampToValueAtTime(gain * 0.7, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(o);
  for (const k of [0.997, 1.004]) {
    const osc = a.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq * 0.985, t);
    osc.frequency.exponentialRampToValueAtTime(freq * k, t + 0.07);
    osc.connect(f);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

// A brass "ta" for the victory fanfare: brighter and quicker than the war horn.
function trumpet(a, o, t, freq, dur = 0.14, gain = 0.035) {
  horn(a, o, t, freq, { dur, gain, open: 5 });
}

// A shield brought up into the line: leather over wood knocked against its
// neighbour, and the bronze boss answering.
function shieldTap(a, o, t, gain = 0.12, pitch = 1) {
  tone(a, o, t, { freq: 210 * pitch, to: 150 * pitch, dur: 0.05, gain: gain * 0.45 });
  tone(a, o, t, { freq: 460 * pitch, to: 390 * pitch, dur: 0.03, gain: gain * 0.5 });
  noise(a, o, t, { dur: 0.026, gain, freq: 800 * pitch, q: 1.3 });
  noise(a, o, t, { dur: 0.006, gain: gain * 0.2, type: "highpass", freq: 4500 });
  tone(a, o, t, { freq: 1250 * pitch, dur: 0.11, gain: gain * 0.12 });
  tone(a, o, t, { freq: 2140 * pitch, dur: 0.06, gain: gain * 0.05 });
}

// ---------- when everyone moves at once ----------
// When the picks settle, every seat's sounds land in the same moment: four
// reveals, four builds, coins all round. Played on top of each other they
// would sum to one loud smear. So a play that would start on top of the same
// sound waits a beat and comes a little softer, rippling like a hand of
// cards turned one after another, and any sound started while others are
// still starting is turned down a touch.
const crowds = new WeakMap();
function crowd(a, name, t, step) {
  let c = crowds.get(a);
  if (!c) crowds.set(a, (c = { last: new Map(), starts: [] }));
  const last = c.last.get(name);
  const stacked = last && t > last.at - 0.5 && t < last.at + step;
  const me = stacked ? { at: last.at + step, n: last.n + 1 } : { at: t, n: 0 };
  c.last.set(name, me);
  c.starts = c.starts.filter((s) => Math.abs(s - me.at) < 0.12);
  const others = c.starts.length;
  c.starts.push(me.at);
  return { at: me.at, gain: Math.max(0.4, 0.8 ** me.n * 0.9 ** others) };
}
const crowded = (name, step, synth) => (a, o, t, opts = {}) => {
  const { at, gain } = crowd(a, name, t, step);
  const g = a.createGain();
  g.gain.value = gain;
  g.connect(o);
  synth(a, g, at, opts);
};

// The lyre note for each card colour, so a turn's builds land as a chord.
const COLOR_NOTE = { brown: 3, grey: 4, blue: 5, yellow: 7, red: 2, green: 8, purple: 6 };
const colorNote = (c) => COLOR_NOTE[typeof c === "number" ? COLORS[c] : c] ?? 5;

const SYNTH = {
  // An age dealt: the hand fanned out card by card, and the lyre counts the
  // age, one string for each.
  deal: (a, o, t, { age = 1 } = {}) => {
    for (let i = 0; i < 7; i++) {
      const at = t + i * 0.052 + Math.random() * 0.008;
      slide(a, o, at, { dur: 0.045, gain: vary(0.09, 0.15), from: vary(2600, 0.1), to: 1700, attack: 0.012 });
      pat(a, o, at + 0.04, 0.06);
    }
    const steps = [[5], [3, 7], [3, 5, 8]][Math.min(3, Math.max(1, age)) - 1];
    steps.forEach((s, i) => lyre(a, o, t + 0.4 + i * 0.12, note(s), 0.1, 1.2));
  },
  // Your card chosen: slid out of the hand and laid face down, with a soft
  // low string to say it's done.
  pick: (a, o, t) => {
    slide(a, o, t, { dur: 0.07, gain: 0.08, from: 1400, to: 2800 });
    pat(a, o, t + 0.065, 0.15);
    lyre(a, o, t + 0.07, note(0), 0.07, 0.6);
  },
  // A card in your hand touched: a dry paper tick and a tiny pip.
  tap: (a, o, t) => {
    noise(a, o, t, { dur: 0.012, gain: 0.1, freq: 3600, q: 1.5 });
    tone(a, o, t, { freq: note(12), dur: 0.035, gain: 0.025, type: "triangle" });
  },
  // A chosen card turned face up.
  reveal: (a, o, t) => flip(a, o, t, vary(0.1, 0.08)),
  // A building: two strokes of the chisel, a stone set, and its colour's
  // string. Built free from an earlier card, a bell rings the link.
  build: (a, o, t, { color, how } = {}) => {
    const pitch = vary(1, 0.05);
    chisel(a, o, t, 0.18, pitch);
    chisel(a, o, t + 0.11, 0.14, pitch * 1.04);
    block(a, o, t + 0.22);
    lyre(a, o, t + 0.24, note(colorNote(color)), 0.055, 0.9);
    if (how === "chain") bell(a, o, t + 0.34, note(colorNote(color) + 5), 0.018, 0.5);
  },
  // A wonder stage: a chisel's last stroke, a great block bedding down, and
  // a low chord that rises with each stage.
  stage: (a, o, t, { n = 0 } = {}) => {
    chisel(a, o, t, 0.1, 0.9);
    slab(a, o, t + 0.1);
    const root = [-5, -4, -3][Math.min(2, Math.max(0, n))];
    strum(a, o, t + 0.16, [root, root + 2, root + 3, root + 5], 0.07, 1.4, 0.04);
    tone(a, o, t + 0.12, { freq: note(root), dur: 0.9, gain: 0.04, attack: 0.04 });
  },
  // A card sold: slid away, and the bank's three coins dropped on your pile,
  // each a step lower.
  sell: (a, o, t) => {
    slide(a, o, t, { dur: 0.09, gain: 0.08, from: 2800, to: 1200 });
    [13, 12, 11].forEach((s, i) => drop(a, o, t + 0.12 + i * vary(0.075, 0.1), note(s), 0.05));
  },
  // Coins coming to you: they ring rising, one per coin (up to five), and a
  // bright string answers.
  coins: (a, o, t, { n = 3 } = {}) => {
    const k = Math.min(5, Math.max(1, Math.round(n)));
    for (let i = 0; i < k; i++) clink(a, o, t + i * vary(0.06, 0.1), note(13 + i), 0.045);
    lyre(a, o, t + k * 0.06 + 0.02, note(10), 0.05, 0.8);
  },
  // Coins paid to a neighbour: pushed across the table, landing on their
  // side a step down, a little muffled by the distance.
  trade: (a, o, t, { n = 2 } = {}) => {
    const k = Math.min(3, Math.max(1, Math.round(n)));
    scrape(a, o, t, note(14), 0.22, 0.05);
    const far = a.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 3500;
    far.connect(o);
    for (let i = 0; i < k; i++) clink(a, far, t + 0.2 + i * 0.075, note(13 - i), 0.05, 0.16);
  },
  // Bought from a neighbour: over a bridge, a small cart's wheels rumble
  // from cobble to cobble, slowing as it arrives, and its axle ticks twice;
  // by the ferry, two pulls on the creaking rope, the river lapping at the
  // raft after each, and the raft nudging the bank. Quiet and low, so the
  // coins going the other way ring over it.
  cart: (a, o, t, { way = "bridge" } = {}) => {
    if (way === "ferry") {
      for (const [at, k] of [[0, 1], [0.58, 0.85]]) {
        creak(a, o, t + at, { dur: vary(0.22, 0.1), gain: 0.24 * k, from: vary(38, 0.1), to: vary(68, 0.1) });
        for (const [d, f, g] of [[0.12, 360, 1], [0.27, 460, 0.6], [0.4, 400, 0.35]]) {
          wash(a, o, t + at + vary(d, 0.08), { kind: "brown", freq: vary(f, 0.1), to: f * 1.8, q: 2, dur: 0.17, gain: 0.32 * k * g, rise: 0.35 });
        }
        wash(a, o, t + at + 0.18, { type: "highpass", freq: 3200, dur: 0.3, gain: 0.006 * k, rise: 0.3 });
        plip(a, o, t + at + vary(0.3, 0.1), note(7) * vary(1, 0.08), 0.055 * k);
        plip(a, o, t + at + vary(0.45, 0.1), note(9) * vary(1, 0.08), 0.04 * k);
      }
      knock(a, o, t + 1.24, 0.065, 0.45);
      noise(a, o, t + 1.24, { kind: "brown", dur: 0.12, gain: 0.2, type: "lowpass", freq: 260 });
      return;
    }
    wash(a, o, t, { kind: "brown", freq: 210, q: 0.9, dur: 1.25, gain: 0.12, rise: 0.35 });
    wash(a, o, t, { freq: 300, q: 1, dur: 1.2, gain: 0.03, rise: 0.4 });
    wash(a, o, t + 0.1, { freq: 1300, to: 1000, q: 2.5, dur: 1, gain: 0.008, rise: 0.4 });
    let at = t + 0.04;
    for (let i = 0; i < 9; i++) {
      const k = 0.35 + 0.65 * Math.sin((Math.PI * i) / 8) ** 0.8;
      // One wheel drops off the cobble, then the other.
      for (const [d, w] of [[0, 1], [vary(0.032, 0.25), 0.55]]) {
        tone(a, o, at + d, { freq: vary(150, 0.12), to: 100, dur: 0.05, gain: 0.06 * k * w });
        noise(a, o, at + d, { dur: 0.04, gain: 0.2 * k * w, freq: vary(430, 0.15), q: 1.3 });
        noise(a, o, at + d, { dur: 0.012, gain: 0.04 * k * w, freq: vary(950, 0.2), q: 1.6 });
      }
      at += vary(0.115 + (i > 5 ? 0.012 * (i - 5) : 0), 0.12);
    }
    for (const [d, pitch] of [[0.32, 2.4], [0.8, 2.2]]) knock(a, o, t + d, 0.06, pitch);
  },
  // Something built on the border. A bridge: its stones set from each bank
  // in turn, the keystone slid down between them, and a warm string as the
  // arch holds. A stall: its awning shaken out and snapped taut, the prop
  // knocked into place, and a bright string.
  lay: (a, o, t, { kind = "bridge" } = {}) => {
    if (kind === "stall") {
      // The canvas flutters as it is shaken out, each shake a little higher.
      for (let i = 0; i < 3; i++) wash(a, o, t + i * 0.045, { freq: 650 * 1.35 ** i, to: 1300 * 1.35 ** i, q: 1.1, dur: 0.08, gain: 0.072 + 0.03 * i, rise: 0.7 });
      const snap = t + 0.14;
      noise(a, o, snap, { dur: 0.03, gain: 0.31, freq: 1500, q: 0.7, attack: 0.004 });
      noise(a, o, snap, { dur: 0.01, gain: 0.085, type: "highpass", freq: 3500 });
      noise(a, o, snap, { kind: "brown", dur: 0.06, gain: 0.19, type: "lowpass", freq: 500 });
      tone(a, o, snap, { freq: 190, to: 120, dur: 0.07, gain: 0.13 });
      noise(a, o, snap + 0.07, { dur: 0.03, gain: 0.07, freq: 1000, q: 1, attack: 0.008 });
      noise(a, o, snap + 0.13, { dur: 0.03, gain: 0.05, freq: 900, q: 1, attack: 0.008 });
      knock(a, o, t + 0.37, 0.18);
      lyre(a, o, t + 0.38, note(7), 0.085, 0.8);
      return;
    }
    for (const [at, pitch, k] of [[0, 0.92, 0.6], [0.15, 1.08, 0.68], [0.29, 0.98, 0.76], [0.42, 1.14, 0.85]]) block(a, o, t + vary(at, 0.04), 0.15 * k, vary(pitch, 0.03));
    wash(a, o, t + 0.55, { freq: 2100, to: 1100, q: 2.2, dur: 0.09, gain: 0.04, rise: 0.6 });
    block(a, o, t + 0.64, 0.22, 0.78);
    tone(a, o, t + 0.64, { freq: 120, to: 80, dur: 0.12, gain: 0.08, attack: 0.005 });
    lyre(a, o, t + 0.66, note(-2), 0.085, 1.4);
    lyre(a, o, t + 0.66, note(3), 0.03, 1);
  },
  // The stacks of hands dragged round to the next seat: the weight of a
  // stack on the table, its pitch climbing going left and falling going
  // right, and the cards knocking square as each stack stops.
  pass: (a, o, t, { dir = 1 } = {}) => {
    const left = dir === "left" || dir > 0;
    const [from, to] = left ? [520, 1250] : [1250, 520];
    wash(a, o, t, { freq: from, to, q: 0.8, dur: 0.42, gain: 0.1, rise: 0.45 });
    wash(a, o, t, { freq: 300, q: 0.7, dur: 0.4, gain: 0.07, rise: 0.4 });
    wash(a, o, t + 0.03, { freq: from * 2.6, to: to * 2.6, q: 0.9, dur: 0.36, gain: 0.03, rise: 0.4 });
    for (const [at, k] of [[0.42, 1], [0.5, 0.6]]) {
      pat(a, o, t + at, 0.1 * k);
      tone(a, o, t + at, { freq: 170, to: 110, dur: 0.05, gain: 0.05 * k });
      for (let i = 0; i < 3; i++) noise(a, o, t + at + 0.03 + i * vary(0.022, 0.2), { dur: 0.01, gain: 0.04 * k * 0.75 ** i, freq: vary(2600, 0.15), q: 1.5 });
    }
  },
  // The war at the end of an age: a drum far off, and a horn calling over
  // the hills, its echo coming back.
  war: (a, o, t) => {
    const far = a.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 1600;
    far.connect(o);
    for (const [d, g] of [[0, 1], [0.24, 0.75], [0.36, 0.9]]) drum(a, far, t + d, 0.24 * g);
    horn(a, far, t + 0.44, note(-2), { dur: 0.3, gain: 0.11 });
    horn(a, far, t + 0.72, note(0), { dur: 0.55, gain: 0.12 });
    horn(a, far, t + 1.0, note(0), { dur: 0.45, gain: 0.03, open: 2 });
    drum(a, far, t + 1.0, 0.06);
  },
  // One shield stepping into line at a border. They come one after another
  // (`i` counts them from 0), each a shade higher than the last.
  shield: (a, o, t, { i = 0 } = {}) => {
    const step = Math.min(14, Math.max(0, i));
    shieldTap(a, o, t, vary(0.12, 0.08), vary(1 + 0.025 * step, 0.01));
  },
  // The result stamped on a border: the block comes down on the paper and
  // the table under it. A win rings a bright fifth, a loss a low string, a
  // draw only knocks. The token's own fanfare or thud follows.
  stamp: (a, o, t, { result = 0 } = {}) => {
    noise(a, o, t, { dur: 0.03, gain: 0.2, freq: 1100, q: 1 });
    noise(a, o, t, { dur: 0.012, gain: 0.05, type: "highpass", freq: 3800 });
    tone(a, o, t, { freq: 340, to: 240, dur: 0.05, gain: 0.14 });
    tone(a, o, t, { freq: 165, to: 90, dur: 0.1, gain: 0.16, attack: 0.004 });
    noise(a, o, t, { kind: "brown", dur: 0.08, gain: 0.14, type: "lowpass", freq: 450 });
    if (result > 0) {
      lyre(a, o, t + 0.03, note(5), 0.055, 0.6);
      lyre(a, o, t + 0.06, note(8), 0.05, 0.7);
    } else if (result < 0) lyre(a, o, t + 0.03, note(-5), 0.075, 0.7);
    else knock(a, o, t + 0.09, 0.11, 0.85);
  },
  // A victory token: a quick brass "ta-ta-taa" over a bright string, the
  // bigger the token the higher it climbs.
  victory: (a, o, t, { value = 1 } = {}) => {
    const run = value >= 5 ? [5, 7, 8, 10] : value >= 3 ? [5, 7, 10] : [5, 8];
    run.forEach((s, i) => {
      const last = i === run.length - 1;
      trumpet(a, o, t + i * 0.1, note(s), last ? 0.42 : 0.1);
      lyre(a, o, t + i * 0.1, note(s + 5), last ? 0.06 : 0.04, last ? 1 : 0.4);
    });
    bell(a, o, t + (run.length - 1) * 0.1, note(run.at(-1) + 5), 0.02, 0.7);
  },
  // A defeat token: a soft low thud and a string sinking.
  defeat: (a, o, t) => {
    tone(a, o, t, { freq: 90, to: 50, dur: 0.24, gain: 0.25, attack: 0.006 });
    tone(a, o, t, { freq: 180, to: 120, dur: 0.1, gain: 0.08, attack: 0.006 });
    noise(a, o, t, { kind: "brown", dur: 0.16, gain: 0.25, type: "lowpass", freq: 300 });
    lyre(a, o, t + 0.05, note(0), 0.06, 0.7);
    lyre(a, o, t + 0.2, note(-3), 0.06, 0.9);
  },
  // Looking through the discards: cards leafed through, one turned up.
  dig: (a, o, t) => {
    // Leafing slows as the eye catches something.
    let at = t;
    for (let i = 0; i < 7; i++) {
      slide(a, o, at, { dur: vary(0.07, 0.3), gain: vary(0.06, 0.25), from: vary(3500, 0.25), to: vary(2000, 0.25), q: 1.1, attack: 0.015 });
      at += vary(0.045 + i * 0.008, 0.3);
    }
    flip(a, o, at + 0.06, 0.08);
  },
  // One row of the score sheet: a stylus scratching a tally, and a soft
  // string that climbs a step with each row.
  score: (a, o, t, { row = 0 } = {}) => {
    noise(a, o, t, { dur: 0.035, gain: 0.08, freq: vary(4200, 0.08), to: 3000, q: 1.6, attack: 0.01 });
    noise(a, o, t + 0.03, { dur: 0.012, gain: 0.07, type: "highpass", freq: 3000 });
    tone(a, o, t + 0.03, { freq: 520, dur: 0.025, gain: 0.025 });
    lyre(a, o, t + 0.04, note(5 + Math.min(9, Math.max(0, row))), 0.045, 0.6);
  },
};

const sound = (name, role, step, trim, offset = 0) => ({ role, ...(offset && { offset }), synth: crowded(name, step, SYNTH[name]), trim });

export const sounds = defineSounds({
  ...cardSounds,
  ...tableSounds,
  deal: sound("deal", "action", 0.2, 5.8),
  pick: sound("pick", "action", 0.06, 10.2, -2),
  tap: sound("tap", "ui", 0.03, 18.9, -3),
  reveal: sound("reveal", "action", 0.07, 16.7, -2),
  build: sound("build", "action", 0.09, 8.5),
  stage: sound("stage", "highlight", 0.14, 0),
  sell: sound("sell", "action", 0.08, 8.9),
  coins: sound("coins", "action", 0.07, 6.9),
  trade: sound("trade", "action", 0.08, 7.5),
  cart: sound("cart", "action", 0.2, 11, -5),
  lay: sound("lay", "action", 0.15, 5.6),
  pass: sound("pass", "action", 0.1, 10.2, -4),
  war: sound("war", "highlight", 0.3, 0.9),
  shield: sound("shield", "ui", 0.06, 10.2),
  stamp: sound("stamp", "action", 0.12, 5),
  victory: sound("victory", "highlight", 0.45, 11),
  defeat: sound("defeat", "highlight", 0.3, 3.6, -3),
  dig: sound("dig", "action", 0.2, 19.2, -2),
  score: sound("score", "ui", 0.08, 8.4),
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
