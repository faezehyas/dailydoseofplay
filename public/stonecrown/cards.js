// Stonecrown's cards and wonders: every card design with its age, colour,
// cost, effect and the copies each player count adds, and the seven wonders
// with both sides. A deck face is an index into deckFor(players). Pure data
// and lookups: no DOM, timers or Math.random.

export const WOOD = 0;
export const STONE = 1;
export const CLAY = 2;
export const ORE = 3;
export const GLASS = 4;
export const CLOTH = 5;
export const PAPYRUS = 6;
export const RESOURCES = [WOOD, STONE, CLAY, ORE, GLASS, CLOTH, PAPYRUS];
export const RESOURCE_NAMES = ["wood", "stone", "clay", "ore", "glass", "cloth", "papyrus"];
export const RAW = [WOOD, STONE, CLAY, ORE];
export const GOODS = [GLASS, CLOTH, PAPYRUS];

export const COLORS = ["brown", "grey", "blue", "yellow", "red", "green", "purple"];
export const SYMBOLS = ["star", "cog", "quill"];
export const [STAR, COG, QUILL] = [0, 1, 2];

export const AGES = 3;
export const HAND = 7;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;

// "WWS2": two wood, a stone and 2 coins. Letters: W wood, S stone, C clay,
// O ore, G glass, L cloth, P papyrus; a number is coins.
const LETTERS = "WSCOGLP";
export function parseCost(text) {
  const res = [0, 0, 0, 0, 0, 0, 0];
  let coins = 0;
  for (const ch of text) {
    if (/\d/.test(ch)) coins = coins * 10 + Number(ch);
    else res[LETTERS.indexOf(ch)]++;
  }
  return { res, coins };
}
// "W/C": one unit of wood or clay; "WW": two wood.
const produce = (text) => (text.includes("/") ? [text.split("/").map((ch) => LETTERS.indexOf(ch))] : [...text].map((ch) => [LETTERS.indexOf(ch)]));

// Effects, at most one kind a card:
//   produce: [[r, ...]]      units, each one of the listed resources; only brown and grey can be bought by neighbours
//   points: n                points at the end (blue)
//   shields: n               military strength (red)
//   science: s | "any"       a symbol; "any" picks the best one at the end
//   gold: n                  coins once, when built
//   trade: { kinds, sides }  buy those resources from those neighbours at 1 coin instead of 2
//   income: { per, from, coins }   coins once, when built, per matching card (or "stage") in those cities
//   score: { per, from, points }   points at the end, per matching card, "stage" or "defeat" in those cities
// per: a colour, a list of colours, "stage" (wonder stages built) or "defeat" (defeat tokens).
// from: any of "left", "self", "right". Neighbours: left is seat p + 1, right is seat p − 1.
// from (the card's field): the keys of earlier cards, any of which builds this one for free.
const NEIGHBOURS = ["left", "right"];
const ALL = ["left", "self", "right"];
const SELF = ["self"];

