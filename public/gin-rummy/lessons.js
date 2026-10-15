// Gin Rummy's tutorial lessons (see engine/tutorial.js). You play coral
// against teal, who dealt, with fixed hands from a deck whose every card is
// known (engine/cards/lesson-deck.js), so no shuffle runs. A position is
// both hands (yours first, ten cards each), the discard pile (its top card
// last) and the stock's top cards (the rest of the deck follows them), as
// names like "10H"; it starts on your draw, with the knock limit at 10.
// Moves are the game's own: { draw: "stock" | "pile" }, { discard },
// { discard, knock: true }, and teal's { melds, layoffs } after a knock;
// laying down your own hand is made for you, as in the game. Cells are a
// card in your hand, "stock", "pile", "knock" (the Knock button),
// "deadwood" (its count) and a card you laid down ("spread:<slot>").
import { card, cards } from "../engine/cards/lesson-deck.js";

const discard = (name) => ({ discard: card(name) });
const knock = (name) => ({ discard: card(name), knock: true });

export const lessons = [
  {
    title: "Sets and runs",
    steps: [
      {
        text: "Melds are sets (three or four of a rank) and runs (three or more in a row in one suit). Your 4♥ 5♥ 6♥ is a run: take the 7♦ from the pile to make a set of sevens.",
        position: { hands: [["4H", "5H", "6H", "7S", "7C", "2D", "9S", "JC", "KD", "3C"], ["AS", "2S", "8D", "10D", "QH", "KC", "5C", "6S", "9H", "JD"]], pile: ["3S", "7D"] },
        highlight: [card("7S"), card("7C"), "pile"],
        arrows: [["pile", card("7S")]],
        expect: { draw: "pile" },
      },
      {
        text: "Your hand groups itself into melds, a brass mark under each. End your turn with a discard, but not the card you just took: tap the K♦, then tap it again.",
        highlight: [card("KD")],
        arrows: [[card("KD"), "pile"]],
        expect: discard("KD"),
      },
    ],
  },
  {
    title: "Drawing and discarding",
    steps: [
      {
        text: "Each turn starts with a draw: the top card of the stock or of the pile. The J♥ doesn't help you, so tap the stock.",
        position: { hands: [["9D", "9C", "3H", "4H", "5H", "KS", "QC", "8S", "2C", "AD"], ["QD", "2H", "7D", "7C", "10S", "JS", "4C", "5D", "6H", "AC"]], pile: ["JH"], stock: ["9S"] },
        highlight: ["stock"],
        expect: { draw: "stock" },
      },
      {
        text: "The 9♠ makes a set with your nines. Then throw a card, and it's Teal's turn: tap the K♠, then tap it again.",
        highlight: [card("KS")],
        arrows: [[card("KS"), "pile"]],
        expect: discard("KS"),
      },
    ],
  },
  {
    title: "Deadwood",
    steps: [
      {
        text: "Cards in no meld are deadwood: court cards count 10, aces 1, the rest their number. Yours adds up to 26 (beside your hand); draw from the stock.",
        position: { hands: [["6C", "7C", "8C", "10S", "10H", "10D", "KH", "QS", "4D", "2S"], ["AH", "3H", "5H", "7H", "9H", "JH", "2D", "3D", "8D", "AC"]], pile: ["5S", "JD"], stock: ["9C"] },
        highlight: [card("KH"), card("QS"), card("4D"), card("2S"), "deadwood", "stock"],
        expect: { draw: "stock" },
      },
      {
        text: "The 9♣ joined your run. With eleven cards, the count also shows what your best throw leaves: throw a court card, the K♥ or the Q♠.",
        highlight: [card("KH"), card("QS"), "deadwood"],
        expect: [discard("KH"), discard("QS")],
      },
    ],
  },
  {
    title: "Knocking",
    steps: [
      {
        text: "With 10 points of deadwood or less after drawing, you may knock. Take the K♦ from the pile: it makes a run with your J♦ Q♦.",
        position: { hands: [["3S", "4S", "5S", "8H", "8D", "8C", "JD", "QD", "2H", "6C"], ["6S", "9C", "9H", "9S", "AC", "2C", "3C", "7H", "10C", "QH"]], pile: ["4C", "KD"] },
        highlight: [card("JD"), card("QD"), "pile"],
        arrows: [["pile", card("QD")]],
        expect: { draw: "pile" },
      },
      {
        text: "Throwing the 6♣ leaves just 2 deadwood, so Knock shows. Press it: Teal lays down and lays off what fits your melds, and you score the difference.",
        highlight: ["knock", "deadwood"],
        expect: knock("6C"),
        reply: { melds: [cards(["AC", "2C", "3C"]), cards(["9S", "9H", "9C"])], layoffs: [[card("6S"), 0]] },
      },
    ],
  },
  {
    title: "Gin",
    steps: [
      {
        text: "With no deadwood at all, it's gin. Take the Q♣ from the pile: it makes a run with your 10♣ J♣.",
        position: { hands: [["AH", "2H", "3H", "4H", "7S", "7D", "7C", "10C", "JC", "KS"], ["QS", "QH", "QD", "9D", "10D", "JD", "5C", "8H", "2S", "6D"]], pile: ["5D", "QC"] },
        highlight: [card("10C"), card("JC"), "pile"],
        arrows: [["pile", card("JC")]],
        expect: { draw: "pile" },
      },
      {
        text: "Only the K♠ is left out, so the button says Gin. Press it: gin scores 25 plus Teal's deadwood, and nothing can be laid off on it.",
        highlight: ["knock"],
        expect: knock("KS"),
        reply: { melds: [cards(["9D", "10D", "JD"]), cards(["QS", "QH", "QD"])], layoffs: [] },
      },
    ],
  },
];
