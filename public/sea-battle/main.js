// Sea Battle page: mounts the engine shell and renders a match.
// All game logic lives in rules.js / match.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { SeaBattleMatch } from "./match.js";
import { matchRouter } from "../engine/session.js";
import { startRobot } from "./robot.js";
import * as R from "./rules.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { createBoard, shipEl, shipFromCells, paintCells, fleetLeft, ownShipEl, shipKey, turnings, dragShip, launch, land, follow } from "./art.js";
import { howToPlay } from "./how-to-play.js";

const WEAPON_ICON = {
  shot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  big: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 5.3L20 6l-3.5 4.6L21 14l-5.6.6L14 21l-2-5-2 5-1.4-6.4L3 14l4.5-3.4L4 6l5.8 1.3z"/></svg>',
  rain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v6M12 6v6M18 3v6M9 12v6M15 14v6M4 15v4M20 13v4"/></svg>',
  nuke: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 7.8 4.5L14.2 10.8M4.2 7.5A9 9 0 0 1 12 3M9.8 10.8 4.2 7.5M8 19.8l2.9-5.6M16 19.8l-2.9-5.6M8 19.8a9 9 0 0 0 8 0"/></svg>',
  carpet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 5h20M5 8.5v2M10 8.5v2M15 8.5v2M20 8.5v2"/><circle cx="5" cy="15" r="2"/><circle cx="10" cy="15" r="2"/><circle cx="15" cy="15" r="2"/><circle cx="20" cy="15" r="2"/><path d="M3 20h18"/></svg>',
};

// The robot "thinks" this long (plus up to half again) before each shot.
const AI_DELAY = 1400;
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their shot

startGameShell({
  slug: "sea-battle",
  title: "Sea Battle",
  howToPlay,
  tutorial: () => import("./tutorial.js"),
  layout: "wide",
  settings,
  createRobot: (session) => startRobot(session, { delay: AI_DELAY, config: settings.get("robot") }),
  // A seat's score: the ships it has sunk.
  banter: { score: (st, p) => st.boards[R.other(p)].sunk.length, lines: { strongMove: ["Direct hit!"], lead: ["Splash!"] } },
  onSession: (session, root, shell) => mountSeaBattle(session, root, shell),
});

const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function describeConfig(c) {
  const shot = c.shotSeconds ? `${c.shotSeconds} s a shot` : "no shot limit";
  const game = c.gameSeconds ? `${c.gameSeconds / 60} min each` : "no game clock";
  return `${shot} · ${game}`;
}

function shipName(len, sunkCountOfLen) {
  if (len === 3) return sunkCountOfLen > 1 ? "second Cruiser" : "Cruiser";
  return R.SHIP_NAMES[len];
}

