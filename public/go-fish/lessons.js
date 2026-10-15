// Go Fish's tutorial lessons (see engine/tutorial.js). You play coral against
// teal, with fixed hands from a deck whose every card is known
// (engine/cards/lesson-deck.js), so no shuffle runs. A position is both hands
// (yours first) as names like "10H", the books each player has laid down as
// ranks like "Q", and the pond's top cards (the rest of the deck follows
// them); it is your ask. Moves are the game's own: you ask, { ask: rank,
// from: 1 }, and a reply is Teal's answer ({ give: [cards] } or { fish: true })
// or a list of Teal's moves in order. Everything else is made for whoever
// must, as in the game: your answers, books, lucky fish and the end of a turn,
// and Teal's. Cells are a card in your hand, a rank of yours ("7s", "Kings"),
// "ask", "pond", "teal", "books", "teal-books" and a book you laid
// ("book:<slot>", its first card).
import { card, cards } from "../engine/cards/lesson-deck.js";
import { rankOf } from "./rules.js";

const rank = (r) => rankOf(card(`${r}S`));
const ask = (r) => ({ ask: rank(r), from: 1 });
const give = (...names) => ({ give: cards(names) });

export const lessons = [
  {
    title: "Asking for a rank",
    steps: [
      {
        text: "On your turn, ask Teal for a rank you hold. Tap one of your 7s, then Ask Teal for 7s.",
        position: { hands: [["7S", "7H", "KC", "4D", "9S", "2H", "JD"], ["7D", "KS", "KH", "3C", "5H", "8S", "QC"]] },
        highlight: [card("7S"), card("7H"), "ask"],
        expect: ask("7"),
        reply: give("7D"),
      },
      {
        text: "Teal had a 7 and handed it over, so you ask again. Ask for Kings: Teal must hand over every one.",
        highlight: [card("KC"), "ask"],
        expect: ask("K"),
        reply: give("KS", "KH"),
      },
    ],
  },
  {
    title: "Go fish!",
    steps: [
      {
        text: "When Teal has none of the rank you ask for, Teal says “Go fish!” and you draw a card from the pond. Ask for 5s.",
        position: { hands: [["5C", "9H", "2S", "10D", "6C"], ["8D", "JC", "JH", "4S", "AH", "3D"]], stock: ["2C", "6S", "9D"] },
        highlight: [card("5C"), "pond"],
        expect: ask("5"),
        reply: [{ fish: true }, { ask: rank("J"), from: 0 }],
      },
      {
        text: "You drew a 2 and the turn passed; Teal asked you for Jacks and went fishing too. Now ask for 9s: draw the rank you asked for and you go again.",
        highlight: [card("9H"), "pond"],
        expect: ask("9"),
        reply: { fish: true },
      },
    ],
  },
  {
    title: "Making a book",
    steps: [
      {
        text: "Four cards of one rank make a book, laid face up in front of you. You hold three Queens: ask Teal for the fourth.",
        position: { hands: [["QS", "QH", "QC", "3D", "8C", "AS"], ["QD", "5S", "10H", "6D", "JS"]] },
        highlight: [card("QS"), card("QH"), card("QC")],
        expect: ask("Q"),
        reply: give("QD"),
      },
    ],
  },
  {
    title: "The most books wins",
    steps: [
      {
        text: "The game ends when all 13 books are down, and the most books wins. Teal has 6 to your 5: ask for Queens to draw level.",
        position: {
          hands: [["QS", "QH", "QC", "JS", "JH"], ["QD", "JD", "JC"]],
          books: [["A", "2", "3", "4", "5"], ["6", "7", "8", "9", "10", "K"]],
        },
        highlight: ["books", "teal-books", card("QS")],
        expect: ask("Q"),
        reply: give("QD"),
      },
      {
        text: "Six each, and only the Jacks are left. Ask for them to lay down the last book and win, 7 to 6.",
        highlight: [card("JS"), card("JH")],
        expect: ask("J"),
        reply: give("JD", "JC"),
      },
    ],
  },
];
