// Hearts' tutorial lessons (see engine/tutorial.js). You sit at the bottom
// (seat 0) with Teal on your left, Violet across and Amber on your right
// (seats 1–3), with fixed hands from a deck whose every card is known
// (engine/cards/lesson-deck.js), so no shuffle runs. Cards are names like
// "10H". A position is the pass before a hand,
//   { pass: "left", hands }   13 cards each, yours first; you pick first
// or a trick late in a hand,
//   { hands, lead, trick, tricks, taken }
// with hands as the trick began, lead the seat that led it (default you),
// trick the cards played to it so far, tricks how many tricks each seat has
// won and taken the point cards among them (the rest of their cards are the
// pointless ones nobody holds). Moves are the game's own: { pass: [three
// cards in hand order] } and { play: card }. A reply is a list of moves, each
// by whoever is to move then. Cells are a card in your hand, "trick" (where
// your card lands), "pass" (the Pass button) and "won" (your won tricks).
import { card } from "../engine/cards/lesson-deck.js";

const play = (name) => ({ play: card(name) });
const pass = (...names) => ({ pass: names.map(card) });

export const lessons = [
  {
    title: "Following suit",
    steps: [
      {
        text: "Violet led a diamond, and you must follow the suit led if you can. The highest card of that suit takes the trick, aces high: play your A♦.",
        position: {
          hands: [["AD", "4D", "7S", "9C"], ["2D", "3C", "KH", "AH"], ["8D", "6S", "QH", "10H"], ["KD", "QC", "5H", "9H"]],
          lead: 2,
          trick: ["8D", "KD"],
          tricks: [2, 3, 2, 2],
          taken: [[], ["2H", "3H", "4H"], ["QS", "6H"], ["7H", "8H", "JH"]],
        },
        highlight: [card("AD")],
        arrows: [[card("AD"), "trick"]],
        expect: play("AD"),
        reply: [play("2D")],
      },
      {
        text: "You took the trick, so you lead the next one. Lead your 9♣: everyone has to follow with a club if they can.",
        highlight: [card("9C")],
        expect: play("9C"),
        reply: [play("3C"), play("6S"), play("QC")],
      },
    ],
  },
  {
    title: "Passing three cards",
    steps: [
      {
        text: "Before each hand you pass three cards, this time left to Teal. Pass the ones you least want, the Q♠, K♠ and A♠: tap them, then Pass left.",
        position: {
          pass: "left",
          hands: [
            ["QS", "KS", "AS", "5S", "3H", "9H", "JH", "6D", "10D", "KD", "4C", "8C", "JC"],
            ["2S", "3S", "6S", "7S", "2H", "4H", "5H", "2D", "3D", "4D", "5D", "7D", "8D"],
            ["8S", "9S", "10S", "JS", "6H", "7H", "8H", "10H", "QH", "9D", "JD", "QD", "AD"],
            ["4S", "KH", "AH", "2C", "3C", "5C", "6C", "7C", "9C", "10C", "QC", "KC", "AC"],
          ],
        },
        highlight: [card("QS"), card("KS"), card("AS"), "pass"],
        expect: pass("QS", "KS", "AS"),
        reply: [pass("4H", "5H", "8D"), pass("JS", "QH", "AD"), pass("2C", "KH", "AH")],
      },
      {
        text: "Amber passed you three cards, marked with a dot. Whoever holds the 2♣ leads it to the first trick (in a game it's played for you): play it.",
        highlight: [card("2C")],
        arrows: [[card("2C"), "trick"]],
        expect: play("2C"),
        reply: [play("7D"), play("10S"), play("10C")],
      },
    ],
  },
  {
    title: "Hearts and the queen",
    steps: [
      {
        text: "Each heart you take is 1 point and the queen of spades 13, and the lowest score wins. You have no diamonds, so you may play anything: give Violet the Q♠.",
        position: {
          hands: [["QS", "2H", "KH"], ["5D", "7H", "4C"], ["AD", "4H", "10C"], ["9D", "9H", "8C"]],
          lead: 1,
          trick: ["5D", "AD", "9D"],
          tricks: [3, 2, 3, 2],
          taken: [[], ["3H", "5H", "6H"], [], ["8H", "10H", "JH", "QH", "AH"]],
        },
        highlight: [card("QS")],
        arrows: [[card("QS"), "trick"]],
        expect: play("QS"),
        reply: [play("4H"), play("9H")],
      },
      {
        text: "Violet took 13 points and led a heart. Follow with your 2♥, under Amber's 9♥, so the trick and its hearts go to Amber.",
        highlight: [card("2H")],
        expect: play("2H"),
        reply: [play("7H")],
      },
    ],
  },
  {
    title: "Breaking hearts",
    steps: [
      {
        text: "You lead this trick. Hearts can't be led until a heart or the queen of spades has been played (hearts are broken), unless you hold only hearts. Lead the K♣.",
        position: {
          hands: [["KC", "6D", "2H", "3H", "9H", "JH"], ["4C", "7D", "4H", "5H", "6H", "QS"], ["9C", "3S", "7H", "10H", "QH", "KH"], ["AH", "8H", "2S", "5S", "QD", "10D"]],
          tricks: [2, 2, 2, 1],
        },
        highlight: [card("KC")],
        expect: play("KC"),
        reply: [play("4C"), play("9C"), play("AH")],
      },
      {
        text: "Amber had no clubs and played a heart, so hearts are broken. You took the trick, so you lead again, and now you may lead a heart.",
        highlight: [card("2H"), card("3H"), card("9H"), card("JH")],
        expect: [play("2H"), play("3H"), play("9H"), play("JH")],
        reply: [play("4H"), play("7H"), play("8H")],
      },
    ],
  },
  {
    title: "Shooting the moon",
    steps: [
      {
        text: "You've taken 11 hearts and the queen: 24 points. Take all 13 hearts and the queen and you shoot the moon: everyone else gets 26 instead of you. Lead the K♥.",
        position: {
          hands: [["KH", "AH", "3C"], ["5S", "8D", "JC"], ["9S", "4D", "6C"], ["KS", "10D", "QC"]],
          tricks: [6, 2, 1, 1],
          taken: [["2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10H", "JH", "QH", "QS"], [], [], []],
        },
        highlight: [card("KH")],
        expect: play("KH"),
        reply: [play("8D"), play("4D"), play("10D")],
      },
      {
        text: "Nobody else has a heart left. Lead the A♥ to take the last one; your last card is then played for you.",
        highlight: [card("AH")],
        expect: play("AH"),
        reply: [play("5S"), play("9S"), play("KS"), play("3C"), play("JC"), play("6C"), play("QC")],
      },
    ],
  },
];
