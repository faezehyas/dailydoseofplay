// Hexlands' tutorial lessons (see engine/tutorial.js), all on one island
// (BOARD) with three seats: you (0, coral), Teal (1) and Violet (2). Every
// card is known, so a lesson plays the same for everyone: a card is named by
// its kind and a number, "wood1" to "wood19" (and brick, wool, grain, ore)
// and "knight1" to "knight14", "vp1" to "vp5", "road1", "plenty1",
// "monopoly1" and so on, which is its face in the deck (rules.js). A position
// is
//   { setup: { order, i } }   the opening, seats placing in that order
//   or { phase: "roll" | "main" }   your turn, before or after the roll
// with, by seat, settlements, cities, roads (edges; road(a, b) is the path
// from corner a to corner b), hands ("wood1 brick2"), devs (development cards
// in hand), and optionally devPile (its top cards, the rest following),
// robber (the desert by default), dice, longest, army and knights. The bank
// holds every resource card nobody has. Moves are the game's own; a road,
// settlement or city the step asks for leaves out `pay`, which the board
// adds. A roll's dice are the step's `dice`, or a reply's own (`{ roll: true,
// dice }`). A reply is a list of moves, each by whoever is to move then.
// Cells are corners ("c12"), paths ("e30") and hexes ("h4") on the island,
// and the controls: "roll", "end", "trade", the builds ("road",
// "settlement", "city", "dev"), the bank trade's "give-<r>", "take-<r>" and
// "swap", your hand's piles ("pile-<r>") and its "knight".
import { CORNERS, EDGES, HARBOUR_EDGES, ANY, WOOD, BRICK, WOOL, GRAIN, ORE, DESERT } from "./board.js";
import { FIRST_DEV, PER_RESOURCE } from "./rules.js";

// The classic first island: terrain and numbers in reading order, the desert in the middle.
const [F, H, P, Fi, M, D] = [WOOD, BRICK, WOOL, GRAIN, ORE, DESERT];
export const BOARD = {
  terrain: [M, P, F, Fi, H, P, H, Fi, F, D, F, M, F, M, Fi, P, H, Fi, P],
  numbers: [10, 2, 9, 12, 6, 4, 10, 9, 11, 0, 3, 8, 8, 3, 4, 5, 5, 6, 11],
  harbours: [WOOL, ANY, ORE, ANY, ANY, BRICK, WOOD, GRAIN, ANY].map((kind, i) => ({ edge: HARBOUR_EDGES[i], kind })),
  desert: 9,
};

const RES = ["wood", "brick", "wool", "grain", "ore"];
const DEVS = { knight: [0, 14], vp: [14, 5], road: [19, 2], plenty: [21, 2], monopoly: [23, 2] };
// "wool3" -> its face.
export function card(name) {
  const [, kind, num] = /^([a-z]+)(\d+)$/.exec(name) ?? [];
  const n = Number(num) - 1;
  const r = RES.indexOf(kind);
  if (r >= 0 && n >= 0 && n < PER_RESOURCE) return r * PER_RESOURCE + n;
  if (DEVS[kind] && n >= 0 && n < DEVS[kind][1]) return FIRST_DEV + DEVS[kind][0] + n;
  throw new Error(`no card ${name}`);
}
export const cards = (names = "") => names.split(" ").filter(Boolean).map(card);
export function road(a, b) {
  const e = CORNERS[a].edges.find((id) => EDGES[id].a === Math.min(a, b) && EDGES[id].b === Math.max(a, b));
  if (e === undefined) throw new Error(`no path from ${a} to ${b}`);
  return e;
}

const settle = (c) => ({ settle: c });
const build = (a, b) => ({ road: road(a, b) });
const roll = (a, b) => ({ roll: true, dice: [a, b] });
const end = { end: true };

// After the opening: your two settlements and roads, Teal's and Violet's.
const opened = {
  settlements: [[44, 14], [31, 41], [12, 28]],
  roads: [[road(44, 48), road(14, 9)], [road(31, 37), road(41, 46)], [road(12, 17), road(28, 22)]],
};

