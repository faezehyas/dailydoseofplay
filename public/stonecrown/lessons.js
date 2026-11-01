// Stonecrown's tutorial lessons (see engine/tutorial.js), all at a table of
// three: you (seat 0, the Great Pyramid of Giza, which makes stone), Teal
// (seat 1, your left neighbour, the Colossus of Rhodes: ore) and Violet
// (seat 2, your right neighbour, the Hanging Gardens of Babylon: clay), every
// wonder on side A. Every card is known, so a lesson plays the same for
// everyone: a card is named by its key in cards.js ("hot-springs"), with
// "/2" for the age II copy of a grey card ("glass-kiln/2"), and with three
// players each design is in the deck once, so the name is the card. A
// position is
//   { age, round, hands, city, stages, coins, tokens, discard }
// by seat: hands and city as card names ("hot-springs west-road"), stages
// the number of wonder stages built, coins and tokens as in the state, and
// discard the cards in the discard pile. Cards tucked under a wonder are
// face down, so any card nobody holds does. Moves are the game's own; a
// build the step asks for leaves out `buy`, which the board adds (the
// cheapest way, as the game picks). Everyone picks at once, so each step's
// `others` are Teal's and Violet's picks for the same turn.
// Cells: your hand's cards ("card-<slot>", hand(name)), the buttons
// ("build", "stage", "sell"), the card's detail ("detail"), your wonder
// ("board"), city ("city"), coins, shields and war tokens ("coins",
// "shields", "tokens"), a built card in your city ("chip-<id>", chip(name)),
// a neighbour's panel and what it sells ("seat-1", "sells-1"), the top bar's
// "age" and "pass", the discard "pile", "picks" (who has picked) and your
// score sheet "total".
import { CARDS } from "./cards.js";
import { deckOf } from "./rules.js";

export const PLAYERS = 3;
export const WONDER_KEYS = ["giza", "rhodes", "babylon"];

// "glass-kiln/2" -> its face.
export function card(name) {
  const [key, age] = name.split("/");
  const design = CARDS.find((c) => c.key === key && (age ? c.age === Number(age) : true));
  const face = design ? deckOf(PLAYERS).indexOf(design.id) : -1;
  if (face < 0) throw new Error(`no card ${name} with ${PLAYERS} players`);
  return face;
}
export const cards = (names = "") => names.split(" ").filter(Boolean).map(card);
export const hand = (name) => `card-${card(name)}`;
export const chip = (name) => `chip-${CARDS.find((c) => c.key === name.split("/")[0]).id}`;

const build = (name) => ({ build: card(name) });
const sell = (name) => ({ discard: card(name) });
const each = (names, kind) => cards(names).map((slot) => ({ [kind]: slot }));

