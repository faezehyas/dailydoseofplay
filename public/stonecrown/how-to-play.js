// Stonecrown's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Raise the greatest city of the ancient world. Over three ages, take one card at a time from hands that go round the table, and use it to build, to raise your wonder or to fill your purse. The most points after the third age wins.",
  players: [
    "Three or four. Your **neighbours** are the players either side of you (with three, that's both the others): you trade with them and fight them, and nobody else.",
    "To play friends, create a room, send the invite link to two or three of them, then press **Start game**. Seats nobody takes can go to robots (**Add robot**), at the host's robot level. If a friend leaves mid-game, the game stops, since every card needs their key, and a robot takes their seat from the next game.",
    "Against robots, pick how many play (**Players**, 3 or 4, above **Play vs robot**) and the robots' level in the settings: Easy, Medium or Hard.",
  ],
  setup: [
    "Everyone is dealt a **wonder** at random, and 3 coins. A wonder makes one resource from the start, and has two to four **stages** to build, shown on its board.",
    "The game has three **ages**. Each starts with a hand of 7 cards for everyone, from that age's deck. Age III mixes in the **guilds**: two more than there are players, drawn at random from ten and kept secret.",
    "Cards come in seven colours: **brown** raw materials (wood, stone, clay, ore), **grey** goods (glass, cloth, papyrus), **blue** for points, **yellow** for trade and coins, **red** for shields, **green** for science and **purple** for guilds.",
  ],
  turn: [
    "**Everyone picks at once.** Choose a card from your hand and what to do with it. Nobody sees a pick until all are in, then they all happen together.",
    "**Build it** into your city by paying its cost, in coins (to the bank), resources or both; many cards are free. Your brown and grey cards, your wonder and a few yellow cards make resources every turn, and using them doesn't use them up. You can't build two cards of the same name.",
    "**Buy** what you're missing from a neighbour: anything their brown or grey cards make, or their wonder's own resource, 2 coins a unit (1 with the right yellow card or wonder stage). It costs them nothing, and they get your coins once the turn is over, like every coin that comes in this turn.",
    "**Chains**: many cards from age II on are free if your city already holds an earlier card they name. Each card shows what it chains to and from.",
    "**Raise a wonder stage**: pay the next stage's cost and tuck the card face down under your wonder. Any card will do, and nobody sees which. Stages go in order.",
    "**Sell** the card face down for 3 coins. You can always do this.",
    "Then everyone hands the rest of their cards on: to the **left** in ages I and III, to the **right** in age II. After six turns, the **seventh card** of each hand is discarded face down.",
    "**Military**: at the end of each age, compare your shields with each neighbour's. More wins a token worth 1, 3 or 5 points (in ages I, II and III), fewer takes a −1 token, and a tie takes nothing.",
    "Some wonder stages bend the rules: build a card free once an age, look through the discards and build one of them free, play your seventh card instead of losing it, or copy a neighbour's guild at the end.",
    "Tap a card in your hand to see what you can do with it. When you have to buy, the cheapest way is picked, and you can choose another.",
  ],
  winning: [
    "After age III, the score sheet adds up each city: **military** (your tokens), **coins** (1 point for every 3), **wonder** (its stages' points), **civic** (blue cards), **commerce** (yellow cards that score), **guilds** and **science**.",
    "**Science**: count each symbol, star, cog and quill, and score its count squared, plus 7 for every full set of all three. Three stars, two cogs and a quill score 9 + 4 + 1 + 7 = 21.",
    "**Guilds** mostly score from your neighbours' cities: a point for each of their cards of a colour, for instance. A wild science symbol, or a copied guild, counts as whatever scores best.",
    "The highest total wins. A tie goes to whoever has more coins; players level on both share the win.",
  ],
  settings: [
    "Wonder sides: everyone on side **A** (simpler), everyone on side **B** (trickier), or **Mixed**, each player's side drawn at random. The wonders themselves are always dealt at random.",
    "Time per move: when it runs out, a card is picked for you.",
    "Robot level: Easy, Medium or Hard.",
    "With friends, the settings of whoever creates the room apply to everyone.",
    "Against robots there are no clocks unless you pick one.",
  ],
  fairPlay: "There's no dealer: every browser shuffles each age's cards in turn and proves it did so honestly, and a card can only be read with every player's key, so nobody can peek at another hand or stack the deck. Picks are sealed until everyone has chosen, so nobody sees another's first. A card you build is shown, so every cost is checked as it happens; a card tucked under a wonder or sold stays face down, so nobody learns what you gave up. Passed hands are sealed to the neighbour who receives them, so even the room creator's browser, which relays every message, can't read them, and the discard pile is only ever seen by a player whose wonder lets them dig through it. The guilds left out of age III stay hidden too. (The one gap: with three or more players, a room creator running a tampered browser could read a hand.) When the game ends, everyone reveals their keys and each browser replays the whole game with every card known: you see \"Fair play verified\" or what didn't add up.",
  keyboard: "Tab moves between your hand, the table and the buttons. In your hand, the arrow keys move between cards and Enter picks one; then B builds it, W raises a wonder stage with it and S sells it. Esc lets go of the card or closes a city.",
};