export const lessons = [
  {
    title: "Settling the island",
    steps: [
      {
        text: "Each hex grows something: forests wood, hills brick, pastures wool, fields grain and mountains ore. Settle on the lit corner, where three of them meet.",
        position: { setup: { order: [1, 2, 0, 0, 2, 1], i: 2 }, settlements: [[], [31], [12]], roads: [[], [road(31, 37)], [road(12, 17)]] },
        highlight: ["c44", "h13", "h16", "h17"],
        expect: settle(44),
      },
      {
        text: "When a hex's number is rolled, it pays every settlement on it; the more dots under the number, the more often. Now a road beside your settlement: tap a lit path.",
        highlight: [`e${road(44, 39)}`, `e${road(44, 40)}`, `e${road(44, 48)}`],
        expect: [build(44, 39), build(44, 40), build(44, 48)],
      },
      {
        text: "Everyone places two. Your second settlement collects a card from each hex it touches: settle on the lit corner by the forest 9.",
        highlight: ["c14", "h2", "h5", "h6"],
        expect: settle(14),
      },
      {
        text: "Wood, wool and brick, straight into your hand. Finish with a road beside your new settlement.",
        highlight: [`e${road(14, 9)}`, `e${road(14, 10)}`, `e${road(14, 19)}`],
        expect: [build(14, 9), build(14, 10), build(14, 19)],
      },
    ],
  },
  {
    title: "Rolling for resources",
    steps: [
      {
        text: "Every turn starts with a roll. Each hex with that number pays a card to every settlement on it. Roll the dice.",
        position: { phase: "roll", ...opened, hands: ["wood1 wool1 brick1", "grain1 ore1 wool2", "grain2 wood2 brick2"] },
        highlight: ["roll"],
        dice: [2, 3],
        expect: { roll: true },
      },
      {
        text: "A 5: the hills paid you a brick, and the pasture paid Teal twice. You'll build in the next lesson, so end your turn.",
        highlight: ["end"],
        expect: end,
        reply: [roll(6, 4), end, roll(5, 4), end],
      },
      {
        text: "Teal rolled a 10 and Violet a 9, and both paid you: every roll counts, not only yours. Your turn again: roll.",
        highlight: ["roll"],
        dice: [1, 2],
        expect: { roll: true },
      },
    ],
  },
  {
    title: "Roads and settlements",
    steps: [
      {
        text: "A road costs a wood and a brick, and joins your roads or buildings. Tap Road, then the lit path.",
        position: { phase: "main", ...opened, hands: ["wood1 wood2 brick1 brick2 wool1 grain1", "ore1 wool2", "grain2"], dice: [4, 2] },
        highlight: ["road", `e${road(9, 13)}`],
        expect: build(9, 13),
      },
      {
        text: "A settlement costs a wood, a brick, a wool and a grain. It goes on your road, at least two paths from any building. Tap Settlement, then the lit corner.",
        highlight: ["settlement", "c13"],
        expect: settle(13),
      },
    ],
  },
  {
    title: "Cities and development cards",
    steps: [
      {
        text: "A city takes the place of a settlement and collects two cards instead of one: it's worth 2 points. It costs 2 grain and 3 ore. Tap City, then your lit settlement.",
        position: {
          phase: "main",
          settlements: [[44, 14, 13], [31, 41], [12, 28]],
          roads: [[road(44, 48), road(14, 9), road(9, 13)], opened.roads[1], opened.roads[2]],
          hands: ["grain1 grain2 grain3 ore1 ore2 ore3 ore4 wool1", "wood1 brick1", "wool2 grain4"],
          devPile: "knight1",
          dice: [5, 3],
        },
        highlight: ["city", "c44"],
        expect: { city: 44 },
      },
      {
        text: "A development card costs a wool, a grain and an ore. It might be a knight, a hidden point or a handy trick. Buy one.",
        highlight: ["dev"],
        expect: { buy: true },
      },
    ],
  },
  {
    title: "The robber and knights",
    steps: [
      {
        text: "Roll the dice. A 7 pays nobody: it wakes the robber, and anyone holding more than 7 cards gives back half.",
        position: {
          phase: "roll",
          settlements: [[14, 13], [31, 41], [12, 28]],
          cities: [[44], [], []],
          roads: [[road(44, 48), road(14, 9), road(9, 13)], opened.roads[1], opened.roads[2]],
          hands: ["wood1 wool1", "ore1 wool2 grain1", "brick1 grain2 wood2"],
          devs: ["knight1", "", ""],
        },
        highlight: ["roll"],
        dice: [3, 4],
        expect: { roll: true },
      },
      {
        text: "Move the robber: its hex pays nothing while it stays, and you steal a card from someone there. Put it on Teal's mountains 8.",
        highlight: ["h11"],
        arrows: [["h9", "h11"]],
        expect: { robber: 11, steal: 1 },
      },
      {
        text: "You stole Teal's ore! A knight moves the robber too, and the one you bought last turn is ready: tap it in your hand.",
        highlight: ["knight"],
        expect: { play: card("knight1") },
      },
      {
        text: "Play three knights and the largest army is yours: 2 points. Now steal from Violet: put the robber on her forest 8.",
        highlight: ["h12"],
        arrows: [["h11", "h12"]],
        expect: { robber: 12, steal: 2 },
      },
    ],
  },
  {
    title: "Trading and winning",
    steps: [
      {
        text: "You have 9 points, and 10 wins! You need a grain. Your settlement on the wool harbour swaps 2 wool for any card: tap Trade, then give wool for grain.",
        position: {
          phase: "main",
          settlements: [[13, 5, 51], [31, 41], [12, 28]],
          cities: [[44, 14], [], []],
          roads: [
            [road(44, 48), road(48, 51), road(14, 9), road(9, 5), road(9, 13), road(13, 18), road(18, 24), road(24, 30)],
            [...opened.roads[1], road(31, 36)],
            [...opened.roads[2], road(28, 34)],
          ],
          longest: 0,
          hands: ["wood1 brick1 wool1 wool2 wool3", "ore1 grain1 wood2", "brick2 wool4"],
          dice: [6, 2],
        },
        highlight: ["trade", "c5"],
        expect: { bank: cards("wool1 wool2"), take: GRAIN },
      },
      {
        text: "Away from a harbour the bank takes 4 of a kind, and you can offer trades to the others too. Now build a settlement on the lit corner for your tenth point!",
        highlight: ["settlement", "c30"],
        expect: settle(30),
      },
    ],
  },
];
