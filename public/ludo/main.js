// Ludo page: mounts the engine shell and renders a TurnMatch. The rules live
// in rules.js and the board art in art.js; this file is the view: the die,
// picking a token, the motion and the sounds. The match state never waits
// for the screen: every roll and move is queued and played out in order.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch } from "../engine/turn-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { makeRules, normalizeConfig, distinctMoves, legalMoves, progress, colorsFor, COLORS, MAX_PLAYERS, YARD, HOME, LAST_LOOP, TOKENS } from "./rules.js";
import { chooseMove, startRobot } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { s, SIZE, rotator, pawnArt, pawnDefs, boardArt, markSvg, dieFace } from "./art.js";
import { boardMotion, rollingDie, drawChoices, tokenTarget, wireTargets, moveLabel, PACE } from "./board-view.js";
import { howToPlay } from "./how-to-play.js";

const ROBOT_PACE = { roll: 500, pick: 600, forced: 350, hurry: 90 };
const FORCED_DELAY = 650; // before a move you have no choice about is played for you
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const COLOR_NAME = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" };
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const PLACE = ["", "1st", "2nd", "3rd", "4th"];

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const still = () => reduced.matches;

// Robot games: robots wait for the screen to finish replaying, and hurry once
// you are home. The view sets these.
let screenBusy = () => false;
let hurry = 0; // 0 normal, 1 quick, 2 skip to the end

