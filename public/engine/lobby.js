// Game page shell: lobby (play with friends / play vs robot), invite link,
// waiting room, and hand-off of a Session to the game. How players get
// connected lives in room.js; this file is only the UI around it.
//
//   startGameShell({ slug, title, tagline, createRobot, onSession, minPlayers, maxPlayers, robots, layout, settings, howToPlay, tutorial, banter })
//
// onSession(session, root, shell) mounts the game in `root` and returns { destroy }.
// shell.leave() goes back to the lobby; while the game says a friend match is
// on (shell.setInProgress(true)), it asks first. The browser's Back does the same,
// and closing or reloading the tab gets the browser's own prompt.
// createRobot(session) drives one robot seat over an in-memory group. With
// more than two seats, friend rooms use it too: the host can fill empty seats
// with robots, and a robot takes over the seat of a guest who leaves
// (session.resume: the match it joins mid-game).
// maxPlayers must match the game's entry in games.json (the server enforces it).
// A game that seats more than two lets the player pick how many sit at a robot
// game's table, from max(2, minPlayers) to maxPlayers, just above "Play vs
// robot", which names the robots; settings keeps the choice (settings.js).
// Otherwise a robot game is full.
// robots, optional, overrides how many robot seats there are (a number, or a
// function read when a robot game starts); older games passed it.
// The lobby tagline is the game's description in games.json; `tagline`
// overrides it (older games passed their own).
// layout is the page column while the game is on show: "narrow", "medium" or
// "wide" (the default); the lobby is always narrow. Sizes live in theme.css.
// settings is the game's gameSettings() (settings.js): the home screen shows
// them inside the lobby card and the host's waiting screen their summary; the
// settings panel shows them again in its "This game" tab, locked during a game.
// howToPlay is the game's "How to play" text (how-to-play.js), shown under the
// game and linked from the lobby card.
// tutorial loads the game's tutorial.js (() => import("./tutorial.js")): a
// Learn button in the lobby, a link at the top of "How to play" and
// /<slug>/?learn open it (see tutorial.js).
// banter is optional: how robots react during a game ({ score, strong, lines },
// see robotBanter() in reactions.js). Without it robots say "Good game!" at the end.
import { initShell, el, $, toast, copyText, getNickname, setNickname, nicknameField, setTabAlert, askBeforeLeaving } from "./shell.js";
import { confirmDialog } from "./confirm.js";
import { HostRoom, GuestRoom, RoomError, localRoom } from "./room.js";
import { howToPlayPanel } from "./how-to-play.js";
import { robotBanter, setGameLines } from "./reactions.js";
import { robotRecord, resetRobotRecord } from "./robot-record.js";
import { isApp, share } from "./native.js";

const ERRORS = {
  no_such_room: "That room doesn't exist any more. Ask your friend for a fresh invite link.",
  room_full: "That room is already full.",
  room_busy: "Too many people are asking to join that room right now. Ask your friend for the invite link.",
  declined: "The room's host didn't let you in. If they're your friend, ask them for the invite link.",
  no_answer: "Nobody let you in within a minute. Ask your friend for the invite link, or try the code again.",
  rate_limited: "Too many wrong room codes. Wait a minute, or ask your friend for the invite link.",
  bad_game: "This game isn't available right now.",
  server_full: "The lobby is full right now. Please try again in a minute.",
  too_many_connections: "Too many game tabs on your network are connected to the lobby. Close a few and try again.",
  too_many_rooms: "Your network already has 5 rooms waiting for players. Start or close one of them first.",
  too_fast: "The lobby closed the connection because this page sent too many messages. Please reload.",
  room_expired: "The room closed because the game didn't start within 30 minutes. Make a new one to play.",
  connect_failed: "Couldn't reach the lobby server. Check your connection and try again.",
  closed: "Lost connection to the lobby server.",
  lobby_lost: "Lost connection to the lobby server.",
  host_gone: "Your friend left before the game started.",
  host_left: "Your friend closed the room. Ask them for a new invite link.",
  version_mismatch: "Your friend has a different version of this page. Both of you, please reload.",
  message_too_big: "A player's browser sent something unexpected.",
};

