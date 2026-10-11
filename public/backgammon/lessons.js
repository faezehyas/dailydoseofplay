// Backgammon's tutorial lessons (see engine/tutorial.js). A position maps
// points to checkers for you (mine, coral) and for teal (theirs), both
// counted from your side: 1 is the innermost point of your home board,
// bottom right, 24 the farthest, and 25 is your bar. Its roll is the step's
// fixed dice, rolled for you. Moves are the game's own { type: "play",
// steps: [[from, die], …] }, the steps from the farthest point in; 0 is off
// the board.
const START = { mine: { 24: 2, 13: 5, 8: 3, 6: 5 }, theirs: { 1: 2, 12: 5, 17: 3, 19: 5 } };
const play = (...steps) => ({ type: "play", steps });

export const lessons = [
  {
    title: "Moving by the dice",
    steps: [
      {
        text: "You play coral, round to your home at the bottom right. Each die moves one checker that many points. You rolled 3 and 1: move a checker from 8 to 5, then one from 6 to 5.",
        position: { ...START, roll: [3, 1] },
        highlight: [8, 6, 5],
        arrows: [[8, 5], [6, 5]],
        expect: play([8, 3], [6, 1]),
      },
      {
        text: "One checker can take both dice. Run a back checker from 24 to 13: 6 to point 18, then 5 more. It can't stop on 19: two or more teal checkers block a point.",
        position: { ...START, roll: [6, 5] },
        highlight: [24, 18, 13],
        arrows: [[24, 18], [18, 13]],
        expect: play([24, 6], [18, 5]),
      },
    ],
  },
  {
    title: "Doubles",
    steps: [
      {
        text: "A double is played four times. You rolled double 3s: move two checkers from 8 to 5, and two from 6 to 3.",
        position: { ...START, roll: [3, 3] },
        highlight: [8, 6, 5, 3],
        arrows: [[8, 5], [6, 3]],
        expect: play([8, 3], [8, 3], [6, 3], [6, 3]),
      },
    ],
  },
  {
    title: "Hitting a blot",
    steps: [
      {
        text: "A lone checker is a blot. Land on a teal blot to hit it: it goes to the bar and starts again. Hit the blot on 4 from 8, then cover your checker with one from 6.",
        position: { mine: START.mine, theirs: { 1: 1, 4: 1, 12: 5, 17: 3, 19: 5 }, roll: [4, 2] },
        highlight: [8, 6, 4],
        arrows: [[8, 4], [6, 4]],
        expect: play([8, 4], [6, 2]),
      },
    ],
  },
  {
    title: "Entering from the bar",
    steps: [
      {
        text: "A hit checker waits on the bar, and nothing else moves until it comes back in, at the top right: a 2 enters on 23, a 6 on 19. Teal blocks 19, so enter with the 2, then play the 6 with any checker.",
        position: { mine: { 25: 1, 24: 1, 13: 5, 8: 3, 6: 5 }, theirs: START.theirs, roll: [6, 2] },
        highlight: [25, 23],
        arrows: [[25, 23]],
        expect: [play([25, 2], [24, 6]), play([25, 2], [13, 6]), play([25, 2], [8, 6])],
      },
    ],
  },
  {
    title: "Bearing off",
    steps: [
      {
        text: "Once all your checkers are in your home board, you bear them off: a die takes a checker off its point. Bear off from 6 and from 4.",
        position: { mine: { 6: 2, 4: 2, 2: 1 }, theirs: { 24: 2, 20: 3 }, roll: [6, 4] },
        highlight: [6, 4, 0],
        arrows: [[6, 0], [4, 0]],
        expect: play([6, 6], [4, 4]),
      },
      {
        text: "A die higher than your farthest checker bears off from the farthest point. Bear off from 4, then from 2.",
        position: { mine: { 4: 1, 2: 2 }, theirs: { 24: 2, 20: 3 }, roll: [6, 5] },
        highlight: [4, 2, 0],
        arrows: [[4, 0], [2, 0]],
        expect: [play([4, 5], [2, 6]), play([4, 6], [2, 5])],
      },
    ],
  },
];
