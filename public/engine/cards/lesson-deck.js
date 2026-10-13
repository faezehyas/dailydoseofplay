// The deck a card game's tutorial plays with (see "Tutorials" in
// ARCHITECTURE.md): every card is known and a slot is its face, so a lesson's
// hands are fixed and the same for everyone. No key, no shuffle and no
// mental poker: the rules get the deck API of engine/card-match.js with
// nothing hidden. Pure, so lessons.test.js uses it too.
import { RuleError } from "../turn-match.js";
import { DECK, RANK_NAMES } from "./faces.js";

// "10H" -> the face of the ten of hearts (suits S, H, D, C as in faces.js).
export function card(name) {
  const suit = "SHDC".indexOf(name.at(-1));
  const rank = RANK_NAMES.indexOf(name.slice(0, -1));
  if (suit < 0 || rank < 0) throw new Error(`no card ${name}`);
  return suit * 13 + rank;
}
export const cards = (names) => names.map(card);

// The deck API, with every face known: the rules' deals, opens and passes change nothing anyone sees.
export function lessonDeck() {
  const deck = {
    cards: [...Array(DECK).keys()],
    ops: 0,
    face: (slot) => slot,
    deal: () => void deck.ops++,
    open: () => void deck.ops++,
    pass: () => void deck.ops++,
    shuffle: () => {
      throw new Error("a lesson doesn't shuffle");
    },
  };
  return deck;
}

// Plays a move for the side to move as CardMatch would (then settle, until
// it deals no more) and returns its events. A refusal reads as a sentence:
// "Play a ♥, a 9 or an 8".
export function lessonMove(rules, state, move) {
  const deck = lessonDeck();
  let events;
  try {
    events = rules.applyMove(state, state.turn, move, deck);
  } catch (err) {
    if (err instanceof RuleError) throw new RuleError(err.message[0].toUpperCase() + err.message.slice(1));
    throw err;
  }
  for (let i = 0; i < 64; i++) {
    const before = deck.ops;
    events.push(...(rules.settle?.(state, deck) ?? []));
    if (deck.ops === before) break;
  }
  return events;
}