const NO_TURN_HELP =
  "Couldn't connect to your friend. Games here run directly between your browsers, and some networks " +
  "(mobile data, office or school Wi-Fi, VPNs, strict firewalls) block direct connections. We don't run a relay " +
  "(TURN) server, so there's no fallback. Try both joining from home Wi-Fi, turn off VPNs, or play vs the robot.";

const LAYOUTS = ["narrow", "medium", "wide"];

// Room codes, as server/signaling.js makes them (no I, L, O, 0 or 1).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

export function startGameShell({ slug, title, tagline = "", createRobot, onSession, minPlayers = 2, maxPlayers = 2, robots, layout = "wide", settings, howToPlay, tutorial, banter = {} }) {
  initShell({ title, settings });
  const lobbyRoot = $("#lobby");
  const gameRoot = $("#game");
  const learnLink =
    tutorial &&
    el("p", { class: "learn-link" }, el("a", { href: "?learn", id: "learn-link", onclick: (e) => (e.preventDefault(), learn()) }, "Learn by playing: a short interactive tutorial"));
  if (howToPlay) gameRoot.after(howToPlayPanel(howToPlay, learnLink));
  setGameLines(banter.lines);
  // The lobby, game and "How to play" share one column (theme.css).
  const page = lobbyRoot.closest(".page");
  const showView = (name) => {
    if (page) page.dataset.view = name;
  };
  if (page) page.dataset.layout = LAYOUTS.includes(layout) ? layout : "wide";
  showView("lobby");
  const duel = maxPlayers === 2;
  const fewest = Math.max(2, minPlayers);
  const choosePlayers = robots === undefined && settings && maxPlayers > fewest;
  if (choosePlayers) settings.offerPlayers(Array.from({ length: maxPlayers - fewest + 1 }, (_, i) => fewest + i));
  const state = { room: null, session: null, game: null, tutorial: null, mustAsk: () => false, leave: null, robot: null, robots: [], attempt: 0 };
  window.ddp = state; // handy for debugging and browser tests

  const params = new URLSearchParams(location.search);

  // ---------- views ----------
  // Progress text for screen readers ("Creating a room…", "Bo joined"), and
  // join errors. It outlives the views, so each change is read out;
  // connection problems use role="alert".
  const progress = el("p", { class: "sr-only", id: "lobby-progress", role: "status" });
  lobbyRoot.append(progress);
  let firstView = true;

  // The lobby shows at once; the description fills in when games.json arrives.
  const taglineEl = el("p", { class: "tagline", hidden: !tagline }, tagline);
  if (!tagline) {
    fetch("/games.json", { cache: "no-cache" })
      .then((res) => res.json())
      .then(({ games }) => {
        taglineEl.textContent = games.find((g) => g.slug === slug)?.description ?? "";
        taglineEl.hidden = !taglineEl.textContent;
      })
      .catch(() => {});
  }

  // A new view takes focus to its heading, except on page load. The first
  // replaces the page's loading placeholder (index.html).
  function view(...children) {
    const card = el("div", { class: "card lobby-card" }, ...children);
    const old = $(".lobby-card", lobbyRoot);
    if (old) old.replaceWith(card);
    else lobbyRoot.prepend(card);
    progress.textContent = "";
    showView("lobby");
    lobbyRoot.hidden = false;
    gameRoot.hidden = true;
    $("h1", card).tabIndex = -1;
    if (!firstView) focusHeading();
    firstView = false;
  }

  function focusHeading() {
    $("h1", lobbyRoot).focus();
  }

  // Opens the page's "How to play" panel and moves focus to it.
  function howToPlayLink() {
    const panel = $("details.rules");
    if (!panel) return null;
    const open = (e) => {
      e.preventDefault();
      panel.open = true;
      $("summary", panel).focus({ preventScroll: true });
      panel.scrollIntoView({ block: "start" });
    };
    return el("p", { class: "how-to-play" }, el("a", { href: "#how-to-play", id: "how-to-play-link", onclick: open }, "How to play"));
  }

  // The typed nickname, or the saved default when the field is empty or refused.
  function currentName() {
    const input = $("#nickname");
    return (input && setNickname(input.value)) || getNickname();
  }

  // error: why the last join failed, shown under the code field, which keeps `code`.
  function showHome(error, code = "") {
    cleanupConnection();
    const codeInput = el("input", {
      id: "join-code",
      type: "text",
      value: code,
      autocapitalize: "characters",
      autocomplete: "off",
      enterkeyhint: "go",
      spellcheck: "false",
      placeholder: "CODE",
      "aria-label": "Room code",
      "aria-describedby": "join-error",
    });
    const joinError = el("p", { class: "notice error", id: "join-error", hidden: true });
    const showError = (text) => {
      joinError.textContent = text;
      joinError.hidden = !text;
      progress.textContent = text;
    };
    // Uppercase, drop spaces and dashes, refuse anything else; a full code joins at once.
    codeInput.addEventListener("input", () => {
      const typed = [...codeInput.value.toUpperCase().replace(/[\s-]/g, "")];
      const kept = typed.filter((c) => CODE_ALPHABET.includes(c));
      const clean = kept.join("").slice(0, CODE_LENGTH);
      if (codeInput.value !== clean) codeInput.value = clean;
      showError(kept.length < typed.length ? "Codes use letters and the numbers 2–9" : "");
      if (clean.length === CODE_LENGTH) join(clean);
    });
    const joinForm = el(
      "form",
      { class: "join-row", onsubmit: (e) => (e.preventDefault(), codeInput.value && join(codeInput.value)) },
      codeInput,
      el("button", { class: "btn", type: "submit" }, "Join"),
    );
    view(
      el("h1", {}, title),
      taglineEl,
      howToPlayLink(),
      nicknameField(),
      settings?.panel(),
      el(
        "div",
        { class: "lobby-actions" },
        el("button", { class: "btn primary big", id: "play-friend", type: "button", onclick: host }, duel ? "Play with a friend" : "Play with friends"),
        robotPlay(),
        tutorial && el("button", { class: "btn learn", id: "learn", type: "button", onclick: learn }, "Learn"),
      ),
      !choosePlayers && recordLine(),
      el("p", { class: "lobby-note", id: "direct-note" }, "Games connect your browser directly to your friends'. Play with people you know."),
      el("div", { class: "divider" }, el("span", {}, "or join with a code")),
      joinForm,
      joinError,
    );
    if (!error) return;
    // The code stays in the field, focused and ready to fix; the error is read out too.
    showError(error);
    codeInput.focus();
    codeInput.select();
  }

  // "Play vs robot", with the player count above it when the game offers one:
  // the button then says how many robots ("Play vs 2 robots"), and your
  // record against them under both.
  function robotPlay() {
    const button = el("button", { class: "btn big", id: "play-robot", type: "button", onclick: playRobot }, "Play vs robot");
    if (!choosePlayers) return button;
    const label = () => {
      const count = settings.players() - 1;
      button.textContent = count === 1 ? "Play vs robot" : `Play vs ${count} robots`;
    };
    const choice = settings.playersForm();
    choice.addEventListener("change", label);
    label();
    return el("div", { class: "robot-play" }, choice, button, recordLine());
  }

  // Your record against the robots on this device (robot-record.js), once
  // you've finished a robot game, with a Reset that asks first.
  function recordLine() {
    const { win, draw, loss, games } = robotRecord(slug);
    if (!games) return null;
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const line = el(
      "p",
      { class: "robot-record", id: "robot-record" },
      el("span", {}, `You vs ${duel ? "robot" : "robots"}: ${n(win, "win", "wins")} · ${n(draw, "draw", "draws")} · ${n(loss, "loss", "losses")}`),
      el("button", { class: "robot-record-reset", id: "robot-record-reset", type: "button", onclick: reset }, "Reset"),
    );
    async function reset() {
      const yes = await confirmDialog({ title: "Reset your record?", text: `This clears your ${title} results against the robot${duel ? "" : "s"} on this device.`, yes: "Reset", no: "Keep" });
      if (!yes) return;
      resetRobotRecord(slug);
      line.remove();
      $("#play-robot")?.focus();
    }
    return line;
  }

  // An invite link stops here first so the friend can pick a nickname before joining.
  function showInvite(code, key) {
    view(
      el("h1", {}, title),
      el("p", {}, `You're invited to room ${code}.`),
      el(
        "form",
        { class: "invite-join", onsubmit: (e) => (e.preventDefault(), join(code, key)) },
        nicknameField(),
        el("div", { class: "lobby-actions" }, el("button", { class: "btn primary big", id: "join-room", type: "submit" }, "Join room")),
      ),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Back"),
    );
  }

  function showWaiting(room) {
    const link = `${location.origin}/${slug}/?room=${room.code}&key=${encodeURIComponent(room.key)}`;
    const linkInput = el("input", { id: "invite-link", class: "mono", type: "text", readonly: true, value: link, "aria-label": "Invite link" });
    linkInput.addEventListener("focus", () => linkInput.select());
    const copyBtn = el("button", {
      class: "btn primary",
      id: "copy-link",
      type: "button",
      onclick: async () => toast((await copyText(link)) ? "Invite link copied" : "Copy failed: select the link and copy it"),
    }, "Copy link");
    const shareBtn =
      (isApp || navigator.share) &&
      el("button", {
        class: "btn",
        type: "button",
        // The app opens the phone's share sheet itself (native.js). On the web a
        // cancelled share sheet needs nothing; any other failure copies the link instead.
        onclick: () =>
          share(`Play ${title} with me!`, link) ||
          navigator.share({ title: `${title} on Daily Dose of Play`, text: "Play with me!", url: link }).catch(async (e) => {
            if (e.name === "AbortError") return;
            toast((await copyText(link)) ? "Sharing didn't work, so the invite link was copied" : "Sharing failed: select the link and copy it");
          }),
      }, "Share");
    view(
      el("h1", {}, duel ? "Invite a friend" : "Invite friends"),
      el(
        "p",
        {},
        duel
          ? "Send this link to a friend. The game starts as soon as they open it."
          : `Send this link to up to ${maxPlayers - 1} friends, or fill seats with robots. Start when everyone is in; a room full of friends starts by itself.`,
        " Someone who types the code instead has to be let in by you.",
      ),
      // Screen readers get the code from the label, spaced so each letter is
      // read on its own; the big code below is for the eyes.
      el("p", { class: "room-code-label" }, "Room code", el("span", { class: "sr-only" }, ` ${[...room.code].join(" ")}`)),
      // One span per letter, so the letters can settle in one by one (theme.css).
      el(
        "div",
        { class: "room-code mono", id: "room-code", "aria-hidden": "true" },
        [...room.code].map((c, i) => el("span", { style: `--i: ${i}` }, c)),
      ),
      el("div", { class: "invite-row" }, linkInput, copyBtn, shareBtn),
      settings &&
        el(
          "div",
          { class: "room-settings", id: "room-settings" },
          el("p", { class: "room-settings-label" }, "Game settings"),
          el("p", { class: "settings-line" }, settings.summary(false)),
        ),
      el("ul", { class: "roster", id: "roster", "aria-label": "Players", hidden: duel }),
      el("p", { class: "waiting", id: "lobby-status" }),
      !duel && el("button", { class: "btn primary", type: "button", id: "start-game", disabled: true, onclick: () => begin(room) }, "Start game"),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Cancel"),
    );
    setStatus(duel ? "Waiting for your friend to join…" : "Waiting for friends to join…");
    showRoster(room);
  }

  // Players so far (4-seat games), robots and empty seats each with a
  // button to add or remove a robot, then anyone with only the code asking to join.
  function showRoster(room) {
    const list = $("#roster");
    if (!list) return;
    const players = room.players;
    const knocks = room.knocking;
    list.hidden = duel && knocks.length === 0;
    setTabAlert(knocks.length ? `${knocks[0].name} wants to join` : null);
    // Accept and Decline go with their row, so focus moves back to the heading;
    // after adding or removing a robot it stays on the seats.
    const hadFocus = list.contains(document.activeElement);
    const onSeat = hadFocus && !!document.activeElement.closest(".robot, .empty");
    const setRobots = (n, text) => {
      room.setRobots(n);
      progress.textContent = text;
    };
    const empty = duel ? 0 : maxPlayers - players.length;
    list.replaceChildren(
      ...(duel ? [] : players).map((p, i) =>
        p.robot
          ? el(
              "li",
              { class: "ready robot" },
              el("span", {}, p.name),
              el(
                "span",
                { class: "seat-actions" },
                el("small", {}, "robot"),
                el("button", { class: "btn small", type: "button", "aria-label": `Remove ${p.name}`, onclick: () => setRobots(room.robots - 1, `${p.name} removed`) }, "Remove"),
              ),
            )
          : el("li", { class: p.ready ? "ready" : "" }, el("span", {}, p.name), el("small", {}, i === 0 ? "host" : p.ready ? "in" : "connecting…")),
      ),
      ...Array.from({ length: empty }, (_, i) =>
        el(
          "li",
          { class: "empty" },
          el("span", {}, "Empty seat"),
          el("button", { class: "btn small", type: "button", id: i === 0 ? "add-robot" : undefined, onclick: () => setRobots(room.robots + 1, "Robot added") }, "Add robot"),
        ),
      ),
      ...knocks.map(({ id, name }) =>
        el(
          "li",
          { class: "knock" },
          el("span", {}, `${name} wants to join`),
          el(
            "span",
            { class: "knock-actions" },
            el("button", { class: "btn small primary", type: "button", onclick: () => room.accept(id) }, "Accept"),
            el("button", { class: "btn small", type: "button", onclick: () => room.decline(id) }, "Decline"),
          ),
        ),
      ),
    );
    if (onSeat) ($("#add-robot") || $("#roster .robot button") || $("h1", lobbyRoot)).focus();
    else if (hadFocus) focusHeading();
    if (duel) return;
    const ready = players.filter((p) => p.ready).length;
    const friends = players.filter((p, i) => i > 0 && p.ready && !p.robot).length;
    const start = $("#start-game");
    start.disabled = ready < minPlayers || friends === 0;
    start.textContent = ready < minPlayers ? `Start game (needs ${minPlayers} players)` : friends === 0 ? "Start game (needs a friend)" : `Start game (${ready} players)`;
  }

  function showBusy(text) {
    view(
      el("h1", {}, title),
      el("p", { class: "waiting", id: "lobby-status" }),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Cancel"),
    );
    setStatus(text);
  }

  function setStatus(...text) {
    const node = $("#lobby-status");
    if (!node) return;
    node.replaceChildren(el("span", { class: "spinner" }), ...text);
    progress.textContent = node.textContent;
  }

  function showFailure(text, retry = host) {
    cleanupConnection();
    view(
      el("h1", {}, "Connection problem"),
      el("p", { class: "notice error", role: "alert", id: "connect-error" }, text),
      el(
        "div",
        { class: "lobby-actions" },
        el("button", { class: "btn primary", type: "button", id: "retry", onclick: () => retry() }, "Try again"),
        el("button", { class: "btn", type: "button", id: "play-robot", onclick: playRobot }, "Play vs robot"),
      ),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Back"),
    );
  }

  // The lobby server can't be reached: no connection, or the app's offline
  // copy, which has no server. The robot and the tutorial need none.
  function showOffline(retry) {
    cleanupConnection();
    view(
      el("h1", {}, "You're offline"),
      el("p", { class: "notice", id: "offline-note" }, "Play the robot or learn a game. Playing with friends needs an internet connection."),
      el(
        "div",
        { class: "lobby-actions" },
        el("button", { class: "btn primary", type: "button", id: "play-robot", onclick: playRobot }, "Play vs robot"),
        el("button", { class: "btn", type: "button", id: "retry", onclick: () => retry() }, "Try again"),
        tutorial && el("button", { class: "btn learn", id: "learn", type: "button", onclick: learn }, "Learn"),
      ),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Back"),
    );
    progress.textContent = "You're offline. Play the robot or learn a game.";
  }

  // ---------- connection plumbing ----------
  // Every user action bumps `attempt`; async steps from an older attempt
  // (e.g. a create that resolves after Cancel) must not touch the UI.
  function cleanupConnection() {
    state.attempt += 1;
    const room = state.room;
    state.room = null;
    room?.close();
    setTabAlert(null);
    clearRoomParam();
  }

  function clearRoomParam() {
    if (params.has("room") || params.has("key")) {
      params.delete("room");
      params.delete("key");
      history.replaceState(null, "", location.pathname);
    }
  }

  async function host() {
    const name = currentName();
    cleanupConnection();
    const attempt = state.attempt;
    const current = () => attempt === state.attempt;
    showBusy("Creating a room…");
    const room = new HostRoom({ game: slug, name, maxPlayers });
    state.room = room;
    try {
      await room.open();
    } catch (err) {
      if (current()) err.code === "connect_failed" ? showOffline(host) : showFailure(ERRORS[err.code] || ERRORS.connect_failed);
      return;
    }
    if (!current()) return;
    showWaiting(room);
    room.on("lost", (reason) => current() && showFailure(ERRORS[reason] || ERRORS.closed));
    let knockCount = 0;
    room.on("knocks", (knocks) => {
      if (!current()) return;
      if (knocks.length > knockCount) progress.textContent = `${knocks.at(-1).name} wants to join`;
      knockCount = knocks.length;
      showRoster(room);
    });
    let seated = [name]; // who is in, in join order, to say who just joined
    room.on("players", (players) => {
      if (!current()) return;
      const people = players.filter((p) => p.ready && !p.robot);
      if (people.length >= maxPlayers) return begin(room);
      if (!duel) {
        const inRoom = people.map((p) => p.name);
        if (inRoom.length > seated.length) progress.textContent = `${inRoom.find((n, i) => n !== seated[i])} joined`;
        seated = inRoom;
        return showRoster(room);
      }
      const joining = players.find((p, i) => i > 0 && !p.ready);
      setStatus(joining ? `${joining.name} joined. Connecting directly…` : "Waiting for your friend to join…");
    });
    room.on("guest-gone", ({ name: who, reason }) => {
      if (!current()) return;
      const why =
        reason === "message_too_big"
          ? ERRORS.message_too_big
          : reason === "left" || reason === "closed_before_open"
            ? `${duel ? "Your friend" : who} left.`
            : `Couldn't connect to ${who}.`;
      toast(`${why} The invite link still works.`);
    });
  }

  function begin(room) {
    if (room !== state.room) return;
    state.room = null;
    setTabAlert(null);
    const [session, ...robotSessions] = room.start();
    robotSessions.forEach(seatRobot);
    startSession(session);
  }

  // key comes only from an invite link; a typed code asks the host to let us in.
  async function join(rawCode, key) {
    const code = String(rawCode).trim().toUpperCase();
    const name = currentName();
    // Keep ?room= until the join settles so a reload retries it.
    state.attempt += 1;
    state.room?.close();
    const attempt = state.attempt;
    const current = () => attempt === state.attempt;
    showBusy(`Joining room ${code}…`);
    const room = new GuestRoom({ game: slug, code, key, name });
    state.room = room;
    let host = "your friend";
    room.on("status", ({ step, host: hostName, players, robots }) => {
      if (!current()) return;
      if (step === "knocking") {
        setStatus("Waiting for the host to let you in…");
      } else if (step === "connecting") {
        host = hostName || host;
        setStatus(`Connecting to ${host}…`);
      } else if (duel) {
        setStatus("Connected! Starting the game…");
      } else {
        const people = players && (robots ? `${players.length - robots} players and ${robots} ${robots === 1 ? "robot" : "robots"} in` : `${players.length} players in`);
        const count = players ? [" (", el("span", { class: "mono" }, people), ")"] : [];
        setStatus(`Connected! Waiting for ${host} to start`, ...count, "…");
      }
    });
    let session;
    try {
      session = await room.join();
    } catch (err) {
      if (!current()) return;
      if (err.code === "connect_failed") return showOffline(() => join(code, key));
      if (!(err instanceof RoomError)) return showHome(ERRORS[err.code] || ERRORS.connect_failed, code);
      return showFailure(ERRORS[err.code] || NO_TURN_HELP, () => join(code, key));
    }
    if (!current()) return session.leave();
    state.room = null;
    startSession(session);
  }

  function playRobot() {
    cleanupConnection();
    const name = currentName();
    const count = typeof robots === "function" ? robots() : (robots ?? (choosePlayers ? settings.players() : maxPlayers) - 1);
    const names = [name, ...Array.from({ length: count }, (_, i) => (count === 1 ? "Robot" : `Robot ${i + 1}`))];
    const [session, ...robotSessions] = localRoom({ game: slug, names, mode: "robot" });
    robotSessions.forEach(seatRobot);
    state.robot = state.robots[0];
    startSession(session);
  }

  // A robot plays a seat: in a robot game, or in a friend room on the host.
  // It votes for a rematch once someone else has, and may join after votes are in.
  function seatRobot(robotSession) {
    robotSession.on("rematch", (votes) => votes.them && !votes.me && robotSession.requestRematch());
    const robot = createRobot(robotSession);
    robotBanter(robotSession, robot, banter);
    state.robots.push(robot);
    if (robotSession.votes.size && !robotSession.votes.has(robotSession.index)) robotSession.requestRematch();
  }

  // ---------- tutorial ----------
  // It has a history entry of its own (?learn), so Back returns to the lobby.
  async function learn() {
    cleanupConnection();
    const attempt = state.attempt;
    const [{ startTutorial }, module] = await Promise.all([import("./tutorial.js"), tutorial()]);
    if (attempt !== state.attempt) return;
    if (!new URLSearchParams(location.search).has("learn")) history.pushState({ learn: slug }, "", "?learn");
    showView("game");
    lobbyRoot.hidden = true;
    gameRoot.hidden = false;
    state.tutorial = startTutorial({
      root: gameRoot,
      slug,
      title,
      tutorial: module,
      onClose: leaveTutorial,
      onPlayRobot: () => {
        closeTutorial();
        history.replaceState(null, "", location.pathname);
        playRobot();
      },
    });
  }

  function closeTutorial() {
    state.tutorial?.destroy();
    state.tutorial = null;
  }

  function leaveTutorial() {
    closeTutorial();
    if (history.state?.learn === slug) history.back();
    else history.replaceState(null, "", location.pathname);
    showHome();
  }

  // ---------- game hand-off ----------
  function startSession(session) {
    state.session = session;
    clearRoomParam();
    showView("game");
    lobbyRoot.hidden = true;
    gameRoot.hidden = false;
    gameRoot.replaceChildren();
    // The game has a history entry of its own, so Back leaves it as Leave does.
    history.pushState({ game: slug }, "");
    settings?.lock(true, session.mode);
    let inProgress = false;
    state.mustAsk = () => inProgress && session.mode === "friend" && askBeforeLeaving();
    state.leave = async () => {
      if (state.mustAsk() && !(await confirmLeave(session))) return;
      leaveGame();
    };
    state.game = onSession(session, gameRoot, { leave: state.leave, setInProgress: (on) => (inProgress = on) });
    // A guest left a friend room: on the host a robot takes their seat over.
    session.on("takeover", (seat, why, robot) => {
      if (robot) seatRobot(robot);
      const who = session.players[seat].name;
      const what = why === "message_too_big" ? ERRORS.message_too_big : why === "left" ? `${who} left.` : `The connection to ${who} was lost.`;
      toast(`${what} A robot plays their seat.`);
    });
    session.on("end", (reason, seat) => {
      inProgress = false;
      if (reason === "self") return;
      const who = session.players[seat]?.name ?? session.opponent.name;
      if (reason === "message_too_big") return showEnded(ERRORS.message_too_big);
      showEnded(reason === "left" ? `${who} left the game.` : `The connection to ${who} was lost.`);
    });
  }

  function confirmLeave(session) {
    const text =
      session.takeover && session.index !== 0
        ? "A robot takes your seat and the game goes on."
        : session.players.length === 2
          ? `${session.opponent.name} will be told you left.`
          : "It ends for everyone.";
    return confirmDialog({ title: "Leave the game?", text, yes: "Leave" });
  }

  function showEnded(text) {
    const overlay = el(
      "div",
      { class: "overlay", id: "ended" },
      el(
        "div",
        { class: "card" },
        el("h2", { tabindex: "-1", "aria-describedby": "ended-why" }, "Game ended"),
        el("p", { class: "notice", id: "ended-why" }, text),
        el("button", { class: "btn primary", type: "button", onclick: () => leaveGame() }, "Back to lobby"),
      ),
    );
    gameRoot.append(overlay);
    $("h2", overlay).focus();
  }

  function leaveGame(message) {
    const session = state.session;
    state.session = null;
    if (history.state?.game === slug) history.back();
    session?.leave();
    state.game?.destroy?.();
    state.game = null;
    for (const robot of state.robots) robot?.destroy?.();
    state.robots = [];
    state.robot = null;
    settings?.lock(false);
    showHome(message);
  }

  addEventListener("pagehide", () => state.session?.leave());

  // Closing or reloading the tab mid-match: only the browser's own prompt can ask.
  addEventListener("beforeunload", (e) => {
    if (!state.session || !state.mustAsk()) return;
    e.preventDefault();
    e.returnValue = true; // older Safari and Chrome
  });

  // Back during a game: stay on the game's entry and leave as Leave does. Back
  // while the question or the settings panel is open closes it, like Esc. Back
  // in the tutorial returns to the lobby.
  addEventListener("popstate", () => {
    if (state.tutorial) {
      closeTutorial();
      return showHome();
    }
    if (!state.session) return;
    history.pushState({ game: slug }, "");
    const open = $("dialog[open]");
    if (open) open.close();
    else state.leave();
  });

  // ---------- entry ----------
  // Deferred until the game's module has finished loading: onSession may use
  // bindings declared after its startGameShell() call.
  queueMicrotask(() => {
    const code = params.get("room");
    if (code) showInvite(code.trim().toUpperCase(), params.get("key") || undefined);
    else if (params.has("robot")) playRobot();
    else if (params.has("friend")) {
      // Dropped first, so a reload doesn't create a second room.
      history.replaceState(null, "", location.pathname);
      host();
    } else if (tutorial && params.has("learn")) learn();
    else showHome();
  });
}
