// Crazy Eights' tutorial lessons (see engine/tutorial.js). You play coral
// against teal, with fixed hands from a deck whose every card is known
// (engine/cards/lesson-deck.js), so no shuffle runs. A position is both
// hands (yours first), the discard pile (its top card last) and the stock's
// top cards (the rest of the deck follows them), as names like "10H". Moves
// are the game's own: { play, suit } (suit only for an 8, 0–3 for spades,
// hearts, diamonds, clubs) and { draw: true }. Cells are a card, "pile" and
// "stock".
import { card } from "../engine/cards/lesson-deck.js";

const HEARTS = 1;
const play = (name, suit) => (suit === undefined ? { play: card(name) } : { play: card(name), suit });

export const lessons = [
  {
    title: "Matching suit or rank",
    steps: [
      {
        text: "Take turns playing a card on the discard pile that matches the top card's suit or its rank. The 9♥ is on top, so any heart or any 9 goes. Play your 4♥.",
        position: { hands: [["4H", "KS", "2D", "JC"], ["KH", "5C", "9S", "3D", "QD"]], pile: ["9H"] },
        highlight: [card("4H"), "pile"],
        arrows: [[card("4H"), "pile"]],
        expect: play("4H"),
        reply: play("KH"),
      },
      {
        text: "Teal followed the hearts with the K♥. You have no hearts left, but a card of the same rank goes on any suit: play your K♠.",
        highlight: [card("KS")],
        expect: play("KS"),
      },
    ],
  },
  {
    title: "Eights are wild",
    steps: [
      {
        text: "Nothing of yours matches the 6♣, but an 8 goes on any card, and you name the suit the next player must follow. Play the 8♦ and name hearts, the suit you hold most of.",
        position: { hands: [["8D", "QH", "2H", "10S"], ["7H", "4S", "KC", "9D"]], pile: ["6C"] },
        highlight: [card("8D")],
        expect: play("8D", HEARTS),
        reply: play("7H"),
      },
      {
        text: "Teal had to follow your hearts. Play a heart of your own.",
        highlight: [card("QH"), card("2H")],
        expect: [play("QH"), play("2H")],
      },
    ],
  },
  {
    title: "Drawing when you can't play",
    steps: [
      {
        text: "Nothing here goes on the J♠: no spade, no jack and no 8. When you can't play, you draw from the stock (in a game that's done for you). Tap the stock to draw a card.",
        position: { hands: [["3D", "6H", "10C"], ["4S", "9S", "AH", "5D"]], pile: ["JS"], stock: ["2C", "5S"] },
        highlight: ["stock"],
        expect: { draw: true },
      },
      {
        text: "The 2♣ doesn't play either. Keep drawing until you get a card that does.",
        highlight: ["stock"],
        expect: { draw: true },
      },
      {
        text: "A spade at last: play the 5♠.",
        highlight: [card("5S")],
        expect: play("5S"),
      },
    ],
  },
  {
    title: "Going out",
    steps: [
      {
        text: "The first player to empty their hand wins. Play your 6♦ on the 10♦, and the table hears you have one card left.",
        position: { hands: [["6D", "6S"], ["6C", "KD", "3H", "9C"]], pile: ["10D"] },
        highlight: [card("6D")],
        expect: play("6D"),
        reply: play("6C"),
      },
      {
        text: "Teal switched to clubs with the 6♣, but your 6♠ matches its rank. Play your last card to win!",
        highlight: [card("6S")],
        expect: play("6S"),
      },
    ],
  },
];
