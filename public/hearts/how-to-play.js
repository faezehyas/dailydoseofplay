// Hearts' "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Take as few points as you can. Every heart you win in a trick is 1 point and the queen of spades is 13. When someone reaches 100, the lowest score wins.",
  players: [
    "Four, or three: with three, the 2 of diamonds is left out and everyone gets 17 cards.",
    "To play friends, create a room, send the invite link to two or three of them, then press **Start game**.",
    "Against robots, pick how many play (**Players**, 3 or 4, by **Play vs robot**) and the robots' level in the settings: Easy, Medium or Hard.",
  ],
  setup: "A standard 52-card deck, 13 cards each. Before each hand you pass three cards: to the left, then the right, then across, then a hand with no pass, and round again (with three players, left then right). Everyone picks before anyone receives.",
  turn: [
    "Whoever holds the 2 of clubs leads it to the first trick. Then the winner of each trick leads the next.",
    "Follow the suit led if you can; if you can't, play anything. The highest card of the suit led takes the trick (aces are high).",
    "On the first trick you can't play a heart or the queen of spades unless you have nothing else.",
    "Hearts can't be led until a heart or the queen of spades has been played (**hearts are broken**), unless your hand is all hearts.",
    "Tap a card to play it; only the cards you may play light up. To pass, tap three cards and press **Pass left** (right, across). You may pick and press it before your turn: the cards go when it comes. The cards passed to you are marked with a dot.",
    "The 2 of clubs, a card you have to play and the next hand are played for you after a short beat.",
  ],
  winning: [
    "At the end of each hand your hearts and the queen are added to your score.",
    "**Shooting the moon**: take all 13 hearts and the queen, and everyone else gets 26 instead of you.",
    "The game ends when someone reaches 100 and the lowest score wins. If two or more are level at the bottom, another hand is played until one is lowest alone. The score sheet shows every hand.",
  ],
  settings: [
    "Game: to 100, to 50, or one hand a game (the scores add up across rematches, and players level at the bottom share the win).",
    "Passing: on, or off.",
    "Shooting the moon: everyone else gets 26, or the shooter loses 26.",
    "Jack of diamonds: off, or −10 to whoever takes it.",
    "Time per move: when it runs out, a sensible card (or three to pass) is played for you.",
    "Robot level: Easy, Medium or Hard.",
    "**Four colours** shows diamonds blue and clubs green, on this device only.",
    "With friends, the settings of whoever creates the room apply to everyone, except card colours.",
    "Against robots there are no clocks unless you pick one.",
  ],
  fairPlay: "There's no dealer: every browser shuffles the deck in turn, before every hand, and proves it did so honestly, and a card can only be read with every player's key, so nobody can peek at another hand or stack the deck. A passed card is sealed to its new holder, so even the room creator's browser, which relays every message, can't read it. (The one gap: with three or more players, a room creator running a tampered browser could read a hand.) A played card is shown, so tricks and points are checked as they happen. When the game ends, everyone reveals their keys and each browser replays the whole game with every card known, so anyone who didn't follow suit, led hearts too soon, broke the first-trick rule or hid the 2 of clubs is caught: you see \"Fair play verified\" or what didn't add up.",
  keyboard: "In your hand, the arrow keys move between cards and Enter plays or picks one. P passes the three you picked; Esc clears them.",
};
