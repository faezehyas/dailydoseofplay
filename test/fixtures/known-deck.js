// A deck for rules tests that knows every face, with the same API the rules
// get from CardMatch (see public/engine/card-match.js): cards, face, owner,
// deal, pass, open and shuffle. view(seat) is the face function a seat's robot
// would get: its own cards, the open ones and the ones it passed on.
import { RuleError } from "../../public/engine/turn-match.js";
import { rngFromSeed } from "../../public/engine/rng.js";

export class KnownDeck {
  // faces: the deck, top first; seed: how shuffle() reorders.
  constructor(faces, seed = "known") {
    this.slots = faces.map((face) => ({ face, owner: -1, open: false, gone: false, held: [] }));
    this.cards = faces.map((_, i) => i);
    this.rng = rngFromSeed(seed);
    this.ops = [];
  }
  #get(id) {
    const s = this.slots[id];
    if (!s || s.gone) throw new RuleError(`no card in slot ${id}`);
    return s;
  }
  // With `blind` set, a hidden card's face is null, as in play.
  face(id) {
    const s = this.#get(id);
    return this.blind && !s.open ? null : s.face;
  }
  owner(id) {
    return this.#get(id).owner;
  }
  deal(id, seat) {
    const s = this.#get(id);
    if (s.owner !== -1 && s.owner !== seat && !s.open) throw new RuleError("a hidden card in a hand changes hands with deck.pass()");
    s.owner = seat;
    this.ops.push({ type: "deal", id, seat });
  }
  pass(id, seat) {
    const s = this.#get(id);
    if (s.owner === -1) throw new RuleError("only a card in a hand can be passed");
    if (s.owner === seat) return;
    s.held.push(s.owner); // CardMatch would deal a card passed in its dealing call straight on
    s.owner = seat;
    this.ops.push({ type: "pass", id, seat });
  }
  open(id) {
    this.#get(id).open = true;
    this.ops.push({ type: "open", id });
  }
  shuffle(ids) {
    const faces = ids.map((id) => {
      const s = this.#get(id);
      s.gone = true;
      return s.face;
    });
    for (let i = faces.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [faces[i], faces[j]] = [faces[j], faces[i]];
    }
    this.ops.push({ type: "shuffle", ids });
    return faces.map((face) => this.slots.push({ face, owner: -1, open: false, gone: false, held: [] }) - 1);
  }
  // What `seat` may see: its own cards, the open ones and the ones it passed on.
  view(seat) {
    return (id) => {
      const s = this.slots[id];
      return s && (s.open || s.owner === seat || s.held.includes(seat)) ? s.face : null;
    };
  }
}

// A full deck in a seeded order, top first.
export function shuffled(seed) {
  const rng = rngFromSeed(seed);
  const faces = [...Array(52).keys()];
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  return faces;
}

// Runs settle() until it stops dealing, as CardMatch does; returns its events.
export function settleAll(rules, state, deck) {
  const events = [];
  for (let i = 0; i < 64; i++) {
    const before = deck.ops.length;
    events.push(...(rules.settle?.(state, deck) ?? []));
    if (deck.ops.length === before) return events;
  }
  throw new Error("settle kept dealing");
}