const DESIGNS = [
  // Age I
  [1, "brown", "woodcutters-camp", "Woodcutter's Camp", [3, 4], "", { produce: produce("W") }],
  [1, "brown", "stone-cut", "Stone Cut", [3, 5], "", { produce: produce("S") }],
  [1, "brown", "clay-bank", "Clay Bank", [3, 5], "", { produce: produce("C") }],
  [1, "brown", "ore-seam", "Ore Seam", [3, 4], "", { produce: produce("O") }],
  [1, "brown", "riverside-grove", "Riverside Grove", [6], "1", { produce: produce("W/C") }],
  [1, "brown", "dig-site", "Dig Site", [4], "1", { produce: produce("S/C") }],
  [1, "brown", "red-hollow", "Red Hollow", [3], "1", { produce: produce("C/O") }],
  [1, "brown", "hillside-clearing", "Hillside Clearing", [3], "1", { produce: produce("S/W") }],
  [1, "brown", "forest-mine", "Forest Mine", [5], "1", { produce: produce("W/O") }],
  [1, "brown", "rock-shaft", "Rock Shaft", [6], "1", { produce: produce("O/S") }],
  [1, "grey", "weavers-hall", "Weavers' Hall", [3, 6], "", { produce: produce("L") }],
  [1, "grey", "glass-kiln", "Glass Kiln", [3, 6], "", { produce: produce("G") }],
  [1, "grey", "reed-press", "Reed Press", [3, 6], "", { produce: produce("P") }],
  [1, "blue", "town-well", "Town Well", [4, 7], "", { points: 3 }],
  [1, "blue", "hot-springs", "Hot Springs", [3, 7], "S", { points: 3 }],
  [1, "blue", "shrine", "Shrine", [3, 5], "", { points: 2 }],
  [1, "blue", "amphitheatre", "Amphitheatre", [3, 6], "", { points: 2 }],
  [1, "yellow", "wayside-inn", "Wayside Inn", [4, 5, 7], "", { gold: 5 }],
  [1, "yellow", "east-road", "East Road", [3, 7], "", { trade: { kinds: RAW, sides: ["right"] } }],
  [1, "yellow", "west-road", "West Road", [3, 7], "", { trade: { kinds: RAW, sides: ["left"] } }],
  [1, "yellow", "artisans-row", "Artisans' Row", [3, 6], "", { trade: { kinds: GOODS, sides: NEIGHBOURS } }],
  [1, "red", "palisade", "Palisade", [3, 7], "W", { shields: 1 }],
  [1, "red", "guard-post", "Guard Post", [3, 5], "O", { shields: 1 }],
  [1, "red", "watchtower", "Watchtower", [3, 4], "C", { shields: 1 }],
  [1, "green", "herbalist", "Herbalist", [3, 5], "L", { science: STAR }],
  [1, "green", "tinkers-shed", "Tinker's Shed", [3, 7], "G", { science: COG }],
  [1, "green", "copy-house", "Copy House", [3, 4], "P", { science: QUILL }],
  // Age II
  [2, "brown", "timber-mill", "Timber Mill", [3, 4], "1", { produce: produce("WW") }],
  [2, "brown", "great-quarry", "Great Quarry", [3, 4], "1", { produce: produce("SS") }],
  [2, "brown", "brickworks", "Brickworks", [3, 4], "1", { produce: produce("CC") }],
  [2, "brown", "smeltery", "Smeltery", [3, 4], "1", { produce: produce("OO") }],
  [2, "grey", "weavers-hall", "Weavers' Hall", [3, 5], "", { produce: produce("L") }],
  [2, "grey", "glass-kiln", "Glass Kiln", [3, 5], "", { produce: produce("G") }],
  [2, "grey", "reed-press", "Reed Press", [3, 5], "", { produce: produce("P") }],
  [2, "blue", "water-channel", "Water Channel", [3, 7], "SSS", { points: 5 }, "hot-springs"],
  [2, "blue", "sanctuary", "Sanctuary", [3, 6], "WCG", { points: 3 }, "shrine"],
  [2, "blue", "bronze-figure", "Bronze Figure", [3, 7], "OOW", { points: 4 }, "amphitheatre"],
  [2, "blue", "hall-of-laws", "Hall of Laws", [3, 5], "CCL", { points: 4 }, "copy-house"],
  [2, "yellow", "agora", "Agora", [3, 6, 7], "CC", { produce: produce("G/L/P") }, "east-road", "west-road"],
  [2, "yellow", "caravan-yard", "Caravan Yard", [3, 5, 6], "WW", { produce: produce("W/S/C/O") }, "artisans-row"],
  [2, "yellow", "olive-press", "Olive Press", [3, 6], "", { income: { per: "brown", from: ALL, coins: 1 } }],
  [2, "yellow", "craft-fair", "Craft Fair", [4, 7], "", { income: { per: "grey", from: ALL, coins: 2 } }],
  [2, "red", "ramparts", "Ramparts", [3, 7], "SSS", { shields: 2 }],
  [2, "red", "drill-field", "Drill Field", [4, 6, 7], "OOW", { shields: 2 }],
  [2, "red", "horse-paddock", "Horse Paddock", [3, 5], "OCW", { shields: 2 }, "herbalist"],
  [2, "red", "bow-yard", "Bow Yard", [3, 6], "WWO", { shields: 2 }, "tinkers-shed"],
  [2, "green", "infirmary", "Infirmary", [3, 4], "OOG", { science: STAR }, "herbalist"],
  [2, "green", "inventors-hall", "Inventors' Hall", [3, 5], "CCP", { science: COG }, "tinkers-shed"],
  [2, "green", "scroll-hall", "Scroll Hall", [3, 6], "SSL", { science: QUILL }, "copy-house"],
  [2, "green", "tutors-court", "Tutors' Court", [3, 7], "WP", { science: QUILL }],
  // Age III
  [3, "blue", "temple-of-all", "Temple of All", [3, 6], "CCOGLP", { points: 7 }, "sanctuary"],
  [3, "blue", "rose-gardens", "Rose Gardens", [3, 4], "CCW", { points: 5 }, "bronze-figure"],
  [3, "blue", "council-house", "Council House", [3, 5, 6], "SSOG", { points: 6 }],
  [3, "blue", "crown-hall", "Crown Hall", [3, 7], "WSCOGLP", { points: 8 }],
  [3, "blue", "elders-chamber", "Elders' Chamber", [3, 5], "WWSO", { points: 6 }, "scroll-hall"],
  [3, "yellow", "harbour", "Harbour", [3, 4], "WOL", { income: { per: "brown", from: SELF, coins: 1 }, score: { per: "brown", from: SELF, points: 1 } }, "agora"],
  [3, "yellow", "counting-house", "Counting House", [3, 6], "SG", { income: { per: "yellow", from: SELF, coins: 1 }, score: { per: "yellow", from: SELF, points: 1 } }, "caravan-yard"],
  [3, "yellow", "exchange", "Exchange", [4, 6], "CCP", { income: { per: "grey", from: SELF, coins: 2 }, score: { per: "grey", from: SELF, points: 2 } }],
  [3, "yellow", "hippodrome", "Hippodrome", [3, 5, 7], "SSO", { income: { per: "stage", from: SELF, coins: 3 }, score: { per: "stage", from: SELF, points: 1 } }, "infirmary"],
  [3, "red", "bastions", "Bastions", [3, 7], "OOOS", { shields: 3 }, "ramparts"],
  [3, "red", "legion-camp", "Legion Camp", [4, 5, 6], "SSSO", { shields: 3 }, "drill-field"],
  [3, "red", "armoury", "Armoury", [3, 4, 7], "WWOL", { shields: 3 }],
  [3, "red", "siege-yard", "Siege Yard", [3, 5], "CCCW", { shields: 3 }, "inventors-hall"],
  [3, "green", "healers-retreat", "Healers' Retreat", [3, 6], "CCLP", { science: STAR }, "infirmary"],
  [3, "green", "clockworks", "Clockworks", [3, 7], "OOGL", { science: COG }, "inventors-hall"],
  [3, "green", "lyceum", "Lyceum", [3, 4], "WWPG", { science: QUILL }, "scroll-hall"],
  [3, "green", "stargazers-school", "Stargazers' School", [3, 7], "SSSG", { science: STAR }, "tutors-court"],
  [3, "green", "thinkers-nook", "Thinkers' Nook", [3, 5], "WPL", { science: COG }, "tutors-court"],
  // Guilds: age III, players + 2 of them at random
  [3, "purple", "delvers-guild", "Delvers' Guild", [0], "OOCSW", { score: { per: "brown", from: NEIGHBOURS, points: 1 } }],
  [3, "purple", "makers-guild", "Makers' Guild", [0], "OOSS", { score: { per: "grey", from: NEIGHBOURS, points: 2 } }],
  [3, "purple", "hawkers-guild", "Hawkers' Guild", [0], "GLP", { score: { per: "yellow", from: NEIGHBOURS, points: 1 } }],
  [3, "purple", "sages-guild", "Sages' Guild", [0], "CCCLP", { score: { per: "green", from: NEIGHBOURS, points: 1 } }],
  [3, "purple", "whisperers-guild", "Whisperers' Guild", [0], "CCCG", { score: { per: "red", from: NEIGHBOURS, points: 1 } }],
  [3, "purple", "tacticians-guild", "Tacticians' Guild", [0], "OOSL", { score: { per: "defeat", from: NEIGHBOURS, points: 1 } }],
  [3, "purple", "sailors-guild", "Sailors' Guild", [0], "WWWGP", { score: { per: ["brown", "grey", "purple"], from: SELF, points: 1 } }],
  [3, "purple", "scholars-guild", "Scholars' Guild", [0], "WWOOP", { science: "any" }],
  [3, "purple", "judges-guild", "Judges' Guild", [0], "WWWSL", { score: { per: "blue", from: NEIGHBOURS, points: 1 } }],
  [3, "purple", "masons-guild", "Masons' Guild", [0], "SSCCG", { score: { per: "stage", from: ALL, points: 1 } }],
];