export const lessons = [
  {
    title: "Picking and building",
    steps: [
      {
        text: "Everyone picks a card at the same time: Teal and Violet have chosen theirs. Your wonder makes a stone every turn, and Hot Springs costs one stone. Tap it, then Build.",
        position: {
          age: 1,
          round: 1,
          hands: ["hot-springs shrine amphitheatre east-road glass-kiln herbalist copy-house", "palisade ore-seam stone-cut red-hollow weavers-hall artisans-row guard-post", "hillside-clearing woodcutters-camp clay-bank west-road reed-press tinkers-shed watchtower"],
        },
        highlight: [hand("hot-springs"), "board"],
        expect: build("hot-springs"),
        others: [build("ore-seam"), build("woodcutters-camp")],
      },
      {
        text: "Hands pass on after every turn: these are Violet's cards. Some cost coins, paid to the bank. Build Hillside Clearing for 1 coin: it makes a stone or a wood each turn.",
        highlight: [hand("hillside-clearing"), "coins"],
        expect: build("hillside-clearing"),
        others: [build("shrine"), build("stone-cut")],
      },
      {
        text: "Resources aren't used up: they make the same again every turn. Palisade costs a wood, and your clearing makes one. Build it for a shield.",
        highlight: [hand("palisade"), chip("hillside-clearing")],
        expect: build("palisade"),
        others: [build("clay-bank"), build("east-road")],
      },
    ],
  },
  {
    title: "Buying and chains",
    steps: [
      {
        text: "Watchtower needs clay, which you don't make. Buy it from a neighbour for 2 coins, or 1 from Teal with your West Road. Build picks the cheapest way: build Watchtower.",
        position: {
          age: 1,
          round: 2,
          hands: ["watchtower palisade herbalist shrine glass-kiln red-hollow", "woodcutters-camp ore-seam east-road artisans-row copy-house amphitheatre", "hot-springs hillside-clearing weavers-hall reed-press tinkers-shed guard-post"],
          city: ["west-road", "clay-bank", "stone-cut"],
        },
        highlight: [hand("watchtower"), "sells-1", "build"],
        expect: build("watchtower"),
        others: [build("woodcutters-camp"), build("hot-springs")],
      },
      {
        text: "From age II, many cards chain from an earlier one: they're free if your city holds the card they name. Water Channel chains from your Hot Springs. Build it free.",
        position: {
          age: 2,
          round: 1,
          hands: [
            "water-channel timber-mill sanctuary ramparts scroll-hall agora glass-kiln/2",
            "great-quarry brickworks bronze-figure horse-paddock infirmary caravan-yard weavers-hall/2",
            "smeltery hall-of-laws olive-press bow-yard inventors-hall tutors-court reed-press/2",
          ],
          city: ["hot-springs west-road watchtower woodcutters-camp shrine palisade", "clay-bank ore-seam east-road guard-post amphitheatre glass-kiln", "stone-cut hillside-clearing weavers-hall reed-press tinkers-shed herbalist"],
          coins: [4, 5, 3],
          tokens: [[1, 1], [1, -1], [-1, -1]],
          discard: "red-hollow artisans-row copy-house",
        },
        highlight: [hand("water-channel"), chip("hot-springs")],
        expect: build("water-channel"),
        others: [build("great-quarry"), build("smeltery")],
      },
    ],
  },
  {
    title: "Wonder stages and selling",
    steps: [
      {
        text: "Your wonder has stages to build in order. Stage I costs 2 stone and is worth 3 points. Pay with any card: it's tucked face down under the wonder. Pick one, then Wonder stage.",
        position: {
          age: 1,
          round: 3,
          hands: ["tinkers-shed east-road amphitheatre red-hollow weavers-hall", "hot-springs palisade guard-post reed-press artisans-row", "shrine watchtower west-road copy-house herbalist"],
          city: ["stone-cut woodcutters-camp", "ore-seam clay-bank", "hillside-clearing glass-kiln"],
        },
        highlight: ["board", "stage"],
        expect: each("tinkers-shed east-road amphitheatre red-hollow weavers-hall", "stage"),
        others: [build("guard-post"), build("shrine")],
      },
      {
        text: "Short of coins? Sell any card face down for 3 coins. You can always do this, and nobody sees which card it was. Pick one, then Sell for 3.",
        position: {
          age: 1,
          round: 4,
          hands: ["watchtower west-road copy-house herbalist", "east-road amphitheatre red-hollow weavers-hall", "hot-springs palisade reed-press artisans-row"],
          city: ["stone-cut woodcutters-camp", "ore-seam clay-bank guard-post", "hillside-clearing glass-kiln shrine"],
          stages: [1, 0, 0],
          coins: [1, 3, 3],
        },
        highlight: ["sell", "coins"],
        expect: each("watchtower west-road copy-house herbalist", "discard"),
        others: [build("east-road"), build("hot-springs")],
      },
    ],
  },
  {
    title: "Passing hands and war",
    steps: [
      {
        text: "Hands go left to Teal in ages I and III, and right to Violet in age II, so think about what you pass on. Build Guard Post for a shield, then watch the hands move.",
        position: {
          age: 1,
          round: 5,
          hands: ["guard-post herbalist artisans-row", "red-hollow east-road tinkers-shed", "palisade weavers-hall copy-house"],
          city: ["ore-seam woodcutters-camp hot-springs shrine", "stone-cut watchtower clay-bank amphitheatre", "hillside-clearing glass-kiln reed-press west-road"],
        },
        highlight: [hand("guard-post"), "pass"],
        expect: build("guard-post"),
        others: [build("east-road"), build("weavers-hall")],
      },
      {
        text: "The last turn of the age: you keep one of your two cards, and the other is discarded. Then each neighbour's shields are compared with yours, and more wins. Build Palisade to beat both!",
        highlight: [hand("palisade"), "shields"],
        expect: build("palisade"),
        others: [build("artisans-row"), build("red-hollow")],
      },
    ],
  },
  {
    title: "Science and the final score",
    steps: [
      {
        text: "Each science symbol scores its count squared, plus 7 for every set of star, cog and quill. You have a star and two quills: build Thinkers' Nook for a cog and a full set.",
        position: {
          age: 3,
          round: 5,
          hands: ["thinkers-nook clockworks crown-hall", "elders-chamber lyceum judges-guild", "rose-gardens healers-retreat masons-guild"],
          city: [
            "woodcutters-camp reed-press weavers-hall herbalist copy-house amphitheatre palisade scroll-hall bronze-figure timber-mill ramparts agora council-house armoury",
            "ore-seam clay-bank stone-cut east-road guard-post glass-kiln smeltery great-quarry water-channel sanctuary olive-press weavers-hall/2 temple-of-all harbour",
            "hillside-clearing red-hollow shrine hot-springs west-road watchtower tinkers-shed brickworks glass-kiln/2 hall-of-laws bow-yard infirmary stargazers-school hippodrome",
          ],
          stages: [2, 2, 1],
          coins: [6, 4, 5],
          tokens: [[1, 1, 3, 3], [-1, 1, -1, -1], [-1, -1, 3, -1]],
          discard: "artisans-row caravan-yard tutors-court horse-paddock",
        },
        highlight: [hand("thinkers-nook"), chip("herbalist"), chip("copy-house"), chip("scroll-hall")],
        expect: build("thinkers-nook"),
        others: [sell("judges-guild"), sell("masons-guild")],
      },
      {
        text: "The last turn of the game. Rose Gardens is free through your Bronze Figure: build it. Then comes the last war, and the score sheet adds up every city.",
        highlight: [hand("rose-gardens"), chip("bronze-figure")],
        expect: build("rose-gardens"),
        others: [sell("clockworks"), sell("lyceum")],
      },
    ],
  },
];