function mountSeaBattle(session, root, shell) {
  const me = session.index;
  const opp = R.other(me);
  const oppName = session.opponent.name;
  const offs = [];
  // One session handler: "setup" (the room's settings) is for this view,
  // everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  offs.push(session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg))));
  let config = null;
  let match = null;
  let m = 0;
  let fleet = null;
  let weapon = "shot";
  let carpetDir = "row"; // the carpet bomb's aim: a "row" or a "col"
  let aimAt = -1; // the enemy square under the pointer, for re-aiming
  const volleyDir = [null, null]; // per board: the carpet direction of the volley in flight
  let destroyed = false;
  let lastAgain = false;
  let selectedShip = -1;
  let dragging = false;
  const score = { wins: [0, 0] }; // across rematches
  let lastShots = [new Set(), new Set()]; // board -> squares of the latest volley at it
  let lastTurnSeen = -1;
  const landsAt = [0, 0]; // per board: when the shell in flight lands (ms)
  let turnStart = 0; // when the current shot began (once the last volley landed)
  let lastTick = -1;
  let timedOut = false; // my time ran out: the random shot or forfeit is on its way
  let claimed = false;

  // ---------- layout ----------
  const status = el("p", { class: "sb-status", id: "sb-status", role: "status", "aria-live": "polite" });
  const bar = playerBar(session, { onLeave: () => shell.leave() });
  const clock = el("span", { class: "sb-clock mono", id: "sb-clock", role: "timer", hidden: true, "aria-live": "off" });
  const myClock = el("span", { class: "game-clock mine mono", id: "clock-me", role: "timer", "aria-label": "Your clock", hidden: true });
  const oppClock = el("span", { class: "game-clock mono", id: "clock-opp", role: "timer", "aria-label": `${oppName}'s clock`, hidden: true });
  const configLine = el("p", { class: "sb-config", id: "sb-config" });

  const ownBoard = createBoard("Your fleet", false);
  const enemyBoard = createBoard(`${oppName}'s waters`, true);
  ownBoard.wrap.classList.add("own");
  enemyBoard.wrap.classList.add("enemy");

  const shuffleBtn = el("button", { class: "btn", type: "button", id: "shuffle", onclick: shuffle }, "Shuffle");
  const rotateBtn = el("button", { class: "btn", type: "button", id: "rotate", onclick: () => rotateShip(selectedShip) }, "Rotate");
  const readyBtn = el("button", { class: "btn primary", type: "button", id: "ready", onclick: onReady }, "Ready");
  const placeBar = el(
    "div",
    { class: "sb-place" },
    el("p", { class: "hint" }, "Drag ships to move them; press R while dragging to rotate. Or tap a ship to rotate it. Ships can't touch side by side."),
    el("div", { class: "sb-actions" }, shuffleBtn, rotateBtn, readyBtn),
  );
  const weaponsBar = el("div", { class: "sb-weapons", role: "toolbar", "aria-label": "Weapons" });
  const log = el("ol", { class: "sb-log", id: "sb-log", "aria-label": "Battle log" });
  const result = resultPanel(session, { onLeave: () => shell.leave(), onShow: celebrateOnLanding });

  root.append(
    el(
      "div",
      { class: "sea-battle" },
      bar.node,
      el("div", { class: "sb-statusrow" }, status),
      el("div", { class: "sb-clocks" }, myClock, clock, oppClock),
      configLine,
      placeBar,
      el("div", { class: "sb-boards" }, enemyBoard.wrap, ownBoard.wrap),
      weaponsBar,
      log,
      result.node,
    ),
  );

  // ---------- render ----------
  function render() {
    if (destroyed) return;
    if (!match) {
      status.textContent = "Getting the room's settings…";
      return;
    }
    const phase = match.phase;
    shell.setInProgress(phase !== "over" && phase !== "aborted");
    const st = match.state;
    const placing = phase === "placing";
    root.querySelector(".sea-battle").dataset.phase = phase;
    // Coral is whoever shoots first this match, on every screen.
    root.querySelector(".sea-battle").dataset.you = st ? (st.first === me ? "a" : "b") : "";

    bar.update({ turn: st && phase === "playing" ? st.turn : -1, score });

    // Status line
    let text = "";
    if (phase === "placing") {
      if (!match.locked) text = match.peer ? `${oppName} is ready. Place your fleet and press Ready.` : "Place your fleet, then press Ready.";
      else if (!match.peer) text = `Waiting for ${oppName} to place their ships…`;
      else text = "Tossing a coin to see who starts…";
    } else if (phase === "playing") {
      if (st.turn === me) {
        text = match.pending ? "Firing…" : lastAgain ? "Hit! Fire again." : "Your turn: fire at the enemy waters.";
      }
      else text = `${oppName} is aiming…`;
    } else if (phase === "over") {
      if (st.reason === "timeout") text = st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
      else text = st.winner === me ? "You won! The enemy fleet is sunk." : `${oppName} won this round.`;
    } else if (phase === "aborted") {
      text = "Match stopped.";
    }
    status.textContent = text;
    status.className = `sb-status ${phase === "playing" && st.turn === me ? "mine" : ""}`;

    // Placement controls
    placeBar.hidden = !placing;
    readyBtn.disabled = match.locked;
    shuffleBtn.disabled = match.locked;
    rotateBtn.disabled = match.locked || selectedShip < 0;
    readyBtn.textContent = match.locked ? "Ready ✓" : "Ready";
    enemyBoard.wrap.hidden = placing;

    // Own board: ships + incoming fire (left alone while a ship is being dragged)
    if (!dragging) ownBoard.shipsLayer.replaceChildren(
      ...fleet.map((ship, k) => {
        const draggable = placing && !match.locked;
        const node = ownShipEl(ship, k, { selected: k === selectedShip && placing, draggable, board: st?.boards[me] });
        if (draggable) {
          node.addEventListener("pointerdown", (e) => startDrag(e, k));
          node.addEventListener("keydown", (e) => keyMove(e, k));
        }
        return node;
      }),
    );
    paintCells(ownBoard, st && st.boards[me], lastShots[me]);
    ownBoard.wrap.classList.toggle("placing", placing);

    // Enemy board: sunk ships, revealed fleet at the end, our fire
    if (st) {
      const board = st.boards[opp];
      const shipNodes = board.sunk.map((s) => shipEl(shipFromCells(s.cells), "sunk"));
      if (phase === "over" && match.peerFleet && match.verdict?.ok) {
        const sunkKeys = new Set(board.sunk.map((s) => s.cells.join()));
        for (const ship of match.peerFleet) {
          if (!sunkKeys.has(R.shipCells(ship).sort((a, b) => a - b).join())) shipNodes.push(shipEl(ship, "revealed"));
        }
      }
      enemyBoard.shipsLayer.replaceChildren(...shipNodes);
      paintCells(enemyBoard, board, lastShots[opp], true);
      fleetLeft(enemyBoard, board);
      fleetLeft(ownBoard, st.boards[me]);
    } else {
      fleetLeft(ownBoard, null);
    }
    const myTurn = match.canFire();
    enemyBoard.wrap.classList.toggle("armed", myTurn);
    enemyBoard.cellsLayer.classList.toggle("rain", myTurn && weapon === "rain");
    setTabAlert(phase === "playing" && st.turn === me ? "Your turn" : null);
    if (phase === "playing" && st.turn !== lastTurnSeen) {
      lastTurnSeen = st.turn;
      if (st.turn === me) {
        play("turn");
        follow(enemyBoard);
      }
    }
    renderClocks();

    renderWeapons();
    renderOver();
  }

  // ---------- clocks ----------
  // Each browser times only its own player: a shot carries the time spent,
  // measured from when the previous volley landed here.
  const elapsed = () => Math.max(0, performance.now() - turnStart);
  // Against the robot only your clock runs (it reports no time).
  const timesPlayer = (player) => player === me || session.mode === "friend";
  const spent = () => (R.isTimed(match.state) ? Math.min(Math.round(elapsed()), R.timeLeft(match.state, me)) : undefined);

  function newShot() {
    turnStart = Math.max(performance.now(), ...landsAt);
    lastTick = -1;
    timedOut = false;
  }

  function renderClocks() {
    const st = match?.state;
    const playing = match?.phase === "playing";
    for (const [player, node] of [[me, myClock], [opp, oppClock]]) {
      const show = !!st?.clocks && timesPlayer(player);
      node.hidden = !show;
      if (!show) continue;
      const running = playing && st.turn === player;
      const ms = st.clocks[player] - (running ? elapsed() : 0);
      node.replaceChildren(el("span", { class: "name" }, player === me ? "You" : oppName), ` ${clockText(ms)}`);
      node.classList.toggle("active", running);
      node.classList.toggle("low", ms < 30_000);
    }
    const active = playing && st.shotMs && timesPlayer(st.turn) ? st.turn : -1;
    clock.hidden = active === -1;
    if (active === -1) return;
    const left = Math.max(0, Math.ceil((R.timeLeft(st, active) - elapsed()) / 1000));
    clock.replaceChildren(el("span", { class: "name" }, active === me ? "Your shot" : oppName), `: ${left}s`);
    clock.classList.toggle("mine", active === me);
    clock.classList.toggle("low", left <= 10);
  }

  function tick() {
    if (destroyed || match?.phase !== "playing" || !R.isTimed(match.state)) return;
    renderClocks();
    const st = match.state;
    const left = R.timeLeft(st, st.turn) - elapsed();
    if (st.turn === me) {
      if (!match.canFire() || timedOut) return;
      const secs = Math.ceil(left / 1000);
      if (secs <= 5 && secs > 0 && secs !== lastTick) {
        lastTick = secs;
        play("tick");
      }
      if (left > 0) return;
      timedOut = true;
      if (st.clocks && st.clocks[me] - elapsed() <= 0) return void match.timeout();
      const free = R.unexplored(st.boards[opp]);
      toast("Time's up! A random shot was fired for you.");
      match.fire("shot", free[Math.floor(Math.random() * free.length)], R.timeLeft(st, me));
    } else if (session.mode === "friend" && left <= -CLAIM_GRACE_MS && !claimed) {
      // Their browser should have fired or forfeited by now (closed laptop, frozen tab).
      claimed = true;
      match.send({ t: "abort", reason: "your time ran out" });
      match.abort(`${oppName}'s time ran out and their browser stopped answering.`);
    }
  }
  const ticker = setInterval(tick, 200);

  function renderWeapons() {
    const st = match.state;
    if (!st || match.phase !== "playing") {
      weaponsBar.hidden = true;
      return;
    }
    weaponsBar.hidden = false;
    const inv = st.inventory[me];
    if (weapon !== "shot" && !(inv[weapon] > 0)) weapon = "shot";
    const myTurn = match.canFire();
    weaponsBar.replaceChildren(
      ...Object.keys(R.WEAPONS).map((w) => {
        const count = w === "shot" ? "∞" : inv[w];
        const owned = w === "shot" || inv[w] > 0;
        const btn = el(
          "button",
          {
            type: "button",
            class: `weapon ${weapon === w ? "selected" : ""} ${owned ? "" : "empty"}`,
            dataset: { w },
            disabled: !owned || !myTurn,
            "aria-pressed": weapon === w ? "true" : "false",
            title: `${R.WEAPONS[w].label}: ${R.WEAPONS[w].help}`,
            onclick: () => {
              weapon = w;
              render();
            },
          },
          el("span", { class: "w-icon" }),
          el("span", { class: "w-label" }, R.WEAPONS[w].label),
          el("span", { class: "w-count" }, String(count)),
        );
        btn.querySelector(".w-icon").innerHTML = WEAPON_ICON[w];
        return btn;
      }),
    );
    if (weapon === "rain" && myTurn) {
      weaponsBar.append(
        el("button", { class: "btn primary launch", type: "button", id: "launch-rain", title: R.WEAPONS.rain.help, onclick: () => match.fire("rain", undefined, spent()) }, "Launch rain"),
      );
    }
    if (weapon === "carpet" && myTurn) {
      weaponsBar.append(
        el("button", { class: "btn launch", type: "button", id: "carpet-dir", title: "Switch between a row and a column (R)", onclick: turnCarpet }, carpetDir === "row" ? "↔ Row" : "↕ Column"),
      );
    }
  }

  function turnCarpet() {
    carpetDir = carpetDir === "row" ? "col" : "row";
    if (aimAt >= 0) showAim(aimAt);
    renderWeapons();
  }
  // R switches the carpet bomb between a row and a column while it's selected.
  const onCarpetKey = (e) => {
    if ((e.key !== "r" && e.key !== "R") || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea")) return;
    if (weapon !== "carpet" || !match?.canFire()) return;
    e.preventDefault();
    turnCarpet();
  };
  addEventListener("keydown", onCarpetKey);
  offs.push(() => removeEventListener("keydown", onCarpetKey));

  function renderOver() {
    const phase = match.phase;
    if (phase !== "over" && phase !== "aborted") return result.hide();
    if (phase === "aborted") return result.show({ stopped: true, reason: match.abortReason || "The match was stopped." });
    const { winner, reason } = match.state;
    const won = winner === me;
    let verdict;
    if (!match.verdict) verdict = el("p", { class: "verdict" }, el("span", { class: "spinner" }), `Checking ${oppName}'s fleet against their locked-in commitment…`);
    else if (match.verdict.ok) verdict = el("p", { class: "verdict ok", id: "verdict" }, `✓ Fair play verified: every answer from ${oppName} matched the fleet they locked in.`);
    else verdict = el("p", { class: "verdict bad", id: "verdict" }, `⚠ ${oppName}'s answers don't add up: ${match.verdict.reason}.`);
    let why;
    if (reason === "timeout") why = won ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else why = won ? `You sank ${oppName}'s whole fleet.` : `${oppName} sank your whole fleet.`;
    result.show({ winner, reason: why, extra: verdict });
  }

  // The result shows at once; its moment waits for the last shell to land.
  function celebrateOnLanding({ winner, outcome }) {
    if (!outcome) return;
    const current = match;
    const wait = Math.max(0, ...landsAt.map((t) => t - performance.now()));
    setTimeout(() => {
      if (destroyed || match !== current) return;
      const { reason, boards } = match.state;
      const loser = 1 - winner;
      const view = loser === me ? ownBoard : enemyBoard;
      const highlight = reason === "timeout" ? [] : boards[loser].sunk.at(-1).cells.map((i) => view.cells[i]);
      celebrate({ outcome, flavour: "water", highlight, board: enemyBoard.wrap.parentElement });
    }, wait + 600);
  }

  function addLog(text, cls = "") {
    log.prepend(el("li", { class: cls }, text));
    while (log.children.length > 8) log.lastChild.remove();
  }

  // ---------- placement ----------
  function shuffle() {
    if (match.locked) return;
    fleet = R.randomFleet(Math.random);
    selectedShip = -1;
    match.setFleet(fleet);
    render();
  }

  function tryMove(k, candidate) {
    if (match.locked) return false;
    const others = fleet.filter((_, j) => j !== k);
    if (!R.canPlace(others, candidate)) return false;
    fleet = fleet.map((s, j) => (j === k ? candidate : s));
    match.setFleet(fleet);
    return true;
  }

  function rotateShip(k) {
    if (k < 0 || match.locked) return;
    if (!turnings(fleet[k]).some((t) => tryMove(k, t))) toast("No room to rotate this ship here");
    render();
  }

  function keyMove(e, k) {
    if (match.locked || dragging) return;
    const act = shipKey(e.key);
    if (!act) return;
    e.preventDefault();
    if (act === "turn") rotateShip(k);
    else tryMove(k, { ...fleet[k], r: fleet[k].r + act[0], c: fleet[k].c + act[1] });
    selectedShip = k;
    render();
    ownBoard.shipsLayer.querySelector(`[data-k="${k}"]`)?.focus();
  }

  function startDrag(e, k) {
    if (match.locked || e.button > 0) return;
    dragging = true;
    dragShip(e, ownBoard, fleet, k, (candidate, moved) => {
      dragging = false;
      if (match.locked) return render(); // Ready was pressed mid-drag: snap back
      if (!moved) {
        if (selectedShip === k) rotateShip(k);
        selectedShip = k;
      } else if (!tryMove(k, candidate)) {
        toast("Ships can't overlap or touch side by side");
      } else {
        selectedShip = k;
      }
      render();
    });
  }

  function onReady() {
    match.ready();
    if (match.locked) fleet = match.fleet; // show exactly the fleet that was locked in
    selectedShip = -1;
    render();
  }

  // ---------- firing ----------
  function clearAim() {
    for (const c of enemyBoard.cells) c.classList.remove("aim");
  }
  function showAim(i) {
    clearAim();
    aimAt = i;
    if (!match?.canFire() || weapon === "rain") return;
    const board = match.state.boards[opp];
    const cells = weapon === "shot" ? (board.cells[i] === R.UNKNOWN ? [i] : []) : R.aimedCells(board, weapon, i, carpetDir);
    for (const c of cells) enemyBoard.cells[c].classList.add("aim");
  }
  enemyBoard.cellsLayer.addEventListener("pointerover", (e) => {
    const cell = e.target.closest(".cell");
    if (cell) showAim(Number(cell.dataset.i));
  });
  enemyBoard.cellsLayer.addEventListener("focusin", (e) => {
    const cell = e.target.closest(".cell");
    if (cell) showAim(Number(cell.dataset.i));
  });
  enemyBoard.cellsLayer.addEventListener("pointerleave", () => {
    aimAt = -1;
    clearAim();
  });
  enemyBoard.cellsLayer.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || !match?.canFire()) return;
    const i = Number(cell.dataset.i);
    const board = match.state.boards[opp];
    // Rain isn't aimed, so a tap on a square (say, a gift) must not launch it.
    if (weapon === "rain") return toast("Missile rain falls on 7 random squares. Press Launch rain.");
    if (weapon === "shot" && board.cells[i] !== R.UNKNOWN) return toast("Already explored. Pick another square.");
    if (weapon !== "shot" && R.aimedCells(board, weapon, i, carpetDir).length === 0) return toast("Nothing left to hit there.");
    clearAim();
    match.fire(weapon, i, spent(), weapon === "carpet" ? carpetDir : undefined);
  });

  // ---------- match lifecycle ----------
  function describe(shooter, weaponUsed, events) {
    const mine = shooter === me;
    const who = mine ? "You" : oppName;
    const hits = events.filter((e) => e.type === "hit").length;
    const misses = events.filter((e) => e.type === "miss").length;
    const w = weaponUsed === "shot" ? "" : ` (${R.WEAPONS[weaponUsed].label})`;
    let line;
    if (hits + misses === 1) line = `${who} fired at ${R.cellName(events.find((e) => e.type === "hit" || e.type === "miss").cell)}${w}: ${hits ? "hit!" : "miss."}`;
    else line = `${who} fired${w}: ${hits} hit${hits === 1 ? "" : "s"}, ${misses} miss${misses === 1 ? "" : "es"}.`;
    addLog(line, mine ? "mine" : "theirs");
    for (const e of events) {
      if (e.type === "sunk") {
        const board = match.state.boards[mine ? opp : me];
        const same = board.sunk.filter((s) => s.len === e.ship.len).length;
        const name = shipName(e.ship.len, same);
        const text = mine ? `You sank ${oppName}'s ${name}!` : `${oppName} sank your ${name}.`;
        addLog(text, "big");
        toast(text);
      } else if (e.type === "gift" && mine) {
        const text = `Gift! You got a ${R.WEAPONS[e.gift].label}.`;
        addLog(text, "gift");
        toast(text);
      } else if (e.type === "gift-lost" && mine) {
        const text = "Your blast destroyed a mystery gift. Aim at a gift's own square to win it.";
        addLog(text, "gift");
        toast(text);
      }
    }
  }

  function newMatch() {
    m += 1;
    fleet = R.randomFleet(Math.random);
    weapon = "shot";
    lastAgain = false;
    selectedShip = -1;
    lastShots = [new Set(), new Set()];
    lastTurnSeen = -1;
    timedOut = false;
    claimed = false;
    match = new SeaBattleMatch({ send: (msg) => session.send(msg), me, fleet, m, config });
    window.ddp.match = match; // for debugging and browser tests
    match.on("update", render);
    match.on("peer-ready", () => toast(`${oppName} is ready`));
    match.on("start", ({ first }) => {
      newShot();
      addLog(`Coin toss (drawn by both browsers): ${first === me ? "you start" : `${oppName} starts`}.`);
      toast(first === me ? "You go first!" : `${oppName} goes first`);
    });
    match.on("fired", ({ by, weapon: w, dir, cells }) => {
      const target = by === me ? enemyBoard : ownBoard;
      if (by === opp) follow(ownBoard);
      landsAt[R.other(by)] = performance.now() + launch(target, w, dir, cells) * 1000;
      volleyDir[R.other(by)] = dir;
    });
    match.on("events", ({ shooter, weapon: w, events }) => {
      const board = R.other(shooter);
      lastShots[board] = new Set(events.filter((e) => e.type === "hit" || e.type === "miss").map((e) => e.cell));
      lastAgain = shooter === me && events.some((e) => e.type === "again");
      const wait = Math.max(0, landsAt[board] - performance.now());
      newShot(); // the next shot's time starts once this volley has landed
      const current = match;
      setTimeout(() => {
        if (destroyed || match !== current) return; // a rematch started meanwhile
        land(board === me ? ownBoard : enemyBoard, w, volleyDir[board], events, me);
        describe(shooter, w, events);
      }, wait);
    });
    match.on("gifts", (spawned) => {
      if (spawned.some((g) => g.board === opp)) addLog(`A mystery gift popped up in ${oppName}'s waters. Hit it to win a weapon!`, "gift");
    });
    match.on("over", ({ winner, reason }) => {
      score.wins[winner] += 1;
      const wait = Math.max(0, ...landsAt.map((t) => t - performance.now()));
      const current = match;
      setTimeout(() => {
        if (destroyed || match !== current) return;
        if (reason === "timeout") addLog(winner === me ? `${oppName}'s clock ran out. You win!` : "Your clock ran out.", "big");
        else addLog(winner === me ? "You sank the whole fleet!" : `${oppName} sank your whole fleet.`, "big");
      }, wait + 600);
    });
    match.on("verified", () => render());
    match.on("abort", ({ reason }) => {
      match.abortReason = reason;
      addLog(reason, "bad");
    });
    match.on("invalid", (reason) => toast(reason));
    log.replaceChildren();
    addLog(m === 1 ? `Match against ${oppName}. Good luck!` : `Rematch #${m - 1}. Fresh fleets, new coin toss.`);
    router.start(match);
    render();
  }

  offs.push(session.on("rematch-start", () => config && newMatch()));
  // The room's settings come from whoever created it (the robot uses ours).
  function begin(c) {
    if (config) return;
    config = R.normalizeConfig(c);
    configLine.textContent = describeConfig(config);
    newMatch();
  }
  function onSetup(msg) {
    if (me === 1) begin(msg.config);
  }
  if (session.mode === "robot") begin(settings.get("robot"));
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      clearInterval(ticker);
      setTabAlert(null);
      for (const off of offs) off();
    },
  };
}