// Two designs share a key when they are the same building in two ages (the
// grey cards): a city may hold only one card of a key.
export const CARDS = DESIGNS.map(([age, color, key, name, players, cost, effect, ...from], id) => ({
  id,
  age,
  color,
  key,
  name,
  players,
  cost: parseCost(cost),
  from,
  ...effect,
}));

export const isGuild = (card) => card.color === "purple";
export const GUILDS = CARDS.filter(isGuild).map((c) => c.id);

// The cards of each age for a player count, one entry a copy, by design id.
export function ageCards(age, players) {
  return CARDS.filter((c) => c.age === age && !isGuild(c)).flatMap((c) => c.players.filter((n) => n <= players).map(() => c.id));
}

// Face → design id, for a player count: the cards of age I, age II, age III
// without guilds, then every guild (players + 2 of them are dealt).
export function deckFor(players) {
  return [...ageCards(1, players), ...ageCards(2, players), ...ageCards(3, players), ...GUILDS];
}

// The faces of each age in deckFor(players), as [first, end) and the guilds' range.
export function deckRanges(players) {
  const sizes = [1, 2, 3].map((a) => ageCards(a, players).length);
  const ages = [];
  let at = 0;
  for (const n of sizes) ages.push([at, (at += n)]);
  return { ages, guilds: [at, at + GUILDS.length] };
}

