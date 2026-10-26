// Chess page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import {
  makeRules,
  normalizeConfig,
  colorOfPlayer,
  isTimed,
  timeLeft,
  listMoves,
  inCheck,
  squareName,
  colorOf,
  typeOf,
  WHITE,
  DRAW,
  PAWN,
} from "./rules.js";
import { startRobot } from "./robot.js";
import { settings, LEVEL_NAMES } from "./settings.js";
import { playMove } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";
import { COLOR_NAMES, PIECE_NAMES, pieceSvg, pieceName, promoOptions } from "./art.js";
import { landMove, dragPieces, reducedMotion } from "./motion.js";

const ROBOT_SEARCH_MS = 250; // search cap, so a slow phone still answers quickly
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const VALUES = [0, 1, 3, 3, 5, 9, 0];

startGameShell({
  slug: "chess",
  title: "Chess",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "narrow",
  settings,
  createRobot(session) {
    const config = settings.get();
    return startRobot(session, { rules: makeRules(config), level: config.level, timeMs: ROBOT_SEARCH_MS });
  },
  onSession: (session, root, shell) => mountChess(session, root, shell),
});

const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function describeConfig(c, robot) {
  const parts = [c.moveSeconds ? `${c.moveSeconds} s a move` : "no move limit", c.gameSeconds ? `${c.gameSeconds / 60} min each` : "no game clock"];
  if (robot) parts.push(`${LEVEL_NAMES[c.level]} robot`);
  return parts.join(" · ");
}

