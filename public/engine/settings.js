// A game's settings: groups of segmented options (clocks, board size, …),
// remembered on this device. The lobby shows them inside its card, folded to
// a summary of chips, and the summary again on the host's waiting screen;
// the settings panel's "This game" tab shows the same options.
// In a friend game the room creator's settings apply to everyone: the game
// sends them to its guests when the match is set up.
import { el, segGroup } from "./shell.js";

// groups: [{ name, legend, options: [[value, label, hint?], …], scope?, summary? }]
// scope: "room" (the default) is the game's rules, sent to the other players;
// "device" only applies to robots, in robot games and on the host of a friend
// room (the robots' level; `robot: true` says the same); "view" is this player's own view of the game and
// can change during a game, which the game reads with get() when it needs it.
// summary(value, label, config, robots) is the text of the group's chip in the
// summary (default: the label; "" leaves it out); robots is how many play
// against you in a robot game, when the lobby offers a choice (offerPlayers()).
// normalize(raw) returns a complete, valid config (defaults for anything else).
// robot(config, picked), optional, is the config for a robot game, given the
// names of the groups the player picked an option in: a game whose clocks are
// on by default turns off the ones not picked.
// defaultPlayers, optional, is a robot game's player count until the player
// picks one (else a full table); playerNotes are hints for some counts
// ({ 3: "17 cards each" }; see offerPlayers()).
export function gameSettings({ key, prefix, groups, normalize, hint, robot, defaultPlayers, playerNotes = {} }) {
  let { config, picked, players } = load();
  let counts = []; // the player counts the lobby offers for a robot game
  let locked = false;
  let mode = "friend"; // the game that's on while locked
  const shown = new Map(); // what is on screen (summaries, options) → how to bring it up to date
  const scopeOf = (g) => g.scope ?? (g.robot ? "device" : "room");
  // The picks are kept next to the config. Settings saved before that: a
  // value other than the default can only have been picked.
  function load() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(key));
    } catch {}
    const config = normalize(raw);
    const defaults = normalize(null);
    const picked = Array.isArray(raw?.picked) ? raw.picked : groups.map((g) => g.name).filter((name) => config[name] !== defaults[name]);
    return { config, picked: new Set(picked), players: savedPlayers(raw) };
  }
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify({ ...config, picked: [...picked], players }));
    } catch {}
  }
  function pick(name) {
    picked.add(name);
    save();
  }
  function set(name, value) {
    config = normalize({ ...config, [name]: value });
    pick(name);
    refresh();
  }
  const current = (gameMode) => (gameMode === "robot" && robot ? robot(config, [...picked]) : config);
  function refresh() {
    for (const [node, update] of shown) {
      if (node.isConnected) update();
      else shown.delete(node);
    }
  }
  // The summary: a chip per choice (robot-only ones with a teal dot), with
  // commas between them for screen readers. robots, on the host's waiting
  // screen: how many robots the room seats; it shows the room's rules, and
  // the robots' options once there are any.
  function summary(robots) {
    const room = robots !== undefined;
    const parts = groups
      .filter((g) => !room || scopeOf(g) === "room" || (robots > 0 && scopeOf(g) === "device"))
      .map((g) => {
        const label = g.options.find(([value]) => value === config[g.name])?.[1] ?? "";
        const count = room ? robots : counts.length ? seats() - 1 : undefined;
        return { text: g.summary ? g.summary(config[g.name], label, config, count) : label, robot: scopeOf(g) === "device" };
      })
      .filter((p) => p.text);
    return parts.flatMap(({ text, robot }, i) => [i ? el("span", { class: "sr-only" }, ", ") : "", el("span", { class: robot ? "chip robot" : "chip" }, text)]);
  }
  // The options, one group per fieldset. While a game is on (lock), only
  // "view" options can change, and they show the game's config. Each copy on
  // screen names its radio buttons after `id`, and follows changes made in
  // the others. Choosing the option already shown fires no change, but counts
  // as picking it. The settings panel's copy has the player count too; the
  // lobby card shows it with "Play vs robot" instead.
  function form(id = prefix) {
    const note = el("p", { class: "notice", id: `${id}-locked` }, "Locked during a game: rematches keep the room's settings. Change them in the lobby for your next game.");
    const sets = groups.map((g) => {
      // With more than two seats, friend rooms seat robots too.
      const tag = scopeOf(g) === "device" && el("small", { class: "chip robot robot-only" }, counts.length ? "for robots" : "vs robot only");
      const fieldset = segGroup({ name: `${id}-${g.name}`, legend: [g.legend, tag], options: g.options, value: config[g.name], onChange: (value) => set(g.name, value) });
      fieldset.addEventListener("click", (e) => e.target.checked && pick(g.name));
      return fieldset;
    });
    // The player count goes after the robots' own options.
    const after = groups.findLastIndex((g) => scopeOf(g) === "device") + 1 || sets.length;
    const players = id !== prefix && counts.length && playersForm(id);
    const body = el("div", { class: "settings-body" }, note, sets.slice(0, after), players, sets.slice(after), hint && el("p", { class: "hint" }, hint));
    const update = () => {
      const values = locked ? current(mode) : config;
      note.hidden = !locked;
      groups.forEach((g, i) => {
        sets[i].disabled = locked && scopeOf(g) !== "view";
        for (const input of sets[i].querySelectorAll("input")) input.checked = input.value === String(values[g.name]);
      });
    };
    update();
    shown.set(body, update);
    return body;
  }
  // The lobby's home screen: the summary, which opens to the options.
  function panel() {
    const line = el("span", { class: "settings-line" }, summary());
    const change = el("span", { class: "settings-change" }, "Change");
    const details = el(
      "details",
      { class: "settings", id: `${prefix}-settings` },
      el("summary", {}, el("span", { class: "settings-title" }, "Game settings"), change, line),
      form(),
    );
    shown.set(line, () => line.replaceChildren(...summary()));
    details.addEventListener("toggle", () => (change.textContent = details.open ? "Done" : "Change"));
    return details;
  }
  // A robot game's player count, for a game that seats more than two: the
  // lobby offers `counts` once (offerPlayers()), shows playersForm() with its
  // "Play vs robot" button and starts with players() seats. Like a "device"
  // option, it is locked during a game.
  function offerPlayers(list) {
    counts = list;
  }
  const seats = () => [players, defaultPlayers].find((n) => counts.includes(n)) ?? counts.at(-1);
  function playersForm(id = prefix) {
    const options = counts.map((n) => [n, String(n)]);
    const tag = el("small", { class: "chip robot robot-only" }, "vs robot only");
    const fieldset = segGroup({ name: `${id}-players`, legend: ["Players (you + robots)", id !== prefix && tag], options, value: seats(), onChange: (n) => ((players = n), save(), refresh()) });
    const note = el("p", { class: "players-note", id: `${id}-players-note` });
    fieldset.classList.add("players-choice");
    fieldset.append(note);
    const update = () => {
      fieldset.disabled = locked;
      for (const input of fieldset.querySelectorAll("input")) input.checked = input.value === String(seats());
      note.textContent = playerNotes[seats()] ?? "";
      note.hidden = !note.textContent;
    };
    update();
    shown.set(fieldset, update);
    return fieldset;
  }
  // lock(true, mode) while a game is on; the lobby calls it.
  function lock(on, gameMode = "friend") {
    locked = on;
    mode = gameMode;
    refresh();
  }
  // get("robot") is the config for a robot game.
  return { get: (gameMode) => ({ ...current(gameMode) }), summary, panel, form, lock, offerPlayers, players: seats, playersForm };
}

// The player count saved with a game's settings, if any. Settings saved
// before the lobby offered it kept the number of robots instead.
export function savedPlayers(raw) {
  if (Number.isInteger(raw?.players)) return raw.players;
  if (Number.isInteger(raw?.robots)) return raw.robots + 1;
}