startGameShell({
  slug: "ludo",
  title: "Ludo",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "wide",
  settings,
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,
  createRobot: (session) => {
    const config = settings.get();
    return startRobot(session, {
      rules: makeRules(config),
      choose: (st, me, rng) => chooseMove(st, me, rng, { level: config.level }),
      delay: (st, me) => {
        if (hurry === 2) return 0;
        if (screenBusy()) return -1;
        // With reduced motion nothing replays, so robots needn't wait as long.
        const k = still() ? 0.15 : 1;
        if (hurry) return ROBOT_PACE.hurry * k;
        if (!st.rolled) return ROBOT_PACE.roll * k;
        return (distinctMoves(st, me).length === 1 ? ROBOT_PACE.forced : ROBOT_PACE.pick) * k;
      },
    });
  },
  // A capture usually costs the robot 10 squares or more; a move gains at most 6.
  banter: { score: progress, strong: 10, lines: { strongMove: ["Back to the yard…"], lead: ["Coming through!"] } },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const seats = session.players.map((p) => p.seat);
  const colors = colorsFor(count);
  const colorOf = (p) => colors[p];
  const cname = (p) => COLORS[colorOf(p)];
  // Your colour goes bottom left: turn the board that many quarter turns.
  const k = (3 - colorOf(me) + 4) % 4;
  const rot = rotator(k);
  const order = [me, ...session.others.map((p) => p.seat)];
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  const robotGame = session.mode === "robot";
  const score = { wins: Array(count).fill(0) };
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let gen = 0; // bumps on every new match, so old animations stop
  let destroyed = false;
  let ended = false;
  let shown = []; // tokens as drawn, by seat
  let queue = Promise.resolve();
  let pending = 0;
  let current = null; // what is being played out: { player, phase }
  let log = [];
  let cuedPly = -1;
  let forcedPly = -1;
  let forcedTimer = null;
  let rolling = false; // my die is tumbling while the draw completes
  let focusToken = null; // the token hovered or focused, while picking
  let deadline = 0; // when the player on turn runs out of time, on this screen
  let deadlineKey = "";
  let autoKey = "";
  let lastTick = 0;

  // One session handler: "setup" is for this view (and only from the room's creator), the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const wheres = seats.map(() => el("span", { class: "where" }));
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `c-${cname(p)}` });
  bar.update({ badges: seats.map((p) => el("span", { class: "swatch", "aria-hidden": "true" }, markSvg(colorOf(p), 10))), notes: wheres });
  const status = el("p", { class: "ld-status", id: "ld-status", role: "status", "aria-live": "polite" });

  const svg = s("svg", { class: "ld-board", id: "ld-board", viewBox: `-10 -10 ${SIZE + 20} ${SIZE + 20}`, role: "group" });
  const seated = [null, null, null, null];
  for (const p of seats) seated[colorOf(p)] = p === me ? "You" : session.players[p].name;
  svg.append(pawnDefs(), boardArt(seated, k));
  const blockLayer = s("g", { class: "blocks", "aria-hidden": "true" });
  const marks = s("g", { class: "marks" });
  const pawnLayer = s("g", { class: "pawns" });
  const hits = s("g", { class: "hits" });
  const fx = s("g", { class: "fx", "aria-hidden": "true" });
  svg.append(blockLayer, marks, pawnLayer, fx, hits);
  const pawns = seats.map((p) => Array.from({ length: TOKENS }, (_, t) => pawnArt(colorOf(p), `${p}-${t}`)));
  for (const p of seats) for (const pw of pawns[p]) pawnLayer.append(pw.g);

  const face = el("span", { class: "face" });
  const die = el("button", { class: "ld-die", id: "ld-die", type: "button", "aria-label": "Roll the die", onclick: () => rollNow() }, face);
  const rollBtn = el("button", { class: "btn primary big ld-roll", type: "button", id: "ld-roll", onclick: () => rollNow() }, "Roll");
  const timerFill = el("span");
  const timerText = el("span", { class: "ld-timer-text" });
  const timer = el("div", { class: "ld-timer mono", id: "ld-timer", hidden: true, role: "timer", "aria-label": "Time to move" }, el("span", { class: "bar" }, timerFill), timerText);
  const hint = el("p", { class: "ld-hint", id: "ld-hint" });
  const skipBtn = el("button", { class: "btn small ld-skip", type: "button", id: "ld-skip", hidden: true, onclick: () => skip() }, "Skip to the standings");
  const logList = el("ol", { class: "ld-log", id: "ld-log", "aria-label": "Recent moves" });
  const configLine = el("p", { class: "ld-config", id: "ld-config" });
  const note = el("p", { class: "ld-note", id: "ld-note" });
  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    classes: (p) => `c-${cname(p)}`,
    onShow: ({ winner, outcome }) => outcome && celebrate({ outcome, flavour: "wood", highlight: pawns[winner].map((p) => p.g), board: svg }),
  });
  const boardWrap = el("div", { class: "ld-board-wrap" }, svg);

  root.append(
    el(
      "div",
      { class: "ludo" },
      bar.node,
      status,
      el(
        "div",
        { class: "ld-main" },
        boardWrap,
        el("div", { class: "ld-side" }, el("div", { class: "ld-die-panel" }, die, el("div", { class: "ld-die-actions" }, rollBtn, timer, hint, skipBtn)), logList),
      ),
      configLine,
      note,
      result.node,
    ),
  );
  dieFace(face, 0);

  // ---------- motion ----------
  const live = (g) => g === gen && !destroyed;
  const fast = () => still() || document.hidden || hurry === 2;
  const { placePawns, wait, settle, move } = boardMotion({ pawns, pawnLayer, fx, blockLayer, blocks: () => config?.blocks, rot, colorOf, tokens: () => shown, live, fast });
  const { startTumble, stopTumble, land, tumbling } = rollingDie({ die, face, colorOf, live, fast });

  // ---------- playing events out ----------
  async function animate(ev, g) {
    const p = ev.player;
    const pace = hurry ? 0.4 : pending > 5 ? 0.35 : pending > 2 ? 0.6 : 1;
    if (ev.type === "roll") {
      current = { player: p, phase: "roll" };
      render();
      await land(ev.value, p, g, pace);
      if (p === me) rolling = false;
      if (!live(g)) return;
      if (ev.forfeit || ev.pass) {
        current = { player: p, phase: ev.forfeit ? "forfeit" : "pass", value: ev.value };
        addLog(ev);
        play("nope");
        render();
        await wait(PACE.pass * pace, g);
      }
      current = null;
      return;
    }
    // A move.
    current = { player: p, phase: "move", ev };
    render();
    const done = await move(ev, g, pace, me, (phase) => {
      current.phase = phase;
      render();
    });
    if (!done) return;
    addLog(ev);
    if (ev.done && count > 2) toast(p === me ? `You brought all four home: ${PLACE[ev.place]}!` : `${nameOf(p)} brought all four home: ${PLACE[ev.place]}`);
    if (ev.again) play("again");
    await settle(g);
    current = null;
    await wait(PACE.between * pace, g);
  }

  function enqueue(ev) {
    const g = gen;
    pending++;
    queue = queue
      .then(() => (live(g) ? animate(ev, g) : null))
      .catch((err) => console.error(err))
      .finally(() => {
        if (!live(g)) return; // a rematch started: its own queue and count took over
        pending--;
        if (!pending) {
          current = null;
          shown = match.state.tokens.map((side) => side.slice());
          placePawns();
        }
        render();
      });
  }

  // ---------- log ----------
  function describe(ev) {
    const who = nameOf(ev.player);
    const your = (p) => (p === me ? "your" : `${session.players[p].name}'s`);
    if (ev.type === "roll") {
      if (ev.forfeit) return `${who} rolled three 6s in a row: turn lost`;
      return `${who} rolled ${ev.value}: no move`;
    }
    let text = `${who} rolled ${ev.die}`;
    if (ev.enter) text += " and brought a token out";
    else if (ev.captures.length) {
      const owners = [...new Set(ev.captures.map((c) => c.player))];
      text += ev.captures.length > 1 ? ` and sent ${listOf(owners.map(your))} pair home!` : ` and sent ${your(owners[0])} token home!`;
    } else if (ev.home) text += " and reached home";
    else if (ev.to > LAST_LOOP) text += " into the home column";
    else if (ev.safe) text += " to a safe square";
    else text += ` and moved ${ev.to - ev.from}`;
    if (ev.done) text += `. All four home: ${PLACE[ev.place]}!`;
    return text;
  }

  function addLog(ev) {
    const kind = ev.type === "roll" ? "miss" : ev.captures.length ? "capture" : ev.home ? "home" : "";
    log = [{ ev, kind, text: describe(ev) }, ...log].slice(0, 5);
    logList.replaceChildren(
      ...log.map(({ ev: e, kind: kd, text }, i) =>
        el(
          "li",
          { class: `c-${cname(e.player)} ${kd} ${i ? "" : "fresh"}` },
          el("span", { class: "dot", "aria-hidden": "true" }, String(e.type === "roll" ? e.value : e.die)),
          el("span", {}, text),
        ),
      ),
    );
  }

  // ---------- whose decision it is ----------
  // The player who must act now, on this screen (after the replay catches up).
  function decision() {
    if (!match || match.phase !== "playing" || pending || ended) return null;
    const st = match.state;
    return { player: st.turn, kind: st.rolled ? "pick" : "roll" };
  }
  const myDecision = () => {
    const d = decision();
    return d && d.player === me ? d : null;
  };
  const choices = () => (myDecision()?.kind === "pick" && !match.working ? legalMoves(match.state, me) : []);

  // ---------- input ----------
  function rollNow() {
    if (!match || match.phase !== "playing") return;
    if (match.state.turn !== me) return toast(`Wait for ${nameOf(match.state.turn)}`);
    const d = myDecision();
    if (!d || d.kind !== "roll" || rolling || !match.canMove()) {
      if (d?.kind === "pick") toast("Pick a token to move");
      return;
    }
    rolling = true;
    startTumble(me);
    match.play({ type: "roll" });
    render();
  }

  function pick(t) {
    const mv = choices().find((c) => c.token === t);
    if (!mv) {
      if (myDecision()?.kind === "pick") toast(`That token can't move ${match.state.die}`);
      return;
    }
    clearTimeout(forcedTimer);
    focusToken = null;
    const refocus = hits.contains(document.activeElement);
    match.play({ type: "move", token: t });
    if (refocus) die.focus({ preventScroll: true });
  }

  wireTargets(hits, {
    pick,
    show: (t) => {
      if (restoring || t === focusToken) return;
      focusToken = t;
      renderChoices();
    },
  });
  // Keys 1–4 pick your tokens; R or Space on the board rolls.
  function onKey(e) {
    if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-4]$/.test(e.key) && myDecision()?.kind === "pick") {
      const t = Number(e.key) - 1;
      if (choices().some((c) => c.token === t)) pick(t);
      else toast(`Token ${e.key} can't move ${match.state.die}`);
    } else if ((e.key === "r" || e.key === "R") && myDecision()?.kind === "roll") rollNow();
  }
  addEventListener("keydown", onKey);

  function skip() {
    hurry = 2;
    for (const robot of window.ddp.robots || []) robot.poke?.();
    render();
  }

  // ---------- render ----------
  function statusText() {
    if (ended) return "The game has ended.";
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    if (match.phase === "starting") return config.first === "random" ? "Tossing a coin to see who rolls first…" : "Getting ready…";
    if (match.phase === "aborted") return "Match stopped.";
    if (current) {
      const mine = current.player === me;
      const who = nameOf(current.player);
      if (current.phase === "roll") return mine ? "Rolling…" : `${who} is rolling…`;
      if (current.phase === "pass") return mine ? `No move with a ${current.value}. Your turn passes.` : `${who} can't move with a ${current.value}.`;
      if (current.phase === "forfeit") return mine ? "Three 6s in a row! Your turn is lost." : `${who} rolled three 6s: turn lost.`;
      const ev = current.ev;
      if (current.phase === "capture") return mine ? "Gotcha! Back to the yard it goes." : ev.captures.some((c) => c.player === me) ? `${who} sent your token home!` : `${who} captured a token!`;
      if (ev.enter) return mine ? "Out of the yard!" : `${who} brings a token out.`;
      if (current.phase === "home") return mine ? "Home!" : `${who} brought a token home.`;
      return mine ? "Moving…" : `${who} is moving…`;
    }
    if (match.phase === "over" || pending) {
      if (pending) return status.textContent;
      const w = st.winner;
      return w === me ? "All four home. You win!" : `${nameOf(w)} won the race home.`;
    }
    const d = decision();
    if (!d) return "…";
    if (st.order.includes(me) && d.player !== me) return `You finished ${PLACE[st.order.indexOf(me) + 1]}. ${nameOf(d.player)}'s turn…`;
    if (d.player !== me) return d.kind === "pick" ? `${nameOf(d.player)} rolled ${st.die} and is choosing…` : `${nameOf(d.player)}'s turn…`;
    if (d.kind === "roll") {
      const why = st.last?.player === me && st.last.type === "move" && st.last.again ? st.last.why : null;
      if (why === "six") return "A 6! Roll again.";
      if (why === "capture") return "A capture earns another roll. Roll!";
      return "Your turn. Roll the die!";
    }
    const n = distinctMoves(st, me).length;
    return n === 1 ? `You rolled ${st.die}. Only one move: playing it for you…` : `You rolled ${st.die}. Pick a token to move.`;
  }

  function where(p) {
    const st = match.state;
    if (st.order.includes(p) && !pending) return `${PLACE[st.order.indexOf(p) + 1]} place`;
    const home = shown[p].filter((r) => r === HOME).length;
    const out = shown[p].filter((r) => r !== YARD && r !== HOME).length;
    return `${home}/4 home${out ? ` · ${out} out` : ""}`;
  }

  function boardLabel() {
    const describeSide = (p) => {
      const parts = shown[p].map((r) => (r === YARD ? "yard" : r === HOME ? "home" : r > LAST_LOOP ? `home column ${r - LAST_LOOP}` : `square ${r + 1} of 51`));
      return `${p === me ? "Your" : `${session.players[p].name}'s`} ${COLOR_NAME[cname(p)].toLowerCase()} tokens: ${parts.join(", ")}`;
    };
    return `Ludo board. ${order.map(describeSide).join(". ")}.`;
  }

  // Markers where each movable token would land, and the hovered one's path.
  let restoring = false;
  function renderChoices() {
    // Rebuilding the tap targets would drop keyboard focus: put it back after.
    const had = hits.contains(document.activeElement) ? document.activeElement.dataset.token : null;
    marks.replaceChildren();
    hits.replaceChildren();
    for (const p of seats) for (const pw of pawns[p]) pw.g.classList.remove("movable", "focus");
    const list = choices();
    if (!list.length) return;
    if (focusToken !== null && !list.some((mv) => mv.token === focusToken)) focusToken = null;
    const focus = focusToken === null ? null : list.find((mv) => mv.token === focusToken);
    drawChoices({ marks, hits, mine: pawns[me], color: colorOf(me), rot, list, focus });
    for (const mv of list) {
      const victims = listOf([...new Set(mv.captures.map((c) => session.players[c.player].name))]);
      hits.append(tokenTarget(pawns[me][mv.token], mv.token, moveLabel(mv, match.state.die, victims)));
    }
    const back = had !== null && hits.querySelector(`.hit-token[data-token="${had}"]`);
    if (back) {
      restoring = true;
      back.focus({ preventScroll: true });
      restoring = false;
    }
  }

  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    timer.hidden = !secs || !d;
    if (timer.hidden) return;
    const key = `${m}:${match.state.ply}:${d.kind}`;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    timerFill.style.width = `${Math.max(0, Math.min(1, left / (secs * 1000))) * 100}%`;
    timer.dataset.color = cname(d.player);
    timer.classList.toggle("low", left < 4000);
    timerText.textContent = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
    if (d.player === me && left <= 3000 && left > 0) {
      const sec = Math.ceil(left / 1000);
      if (sec !== lastTick) {
        lastTick = sec;
        play("tick");
      }
    }
  }

  // Your time ran out: the game moves for you (a stalled player would hold up everyone).
  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !config?.moveSeconds) return;
    renderTimer();
    const d = decision();
    if (!d) return;
    const left = deadline - performance.now();
    if (d.player === me && left <= 0 && autoKey !== deadlineKey && match.canMove() && !rolling) {
      autoKey = deadlineKey;
      if (d.kind === "roll") {
        toast("Time's up: rolling for you");
        rollNow();
      } else {
        toast("Time's up: moved for you");
        pick(chooseMove(match.state, me, Math.random, { level: "medium" }).token);
      }
    } else if (d.player !== me && left <= -CLAIM_GRACE_MS) {
      status.textContent = `Waiting for ${nameOf(d.player)}'s browser…`;
    }
  }
  const ticker = setInterval(tick, 200);

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = ended ? "ended" : match?.phase || "setup";
    shell.setInProgress(phase !== "ended" && phase !== "over" && phase !== "aborted");
    root.querySelector(".ludo").dataset.phase = phase;
    const d = decision();
    bar.update({ turn: phase !== "playing" ? -1 : current ? current.player : st.turn, thinking: current ? -1 : undefined, score });
    for (const p of seats) {
      wheres[p].classList.toggle("done", !!st?.order.includes(p));
      wheres[p].textContent = st ? where(p) : "";
    }
    status.textContent = statusText();
    status.dataset.color = current ? cname(current.player) : d ? cname(d.player) : "";
    const mine = myDecision();
    status.classList.toggle("mine", !!mine || current?.player === me);
    const canRoll = mine?.kind === "roll" && match.canMove() && !rolling;
    rollBtn.disabled = die.disabled = !canRoll;
    rollBtn.classList.toggle("attention", canRoll);
    die.classList.toggle("armed", canRoll);
    if (!tumbling() && !current && d) die.dataset.color = cname(d.player);
    rollBtn.textContent = rolling ? "Rolling…" : "Roll";
    hint.textContent = mine?.kind === "pick" ? "Tap a glowing token, or where it lands." : !st || phase !== "playing" ? "" : d && d.player !== me ? `${nameOf(d.player)}'s turn` : "";
    skipBtn.hidden = !(robotGame && phase === "playing" && st?.order.includes(me) && hurry !== 2);
    if (phase !== "playing") hurry = 0;
    else if (robotGame && !hurry && st.order.includes(me)) hurry = 1;
    renderChoices();
    renderTimer();
    svg.setAttribute("aria-label", shown.length ? boardLabel() : "Ludo board");
    renderOver();
    setTabAlert(mine ? "Your turn" : null);
    // A new decision of yours: a chime for a new turn, a move played for you if there's only one.
    if (mine && cuedPly !== st.ply) {
      cuedPly = st.ply;
      if (mine.kind === "roll" && st.last && st.last.player !== me) play("turn");
      if (mine.kind === "pick" && hits.contains(document.activeElement) === false && (document.activeElement === die || document.activeElement === rollBtn)) {
        hits.querySelector(".hit-token")?.focus({ preventScroll: true });
      }
    }
    if (mine?.kind === "pick" && forcedPly !== st.ply && distinctMoves(st, me).length === 1) {
      forcedPly = st.ply;
      const ply = st.ply;
      const g = gen;
      clearTimeout(forcedTimer);
      forcedTimer = setTimeout(() => {
        if (live(g) && match.state.ply === ply && myDecision()?.kind === "pick") pick(choices()[0].token);
      }, fast() ? 0 : FORCED_DELAY);
    }
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the last token finish its trip first.
    if (ended || (phase !== "over" && phase !== "aborted") || (phase === "over" && pending)) return result.hide();
    if (phase === "aborted") return result.show({ stopped: true, reason: match.abortReason || "The match was stopped." });
    const st = match.state;
    const w = st.winner;
    const places = st.order.map((p) => {
      const home = st.tokens[p].filter((r) => r === HOME).length;
      return { seat: p, note: home === TOKENS ? `${plural(st.rolls[p], "roll")} · ${plural(st.captures[p], "capture")}` : `${home}/4 home` };
    });
    const reason = `${w === me ? "You" : nameOf(w)} brought all four home in ${plural(st.rolls[w], "roll")}, with ${plural(st.captures[w], "capture")}.`;
    result.show({ winner: w, reason, places });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    gen += 1;
    clearTimeout(forcedTimer);
    stopTumble();
    shown = seats.map(() => Array(TOKENS).fill(YARD));
    pending = 0;
    queue = Promise.resolve();
    current = null;
    log = [];
    cuedPly = -1;
    forcedPly = -1;
    rolling = false;
    focusToken = null;
    deadlineKey = "";
    autoKey = "";
    if (hurry === 2 || hurry === 1) hurry = 0;
    logList.replaceChildren();
    fx.replaceChildren();
    dieFace(face, 0);
    die.classList.remove("landed", "six");
    placePawns();
    const rivals = listOf(order.slice(1).map(nameOf));
    note.textContent = m === 1 ? `Playing against ${rivals}. Good luck!` : `Rematch #${m - 1}. Everyone back to the yard.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => {
      rolling = false;
      stopTumble();
      toast(reason);
    });
    match.on("start", () => {
      const first = match.state.first;
      const who = first === me ? "you roll first" : `${nameOf(first)} rolls first`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.first === "random" ? `Coin toss (drawn by ${count === 2 ? "both" : "all"} browsers): ${who}.` : `Room setting: ${who}.`);
      toast(first === me ? "You roll first" : `${nameOf(first)} rolls first`);
    });
    match.on("events", ({ events }) => {
      for (const ev of events) enqueue(ev);
    });
    match.on("over", ({ winner }) => score.wins[winner]++);
    router.start(match);
    render();
  }

  function describeConfig(c) {
    const parts = [c.threeSixes ? "three 6s lose the turn" : "6s keep rolling", c.blocks ? "blocks on" : "no blocks", c.captureBonus ? "a capture rolls again" : "no capture bonus"];
    if (count > 2) parts.push(c.places ? "play for places" : "first home wins");
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s to move`);
    // Robot games, and friend rooms whose host seated robots (they play at the host's level).
    const robotSeats = robotGame ? count - 1 : session.players.filter((p) => p.robot).length;
    if (robotSeats) parts.push(`${LEVEL_NAME[c.level]} ${robotSeats > 1 ? "robots" : "robot"}`);
    return parts.join(" · ");
  }

  // The room's settings come from whoever created it (robots use ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = describeConfig(config);
    newMatch();
  }
  function onSetup(msg) {
    if (me !== 0) begin(msg.config);
  }

  // A player left: the engine ends the game for everyone; say so plainly, with the standings so far.
  function onEnd(reason, seat) {
    if (reason === "self") return;
    ended = true;
    gen++;
    clearTimeout(forcedTimer);
    stopTumble();
    render();
    queueMicrotask(() => {
      const card = root.querySelector("#ended .card");
      if (!card || !match?.state || count < 3) return;
      const st = match.state;
      const name = (p) => (p === me ? "You" : session.players[p].name);
      const home = (p) => st.tokens[p].filter((r) => r === HOME).length;
      const placeOf = (p) => (st.order.includes(p) ? st.order.indexOf(p) : 4 + (TOKENS * 57 - st.tokens[p].reduce((sum, r) => sum + r + 1, 0)) / 1000);
      const rank = [...seats].sort((a, b) => placeOf(a) - placeOf(b));
      const over = match.phase === "over";
      card.querySelector(".notice")?.after(
        el(
          "div",
          { class: "ld-ended", id: "ld-ended" },
          el(
            "p",
            {},
            over
              ? `With ${session.players[seat].name} gone, there's no rematch for this table. Final standings:`
              : `Every move goes through ${session.players[seat].name}'s browser, so the game is over for all ${count} of you. Where everyone stood:`,
          ),
          el(
            "ul",
            {},
            rank.map((p) =>
              el(
                "li",
                { class: `c-${cname(p)} ${p === seat ? "gone" : ""}` },
                el("span", { class: "swatch", "aria-hidden": "true" }, markSvg(colorOf(p), 10)),
                `${name(p)}: ${st.order.includes(p) ? `finished ${PLACE[st.order.indexOf(p) + 1]}` : `${home(p)}/4 home`}${p === seat ? " (left)" : ""}`,
              ),
            ),
          ),
        ),
      );
    });
  }

  screenBusy = () => pending > 0 || !!current;
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const onMotion = () => render();
  reduced.addEventListener?.("change", onMotion);
  const offs = [
    offMsg,
    session.on("end", onEnd),
    session.on("rematch-start", () => config && newMatch()),
  ];
  shown = seats.map(() => Array(TOKENS).fill(YARD));
  placePawns();
  if (robotGame) begin(settings.get());
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      gen++;
      hurry = 0;
      screenBusy = () => false;
      clearInterval(ticker);
      clearTimeout(forcedTimer);
      stopTumble();
      setTabAlert(null);
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      reduced.removeEventListener?.("change", onMotion);
      for (const off of offs) off();
    },
  };
}