export const guildCount = (players) => players + 2;

// Wonder stage effects: points, shields, gold, produce (not for sale to
// neighbours), science "any", dig (build one discarded card free at the end
// of the turn), free (once an age, build a card free), trade (as the card
// effect), copyGuild (score one guild of a neighbour as your own at the end),
// playLast (play the seventh card of each age instead of discarding it).
const stage = (cost, effect) => ({ cost: parseCost(cost), ...effect });

export const WONDERS = [
  {
    key: "rhodes",
    name: "Colossus of Rhodes",
    city: "Rhodes",
    produce: ORE,
    sides: {
      A: [stage("WW", { points: 3 }), stage("CCC", { shields: 2 }), stage("OOOO", { points: 7 })],
      B: [stage("SSS", { shields: 1, points: 3, gold: 3 }), stage("OOOO", { shields: 1, points: 4, gold: 4 })],
    },
  },
  {
    key: "alexandria",
    name: "Lighthouse of Alexandria",
    city: "Alexandria",
    produce: GLASS,
    sides: {
      A: [stage("SS", { points: 3 }), stage("OO", { produce: [RAW] }), stage("GG", { points: 7 })],
      B: [stage("CC", { produce: [RAW] }), stage("WW", { produce: [GOODS] }), stage("SSS", { points: 7 })],
    },
  },
  {
    key: "ephesus",
    name: "Temple of Artemis",
    city: "Ephesus",
    produce: PAPYRUS,
    sides: {
      A: [stage("SS", { points: 3 }), stage("WW", { gold: 9 }), stage("PP", { points: 7 })],
      B: [stage("SS", { points: 2, gold: 4 }), stage("WW", { points: 3, gold: 4 }), stage("PLG", { points: 5, gold: 4 })],
    },
  },
  {
    key: "babylon",
    name: "Hanging Gardens of Babylon",
    city: "Babylon",
    produce: CLAY,
    sides: {
      A: [stage("CC", { points: 3 }), stage("WWW", { science: "any" }), stage("CCCC", { points: 7 })],
      B: [stage("CL", { points: 3 }), stage("GWW", { playLast: true }), stage("CCCP", { science: "any" })],
    },
  },
  {
    key: "olympia",
    name: "Statue of Zeus",
    city: "Olympia",
    produce: WOOD,
    sides: {
      A: [stage("WW", { points: 3 }), stage("SS", { free: true }), stage("OO", { points: 7 })],
      B: [stage("WW", { trade: { kinds: RAW, sides: NEIGHBOURS } }), stage("SS", { points: 5 }), stage("OOL", { copyGuild: true })],
    },
  },
  {
    key: "halicarnassus",
    name: "Mausoleum at Halicarnassus",
    city: "Halicarnassus",
    produce: CLOTH,
    sides: {
      A: [stage("CC", { points: 3 }), stage("OOO", { dig: true }), stage("LL", { points: 7 })],
      B: [stage("OO", { points: 2, dig: true }), stage("CCC", { points: 1, dig: true }), stage("GPL", { dig: true })],
    },
  },
  {
    key: "giza",
    name: "Great Pyramid of Giza",
    city: "Giza",
    produce: STONE,
    sides: {
      A: [stage("SS", { points: 3 }), stage("WWW", { points: 5 }), stage("SSSS", { points: 7 })],
      B: [stage("WW", { points: 3 }), stage("SSS", { points: 5 }), stage("CCC", { points: 5 }), stage("SSSSP", { points: 7 })],
    },
  },
];

export const SIDES = ["A", "B"];
export const START_COINS = 3;
export const DISCARD_COINS = 3;
export const TRADE_COST = 2;
export const TRADE_DISCOUNT = 1;
// Military tokens for a win in each age; a loss is −1.
export const VICTORY = [1, 3, 5];
export const DEFEAT = -1;
