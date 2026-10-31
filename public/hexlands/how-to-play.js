// Hexlands' "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Settle the island. Collect resources from the land around your settlements, spend them on roads, settlements, cities and development cards, and be the first to 10 points.",
  players: [
    "Three or four, on the same island.",
    "To play friends, create a room, send the invite link to two or three of them, then press **Start game**. Seats nobody takes can go to robots (**Add robot**), at the host's robot level. If a friend leaves mid-game, the game stops, since every card needs their key, and a robot takes their seat from the next game.",
    "Against robots, pick how many play (**Players**, 3 or 4, above **Play vs robot**) and the robots' level in the settings: Easy, Medium or Hard.",
  ],
  setup: [
    "The island has 19 hexes, laid out at random every game: 4 **forest** (wood), 3 **hills** (brick), 4 **pasture** (wool), 4 **fields** (grain), 3 **mountains** (ore) and a **desert**, where the robber starts. Every hex but the desert has a number from 2 to 12. The red 6s and 8s come up most often, and never sit side by side.",
    "Nine **harbours** dot the coast: four trade any resource 3:1, and one for each resource trades it 2:1.",
    "Each player places a settlement on a corner and a road on an edge touching it, in turn, then again in reverse order, so the last to place gets two in a row. Your second settlement collects one card from each hex it touches.",
    "A settlement can't go on a corner next to another building (the **distance rule**). You have 15 roads, 5 settlements and 4 cities to build.",
  ],
  turn: [
    "**Roll the dice.** Every hex showing that number pays the buildings on its corners: 1 card for a settlement, 2 for a city, to whoever owns them. If the bank runs short of a resource for more than one player, nobody gets it.",
    "**A 7** pays nobody. Anyone holding more than 7 cards discards half, rounded down. Then you move the **robber** to another hex and steal a random card from a player with a building there. The hex under the robber pays nothing until it moves on.",
    "**Trade and build**, in any order, as often as your cards allow. A **road** costs wood and brick; a **settlement** wood, brick, wool and grain; a **city**, which replaces one of your settlements, 2 grain and 3 ore; a **development card** wool, grain and ore.",
    "Roads join your own roads and buildings. A new settlement needs one of your roads to reach it, and keeps the distance rule.",
    "**The bank** trades 4 cards of one resource for 1 of any other. A settlement or city on a harbour gets its better rate.",
    "**Other players**: offer some of your cards and say what you want. Everyone else answers at once, each with the cards or a no, and you pick who to trade with, or call it off. Players only trade with whoever's turn it is.",
    "**Development cards** stay hidden until played. Play one a turn, though not one bought this turn; a knight may come before you roll. **Knight**: move the robber and steal. **Road building**: two free roads. **Year of plenty**: take any two cards from the bank. **Monopoly**: name a resource, and every other player hands you all of theirs. **Victory point**: a hidden point.",
    "Tap a spot that lights up on the board to build there, and the cards in your hand to spend or trade them. End your turn when you're done.",
    "Cards you owe to someone's Monopoly are given for you.",
  ],
  winning: [
    "Points: 1 a settlement, 2 a city, 1 a victory point card.",
    "**Longest road**: 2 points for the first to build an unbroken road of 5 or more. Anyone who builds a longer one takes it. A rival's settlement on a corner cuts a road in two.",
    "**Largest army**: 2 points for the first to play 3 knights. Anyone who plays more takes it.",
    "The first to 10 points on their own turn wins (8 in a shorter game). Hidden victory point cards are shown for you the moment they'd win.",
  ],
  settings: [
    "Game: to 10 points, or to 8 for a shorter one.",
    "Time per move: when it runs out, a sensible move is made for you.",
    "Robot level: Easy, Medium or Hard.",
    "With friends, the settings of whoever creates the room apply to everyone.",
    "Against robots there are no clocks unless you pick one.",
  ],
  fairPlay: "There's no dealer: every browser shuffles the deck in turn and proves it did so honestly, and a card can only be read with every player's key, so nobody can peek at another hand or stack the development cards. Cards you collect come face up from the bank, as at a real table, and every card you spend is shown, so every cost is checked as it happens. When the robber steals, your hand is shuffled and the thief takes one card: nobody picks it, only the thief sees it, and you can tell what's gone. Every roll is drawn by all the browsers together, each adding its part only once the move has been sent, so nobody can choose or foresee the dice. Trade answers, like discards, are sealed until everyone has chosen, so nobody sees another's before giving their own. (The one gap: with three or more players, a room creator running a tampered browser could read a hand.) When the game ends, everyone reveals their keys and each browser replays the whole game with every card known, so anyone who held cards back from a Monopoly is caught: you see \"Fair play verified\" or what didn't add up.",
  keyboard: "Tab moves between the board, your hand and the buttons. On the board, the arrow keys move between the spots you can choose and Enter or Space picks one. In your hand, the arrow keys move between cards and Enter picks one. Esc cancels.",
};
