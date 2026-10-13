// Picking a move square by square, shared by the game (main.js) and its
// tutorial (tutorial.js).
export const startsWith = (path, prefix) => path.length >= prefix.length && prefix.every((sq, k) => path[k] === sq);

// Where the multi-jumps a picked piece can go on with would end, each with
// its path, when no other way ends there and it isn't the next landing: a
// tap there plays the whole jump.
export function jumpEnds(legal, picked) {
  const ways = legal.filter((m) => m.length > picked.length && startsWith(m, picked));
  const targets = new Set(ways.map((m) => m[picked.length]));
  const lastSquares = ways.map((m) => m[m.length - 1]);
  const ends = new Map();
  for (const [k, sq] of lastSquares.entries()) {
    if (!targets.has(sq) && sq !== picked[0] && lastSquares.indexOf(sq) === lastSquares.lastIndexOf(sq)) ends.set(sq, ways[k]);
  }
  return ends;
}