function mountChess(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const score = { wins: [0, 0], draws: 0 };
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let destroyed = false;
  let turnStart = 0;
  let forfeited = false;
  let claimed = false;
  let selected = -1; // square of the picked-up piece
  let focusSq = -1; // the square that takes Tab focus
  let promoFor = null; // { from, to } while the promotion picker is open
  let resignArmed = 0;
  let landing = null; // the move just applied, to animate after the board redraws
  let dropping = false; // true while a drag-and-drop plays its move
  let dropped = null; // a move dropped in place: no slide needed

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg)));

  // ---------- layout ----------
  const pills = [me, opp].map((player) => {
    const dot = el("span", { class: "pill-color", "aria-label": "colour not decided" });
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"} mono`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    const taken = el("div", { class: `chess-taken ${player === me ? "mine" : "theirs"}`, "aria-label": player === me ? "Pieces you captured" : `Pieces ${oppName} captured` });
    return { dot, clock, taken };
  });
  const bar = playerBar(session, { onLeave: () => shell.leave() });
  bar.update({ badges: { [me]: pills[0].dot, [opp]: pills[1].dot } });
  const status = el("p", { class: "chess-status", id: "chess-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "chess-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left mono", id: "chess-move-left", role: "timer", "aria-label": "Time left for this move" });
  const clocks = el("div", { class: "chess-clocks", id: "chess-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const board = el("div", { class: "chess-board", id: "chess-board", role: "group", "aria-label": "Chessboard" });
  const promoBox = el("div", { class: "chess-promo", id: "chess-promo", role: "dialog", "aria-label": "Promote your pawn", hidden: true });
  const resignBtn = el("button", { class: "btn small", type: "button", id: "resign", onclick: onResign }, "Resign");
  const resignHint = el("span", { class: "chess-hint", id: "resign-hint" });
  const actions = el("div", { class: "chess-actions", id: "chess-actions" }, resignBtn, resignHint);
  const movesList = el("ol", { class: "chess-moves", id: "chess-moves", "aria-label": "Moves" });
  const configLine = el("p", { class: "chess-config", id: "chess-config" });
  const note = el("p", { class: "chess-note", id: "chess-note" });
  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "wood", highlight: match.state.reason === "checkmate" ? [squares[match.state.kings[match.state.side]]] : [], board }),
  });
  let squares = []; // by square index
  let flipped = false;

  root.append(
    el(
      "div",
      { class: "chess" },
      bar.node,
      status,
      clocks,
      pills[1].taken,
      el("div", { class: "chess-board-wrap" }, board, promoBox),
      pills[0].taken,
      actions,
      result.node,
      movesList,
      configLine,
      note,
    ),
  );

  // Rows top to bottom as seen by this player: White sees rank 8 at the top.
  const visualSquares = () => Array.from({ length: 64 }, (_, v) => (flipped ? (v >> 3) * 8 + (7 - (v & 7)) : (7 - (v >> 3)) * 8 + (v & 7)));

  function buildBoard() {
    flipped = colorOfPlayer(match.state, me) !== WHITE;
    squares = [];
    const rows = [];
    const order = visualSquares();
    for (let r = 0; r < 8; r++) {
      const row = el("div", { class: "chess-row" });
      for (let c = 0; c < 8; c++) {
        const sq = order[r * 8 + c];
        const light = ((sq >> 3) + (sq & 7)) % 2 === 1;
        const btn = el("button", { type: "button", class: `sq ${light ? "light" : "dark"}`, tabindex: "-1", dataset: { sq } });
        const art = el("span", { class: "art" });
        btn.append(art);
        if (c === 0) btn.append(el("span", { class: "coord rank", "aria-hidden": "true" }, String((sq >> 3) + 1)));
        if (r === 7) btn.append(el("span", { class: "coord file", "aria-hidden": "true" }, "abcdefgh"[sq & 7]));
        squares[sq] = btn;
        row.append(btn);
      }
      rows.push(row);
    }
    board.replaceChildren(...rows);
    focusSq = match.state.kings[colorOfPlayer(match.state, me)];
  }

  // ---------- input ----------
  const myColor = () => colorOfPlayer(match.state, me);
  const movesFrom = (from) => listMoves(match.state).filter((mv) => mv.from === from);

  function select(sq) {
    selected = sq;
    render();
  }

  function onSquare(sq) {
    if (!match || match.phase !== "playing" || promoFor) return;
    const st = match.state;
    if (!match.canMove()) return toast(st.turn === opp ? `Wait for ${oppName}` : "One moment…");
    const piece = st.board[sq];
    if (selected >= 0 && selected !== sq) {
      const options = movesFrom(selected).filter((mv) => mv.to === sq);
      if (options.length > 1) return openPromo(selected, sq);
      if (options.length === 1) return send({ from: selected, to: sq });
    }
    if (piece && colorOf(piece) === myColor()) {
      if (selected === sq) return select(-1);
      if (!movesFrom(sq).length) toast(inCheck(st) ? "Your king is in check" : `That ${PIECE_NAMES[typeOf(piece)]} can't move`);
      return select(sq);
    }
    if (selected >= 0) {
      // Not a legal target: let the rules say why, then drop the piece.
      match.play(withTime({ from: selected, to: sq }));
      select(-1);
    }
  }

  function withTime(move) {
    if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
    return move;
  }

  function send(move) {
    dropped = dropping ? move : null;
    selected = -1;
    promoFor = null;
    promoBox.hidden = true;
    match.play(withTime(move));
    render();
  }

  board.addEventListener("click", (e) => {
    const btn = e.target.closest(".sq");
    if (btn) onSquare(Number(btn.dataset.sq));
  });
  const stopDrag = dragPieces(board, {
    pieceAt: (sq) => {
      const piece = match?.canMove() && !promoFor ? match.state.board[sq] : 0;
      return piece && colorOf(piece) === myColor() ? piece : 0;
    },
    lift: select,
    drop: (sq) => {
      dropping = true;
      onSquare(sq);
      dropping = false;
    },
  });
  board.addEventListener("focusin", (e) => {
    const btn = e.target.closest(".sq");
    if (btn) focusSq = Number(btn.dataset.sq);
  });
  // Arrow keys move between squares as seen on screen; Enter or Space picks up and puts down.
  board.addEventListener("keydown", (e) => {
    const btn = e.target.closest(".sq");
    if (e.key === "Escape" && selected >= 0) return select(-1);
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!btn || !step) return;
    e.preventDefault();
    const order = visualSquares();
    const v = order.indexOf(Number(btn.dataset.sq));
    const r = Math.min(7, Math.max(0, (v >> 3) + step[0]));
    const c = Math.min(7, Math.max(0, (v & 7) + step[1]));
    focusSq = order[r * 8 + c];
    renderFocus();
    squares[focusSq].focus();
  });

  function openPromo(from, to) {
    promoFor = { from, to };
    promoBox.replaceChildren(
      el("p", {}, "Promote to"),
      promoOptions(myColor(), (promo) => send({ from, to, promo })),
      el("button", { type: "button", class: "btn ghost small", onclick: closePromo }, "Cancel"),
    );
    promoBox.hidden = false;
    promoBox.querySelector(".promo-opt").focus();
  }
  function closePromo() {
    promoFor = null;
    promoBox.hidden = true;
    select(-1);
    squares[focusSq]?.focus();
  }
  promoBox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePromo();
  });

  function onResign() {
    if (!match?.canMove()) return;
    if (Date.now() - resignArmed < 4000) {
      resignArmed = 0;
      match.play({ resign: true });
      return;
    }
    resignArmed = Date.now();
    renderActions();
    setTimeout(renderActions, 4100);
  }

  // ---------- clocks ----------
  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !isTimed(match.state)) return;
    const st = match.state;
    const elapsed = performance.now() - turnStart;
    renderClocks(elapsed);
    const left = timeLeft(st, st.turn) - elapsed;
    if (st.turn === me && left <= 0 && !forfeited && match.canMove()) {
      forfeited = true;
      promoFor = null;
      promoBox.hidden = true;
      match.play({ timeout: true });
    } else if (st.turn === opp && left <= -CLAIM_GRACE_MS && !claimed) {
      // Their browser should have forfeited by now (closed laptop, frozen tab).
      claimed = true;
      match.send({ t: "abort", reason: "your clock ran out" });
      match.abort(`${oppName}'s clock ran out and their browser stopped answering.`);
    }
  }
  const ticker = setInterval(tick, 200);

  function renderClocks(elapsed = 0) {
    const st = match?.state;
    const playing = match?.phase === "playing";
    clocks.hidden = !st || !isTimed(st);
    if (clocks.hidden) return;
    for (const [k, player] of [me, opp].entries()) {
      const { clock } = pills[k];
      const running = playing && st.turn === player;
      clock.classList.toggle("active", running);
      clock.hidden = !st.clocks;
      if (!st.clocks) continue;
      const ms = st.clocks[player] - (running ? elapsed : 0);
      clock.textContent = clockText(ms);
      clock.classList.toggle("low", running && ms < 20_000);
    }
    const left = playing ? Math.max(0, timeLeft(st, st.turn) - elapsed) : 0;
    moveBar.hidden = !(playing && st.moveMs);
    moveBarFill.style.width = st.moveMs ? `${Math.min(1, left / st.moveMs) * 100}%` : "0%";
    moveBar.classList.toggle("mine", playing && st.turn === me);
    moveBar.classList.toggle("low", left < 10_000);
    moveLeft.textContent = playing && st.moveMs ? `${Math.ceil(left / 1000)} s` : "";
  }

  // ---------- render ----------
  function renderPills() {
    const st = match?.state;
    bar.update({ turn: match?.phase === "playing" ? st.turn : -1 });
    for (const [k, player] of [me, opp].entries()) {
      const { dot } = pills[k];
      const color = st ? colorOfPlayer(st, player) : -1;
      dot.dataset.color = color < 0 ? "" : color === WHITE ? "w" : "b";
      dot.setAttribute("aria-label", color < 0 ? "colour not decided" : `plays ${COLOR_NAMES[color]}`);
    }
  }

  function renderTaken() {
    const st = match?.state;
    if (!st) return;
    const points = [0, 1].map((c) => st.captured[c].reduce((n, t) => n + VALUES[t], 0));
    for (const [k, player] of [me, opp].entries()) {
      const color = colorOfPlayer(st, player);
      const lead = points[color] - points[color ^ 1];
      const types = st.captured[color].slice().sort((a, b) => VALUES[b] - VALUES[a] || b - a);
      const box = pills[k].taken;
      const key = `${types.join("")}/${lead}`;
      if (box.dataset.key === key) continue;
      box.dataset.key = key;
      box.innerHTML = types.map((t) => pieceSvg(((color ^ 1) << 3) | t)).join("");
      if (lead > 0) box.append(el("span", { class: "lead" }, `+${lead}`));
    }
  }

  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin for White…" : "Getting ready…";
      case "playing":
        if (st.turn !== me) return session.mode === "robot" ? `${oppName}'s turn` : `${oppName} is thinking…`;
        return inCheck(st) ? "Check! Save your king." : `Your move (${COLOR_NAMES[myColor()]}).`;
      case "over":
        if (st.winner === DRAW) return `Draw: ${drawText(st.reason)}`;
        if (st.reason === "timeout") return st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
        if (st.reason === "resign") return st.winner === me ? `${oppName} resigned. You win!` : "You resigned.";
        return st.winner === me ? "Checkmate! You win!" : `Checkmate. ${oppName} wins.`;
      default:
        return "Match stopped.";
    }
  }

  function drawText(reason) {
    return {
      stalemate: "stalemate.",
      repetition: "the same position came up three times.",
      fifty: "fifty moves each without a capture or pawn move.",
      material: "not enough pieces left to checkmate.",
    }[reason];
  }

  function renderFocus() {
    for (const btn of squares) btn.tabIndex = Number(btn.dataset.sq) === focusSq ? 0 : -1;
  }

  function renderBoard() {
    const st = match?.state;
    if (!st || !squares.length) return;
    const myTurn = !!match.canMove();
    const targets = new Map();
    if (selected >= 0 && myTurn) for (const mv of movesFrom(selected)) targets.set(mv.to, mv);
    else selected = -1;
    const last = st.moves.at(-1);
    const checkSq = match.phase !== "aborted" && inCheck(st) ? st.kings[st.side] : -1;
    board.classList.toggle("armed", myTurn);
    for (let sq = 0; sq < 64; sq++) {
      const btn = squares[sq];
      const piece = st.board[sq];
      const art = btn.firstChild;
      if (btn.dataset.p !== String(piece)) {
        btn.dataset.p = String(piece);
        art.innerHTML = piece ? pieceSvg(piece) : "";
      }
      const mine = piece && colorOf(piece) === myColor();
      btn.classList.toggle("sel", sq === selected);
      btn.classList.toggle("target", targets.has(sq) && !piece && !(targets.get(sq).to === st.ep && typeOf(st.board[selected]) === PAWN));
      btn.classList.toggle("capture", targets.has(sq) && !btn.classList.contains("target"));
      btn.classList.toggle("last", !!last && (sq === last.from || sq === last.to));
      btn.classList.toggle("check", sq === checkSq);
      btn.classList.toggle("mine", !!mine);
      let label = `${squareName(sq)}, ${piece ? pieceName(piece) : "empty"}`;
      if (sq === selected) label += ", selected";
      else if (targets.has(sq)) label += piece ? ", capture" : ", move here";
      if (sq === checkSq) label += ", in check";
      btn.setAttribute("aria-label", label);
    }
    board.classList.toggle("done", match.phase === "over" || match.phase === "aborted");
    renderFocus();
  }

  function renderMoves() {
    const st = match?.state;
    const list = st ? st.moves : [];
    if (movesList.dataset.n === String(list.length)) return;
    movesList.dataset.n = String(list.length);
    const items = [];
    for (let i = 0; i < list.length; i += 2) {
      items.push(el("li", {}, el("span", { class: "num" }, `${i / 2 + 1}.`), el("span", { class: "ply" }, list[i].san), list[i + 1] && el("span", { class: "ply" }, list[i + 1].san)));
    }
    movesList.replaceChildren(...items);
    movesList.hidden = !items.length;
    movesList.scrollTop = movesList.scrollHeight;
  }

  function renderActions() {
    const playing = match?.phase === "playing";
    actions.hidden = !playing;
    if (!playing) return;
    const can = match.canMove();
    const armed = can && Date.now() - resignArmed < 4000;
    resignBtn.disabled = !can;
    resignBtn.classList.toggle("armed", armed);
    resignBtn.textContent = armed ? "Tap again to resign" : "Resign";
    resignHint.textContent = can ? "" : "You can resign on your turn.";
  }

  // ---------- animation ----------
  // The piece glides from its old square; the sound plays as it lands.
  function animateMove(moved) {
    const still = reducedMotion() || (dropped && dropped.from === moved.from && dropped.to === moved.to);
    dropped = null;
    const loser = ((colorOfPlayer(match.state, moved.player) ^ 1) << 3) | moved.captured;
    landMove(squares, moved, loser, still).then(() => !destroyed && playMove(moved));
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    shell.setInProgress(phase !== "over" && phase !== "aborted");
    root.querySelector(".chess").dataset.phase = phase;
    // Coral is White, who moves first, on every screen.
    root.querySelector(".chess").dataset.you = st ? (st.white === me ? "a" : "b") : "";
    if (phase === "playing" && !squares.length) buildBoard();
    renderPills();
    bar.update({ score });
    renderClocks(phase === "playing" ? performance.now() - turnStart : 0);
    status.textContent = statusText();
    status.classList.toggle("mine", phase === "playing" && st.turn === me);
    status.classList.toggle("check", phase === "playing" && st.turn === me && inCheck(st));
    renderBoard();
    if (landing && squares.length) {
      animateMove(landing);
      landing = null;
    }
    if (!promoFor) promoBox.hidden = true;
    renderTaken();
    renderMoves();
    renderActions();
    renderOver();
  }

  function renderOver() {
    const phase = match?.phase;
    if (phase !== "over" && phase !== "aborted") return result.hide();
    promoFor = null;
    promoBox.hidden = true;
    const st = match.state;
    const winner = phase === "over" ? st.winner : -1;
    let reason;
    if (phase === "aborted") reason = match.abortReason || "The match was stopped.";
    else if (winner === DRAW) reason = { stalemate: "Stalemate: no legal move, but no check either.", repetition: "The same position came up three times.", fifty: "Fifty moves each without a capture or a pawn move.", material: "Neither side has enough pieces left to checkmate." }[st.reason];
    else if (st.reason === "timeout") reason = winner === me ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else if (st.reason === "resign") reason = winner === me ? `${oppName} resigned.` : "You resigned.";
    else reason = winner === me ? `Checkmate with ${st.moves.at(-1).san}.` : `${oppName} checkmated you with ${st.moves.at(-1).san}.`;
    result.show({ winner: winner === DRAW ? -1 : winner, stopped: phase === "aborted", reason });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    forfeited = false;
    claimed = false;
    selected = -1;
    promoFor = null;
    promoBox.hidden = true;
    resignArmed = 0;
    landing = null;
    dropped = null;
    squares = [];
    board.replaceChildren();
    for (const { taken } of pills) {
      taken.replaceChildren();
      delete taken.dataset.key;
    }
    note.textContent = m === 1 ? `Playing against ${oppName}. Good luck!` : `Rematch #${m - 1}. Same settings, fresh board.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => toast(reason));
    match.on("start", () => {
      turnStart = performance.now();
      const color = COLOR_NAMES[colorOfPlayer(match.state, me)];
      note.textContent = config.first === "random" ? `Coin toss (drawn by both browsers): you play ${color}.` : `Room setting: you play ${color}.`;
      toast(match.state.white === me ? "You play White. Your move!" : `${oppName} plays White and moves first`);
    });
    match.on("events", ({ player, events }) => {
      turnStart = performance.now();
      const moved = events.find((e) => e.type === "moved");
      if (moved) landing = moved;
      if (moved && player === opp && moved.check && match.state.winner === -1) toast("Check!");
    });
    match.on("over", ({ winner }) => {
      if (winner === DRAW) score.draws++;
      else score.wins[winner]++;
    });
    router.start(match);
    render();
  }

  // The room's settings come from whoever created it (the robot uses ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = describeConfig(config, session.mode === "robot");
    newMatch();
  }
  function onSetup(msg) {
    if (me === 1) begin(msg.config);
  }

  const offs = [
    offMsg,
    session.on("rematch-start", () => config && newMatch()),
  ];
  if (session.mode === "robot") begin(settings.get());
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      clearInterval(ticker);
      stopDrag();
      for (const off of offs) off();
    },
  };
}
