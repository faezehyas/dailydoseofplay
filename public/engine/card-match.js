// Turn-based card games with hidden cards and no dealer: mental poker (see
// ARCHITECTURE.md "Card games"). Like TurnMatch, every browser runs the same
// rules on the same moves; the deck is shuffled by everyone with proofs, a
// card's face is only known where it was opened, and the game is replayed
// with every face known once it ends.
//
// A rules module provides:
//   deckSize                              1 to 200; a card's face is 0..deckSize-1
//   newState(first, players, deck)        -> state with state.turn and state.winner (-1 while playing).
//                                            deck.cards: the shuffled deck's slots, top first.
//   applyMove(state, player, move, deck)  -> events[]; mutates state; throws RuleError if illegal
//   reveals(state, player, move)          -> optional; the cards from the player's hand the move shows
//   settle(state, deck)                   -> optional; events[]; after newState and each move, once
//                                            their cards are dealt, and again while it deals more
// The deck those calls get (a slot is a card's place; a shuffle makes new ones):
//   deck.face(slot)        its face if every player can see it, else null; every face in the audit
//   deck.owner(slot)       the seat holding it, or -1
//   deck.deal(slot, seat)  only that seat sees it; a card hidden in another hand can't be dealt
//   deck.pass(slot, seat)  a card in someone's hand goes to that seat in secret: only
//                          they (and whoever held it) see it; anyone's card, not just the mover's
//   deck.open(slot)        everyone sees it from the next call on (settle reads it)
//   deck.shuffle(slots)    -> new slots for the same cards, shuffled again by everyone
// The state must never depend on a face that may be hidden, or the replay
// won't match; a rule that needs a hidden face throws only when it is known.
//
// Messages (all carry m): hello {tip, key, seal}, draw {k, v}, shuffle {k, i, n, d},
// shares {k, i, n, d}, seal {k, i, n, d}, move {move, sh}, audit {key, seal},
// abort {reason, about, dispute}, unseal {key}.
import { Emitter } from "./channel.js";
import { SharedRandom, FairPlayError } from "./fair.js";
import { matchRouter } from "./session.js";
import { robotPause } from "./robot-pace.js";
import { RuleError } from "./turn-match.js";
import { deckService, DeckError, MAX_DECK, HELLO_BYTES, SECRET_BYTES, SHARE_BYTES } from "./deck-service.js";
import { toBase64, fromBase64 } from "./base64.js";
import { sealKeys, sealSecret, sealPublic, revealedKey, seal, unseal, sealedBytes, SealError, SEAL_PUBLIC_BYTES, SEAL_SECRET_BYTES } from "./seal.js";

// Shuffles and share rounds go out in parts, so no message passes 4K characters.
const PART_CHARS = 3000;
const PART_SHARES = 16;
const MAX_PARTS = Math.ceil((2 * MAX_DECK) / PART_SHARES); // a round deals and opens a card at most once each
const MAX_REVEALS = PART_SHARES; // a move's shares, the same 4K
const MAX_SEAL_PARTS = MAX_DECK; // a sealed card a part at worst
const MAX_SETTLE = 64;
const MAX_AHEAD = 4 * MAX_PARTS; // messages one seat may send ahead of us

// A rule or protocol failure blamed on one seat; dispute: the step of a sealed card in question.
class Cheat extends FairPlayError {
  constructor(reason, seat, dispute) {
    super(reason);
    this.seat = seat;
    this.dispute = dispute;
  }
}

// The cards as rules see them (see the top of this file). Records deals,
// opens and shuffles in `ops` for the match to carry out.
class Table {
  constructor({ slots, players, face, make }) {
    this.slots = slots; // { owner, open, gone }
    this.players = players;
    this.faceOf = face;
    this.make = make;
    this.ops = [];
    this.opened = new Set();
  }
  #get(id) {
    const s = Number.isInteger(id) ? this.slots[id] : undefined;
    if (!s || s.gone) throw new RuleError(`no card in slot ${id}`);
    return s;
  }
  face(id) {
    this.#get(id);
    // Not RuleError: it's a bug in the rules, not a player's move.
    if (this.opened.has(id)) throw new Error(`slot ${id} was opened in this call; read its face in a later call`);
    return this.faceOf(id);
  }
  owner(id) {
    return this.#get(id).owner;
  }
  deal(id, seat) {
    const s = this.#get(id);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.players) throw new RuleError(`no seat ${seat}`);
    if (s.owner === seat) return;
    if (s.owner !== -1 && !s.open) throw new RuleError("a hidden card in a hand changes hands with deck.pass()");
    s.owner = seat;
    if (!s.open) this.ops.push({ type: "deal", slot: id, to: seat });
  }
  pass(id, seat) {
    const s = this.#get(id);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.players) throw new RuleError(`no seat ${seat}`);
    if (s.owner === -1) throw new RuleError("only a card in a hand can be passed");
    if (s.owner === seat) return;
    const from = s.owner;
    s.owner = seat;
    if (s.open) return;
    // Dealt or passed earlier in this call: it goes straight to its last seat.
    const op = this.ops.find((op) => op.slot === id && (op.type === "deal" || op.type === "pass"));
    if (op?.type === "pass" && op.from === seat) this.ops.splice(this.ops.indexOf(op), 1);
    else if (op) op.to = seat;
    else this.ops.push({ type: "pass", slot: id, from, to: seat });
  }
  open(id) {
    const s = this.#get(id);
    if (s.open) return;
    s.open = true;
    this.opened.add(id);
    const pass = this.ops.findIndex((op) => op.slot === id && op.type === "pass");
    if (pass !== -1) this.ops.splice(pass, 1); // everyone's share opens it now
    this.ops.push({ type: "open", slot: id });
  }
  shuffle(ids) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new RuleError("bad shuffle");
    ids.forEach((id) => this.#get(id));
    for (const id of ids) this.slots[id].gone = true;
    const into = ids.map(() => this.slots.push(this.make()) - 1);
    if (ids.length) this.ops.push({ type: "shuffle", from: ids.slice(), into: into.slice() }); // rules may change what they get back
    return into;
  }
}

const isSeat = (s, players) => Number.isInteger(s) && s >= 0 && s < players;
const hex64 = (v) => {
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) throw new TypeError("bad tip");
  return v;
};
// One part of a message sent in parts: { n, d }.
function part(msg, data, max = MAX_PARTS) {
  if (!Number.isInteger(msg.i) || !Number.isInteger(msg.n) || msg.n < 1 || msg.n > max || msg.i < 0 || msg.i >= msg.n) throw new TypeError("bad part");
  return { n: msg.n, d: data() };
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (out.set(p, o), o + p.length), 0);
  return out;
}

const newSlot = () => ({ card: null, owner: -1, open: false, face: null, shares: [], pub: [], gone: false });

function bytes(v, { exact, max }) {
  const b = fromBase64(v);
  if ((exact && b.length !== exact) || (max && b.length > max)) throw new TypeError("bad length");
  return b;
}

export class CardMatch extends Emitter {
  constructor({ send, me, rules, m = 1, players = 2 }) {
    super();
    if (!(rules.deckSize >= 1 && rules.deckSize <= MAX_DECK)) throw new Error(`deckSize must be 1 to ${MAX_DECK}`);
    this.send = (msg) => send({ ...msg, m });
    this.me = me;
    this.players = players;
    this.m = m;
    this.rules = rules;
    this.deck = deckService();
    this.phase = "starting"; // starting -> playing -> over | aborted
    this.busy = "keys"; // "keys" | "shuffling" | "dealing" | "auditing" | null
    this.state = null;
    this.verdict = null; // after the audit, or a dispute: { ok, reason?, seat? }
    this.audited = null; // every slot's face, once the audit has passed
    this.working = false;
    this.slots = []; // { card, owner, open, face, shares: [by seat], pub: [by seat: its share went to all], gone }
    this.sealed = []; // every sealed card: { k, slot, card, from, to, need, envelope }, for the audit
    this.sealedRound = 0; // the last deck step whose sealed cards are recorded
    this.dispute = null; // a receiver's word that a sealed card is bad, until we reach its step
    this.disputing = false; // stopped over a sealed card: its two players reveal their seal keys
    this.seals = { seal, unseal }; // tests swap these
    this.log = []; // { player, move } for the audit
    this.k = 0; // deck steps (shuffles and share rounds), counted alike everywhere
    this.inbox = new Map(); // key -> { value, from }
    this.ahead = []; // by seat: how many of its messages the inbox holds
    this.waiters = new Map();
    this.seen = new Set();
    this.srReady = SharedRandom.create(1); // one draw: who starts
    this.queue = Promise.resolve();
    this.#enqueue(() => this.#setup());
  }

  canMove() {
    return this.phase === "playing" && this.state.turn === this.me && !this.working;
  }

  // The face of a slot, if I know it: open to all, dealt or passed to me (or by me), or any card once the audit has passed.
  face(slot) {
    return this.slots[slot]?.face ?? this.audited?.[slot] ?? null;
  }

  // Validate locally, then send and apply. Illegal moves emit "invalid".
  play(move) {
    return this.#enqueue(async () => {
      if (this.phase !== "playing" || this.state.turn !== this.me) return this.emit("invalid", "not your turn");
      let shown;
      try {
        shown = this.#reveals(this.state, this.me, move);
        const set = new Set(shown);
        const table = this.#table(
          this.slots.map((s, id) => ({ ...s, open: s.open || set.has(id) })),
          (id) => {
            const s = this.slots[id];
            return s && (s.open || set.has(id)) ? s.face : null;
          },
        );
        this.rules.applyMove(structuredClone(this.state), this.me, move, table);
      } catch (err) {
        if (err?.name === "RuleError") return this.emit("invalid", err.message);
        throw err;
      }
      // I hold every share still missing from each card I show: my own, and any sealed to me.
      const shares = shown.flatMap((id) => this.#missing(id).map((s) => this.slots[id].shares[s]));
      this.send({ t: "move", move, sh: shares.map(toBase64) });
      await this.#apply(this.me, move, shown, shares);
    });
  }

  receive(msg, from) {
    if (msg?.m !== this.m || !isSeat(from, this.players) || from === this.me) return;
    if (this.phase === "aborted" && !(this.disputing && msg.t === "unseal")) return;
    const k = Number.isInteger(msg.k) && msg.k > 0 ? msg.k : 0;
    switch (msg.t) {
      case "draw":
        return void this.srReady.then((sr) => sr.receive(msg.k, msg.v, from));
      case "abort": {
        const about = isSeat(msg.about, this.players) ? msg.about : undefined;
        const reason = `stopped the match: ${String(msg.reason).slice(0, 80)}`;
        if (Number.isInteger(msg.dispute) && msg.dispute > 0 && about !== undefined && about !== from) return this.#disputed({ k: msg.dispute, giver: about, receiver: from, reason });
        if (this.dispute && this.dispute.k <= this.k + 1) return; // a dispute we're about to reach is judged first
        return this.abort(reason, from, about);
      }
      case "hello":
        return this.#put(`hello:${from}`, from, () => ({ tip: hex64(msg.tip), hello: bytes(msg.key, { exact: HELLO_BYTES }), seal: bytes(msg.seal, { exact: SEAL_PUBLIC_BYTES }) }));
      case "shuffle":
        return this.#put(`shuffle:${k}:${from}:${msg.i}`, from, () => part(msg, () => {
          if (typeof msg.d !== "string" || msg.d.length > PART_CHARS) throw new TypeError("bad part");
          return msg.d;
        }));
      case "shares":
        return this.#put(`shares:${k}:${from}:${msg.i}`, from, () => part(msg, () => {
          if (!Array.isArray(msg.d) || msg.d.length > PART_SHARES) throw new TypeError("bad shares");
          return msg.d.map((d) => bytes(d, { exact: SHARE_BYTES }));
        }));
      case "seal":
        return this.#put(`seal:${k}:${from}:${msg.i}`, from, () => part(msg, () => {
          if (!Array.isArray(msg.d) || msg.d.length > this.#sealsPerPart()) throw new TypeError("bad seals");
          return msg.d.map((d) => bytes(d, { max: this.#sealedMax() }));
        }, MAX_SEAL_PARTS));
      case "audit":
        return this.#put(`audit:${from}`, from, () => ({ key: bytes(msg.key, { exact: SECRET_BYTES }), seal: bytes(msg.seal, { exact: SEAL_SECRET_BYTES }) }));
      case "unseal":
        return this.#put(`unseal:${from}`, from, () => bytes(msg.key, { exact: SEAL_SECRET_BYTES }));
      default:
        this.#enqueue(() => this.#handle(msg, from));
    }
  }

  // seat: who broke the rules or stopped the match; about: whom their reason names.
  abort(reason, seat, about) {
    if (this.phase === "aborted") return;
    this.phase = "aborted";
    this.busy = null;
    this.abortReason = reason;
    this.abortSeat = seat;
    this.abortAbout = about;
    const err = new FairPlayError(reason);
    for (const w of this.waiters.values()) w.reject(err);
    this.waiters.clear();
    this.srReady.then((sr) => sr.abort(err));
    this.emit("abort", { reason, seat, about });
    this.emit("update");
  }

  #enqueue(step) {
    const run = this.queue.then(async () => {
      if (this.phase === "aborted") return;
      this.working = true;
      try {
        await step();
      } catch (err) {
        if (this.phase === "aborted") return;
        // Always tell the others, or they would wait forever.
        this.send({ t: "abort", reason: err.message, about: err.seat, ...(err.dispute ? { dispute: err.dispute } : {}) });
        if (err.dispute) {
          this.#stopForDispute({ k: err.dispute, giver: err.seat, receiver: this.me, reason: err.message });
        } else if (err instanceof FairPlayError || err?.name === "RuleError") {
          this.abort(err.message, err.seat);
        } else {
          console.error(err);
          this.abort(`Unexpected error: ${err.message}`);
        }
      } finally {
        this.working = false;
        this.emit("update");
      }
    });
    this.queue = run;
    return run;
  }

  // Messages a later step reads: hellos, shuffles, shares and audit keys.
  #put(key, from, parse) {
    let value;
    try {
      value = parse();
    } catch {
      return this.phase === "aborted" || this.#cheat(`sent a malformed ${key.split(":")[0]} message`, from);
    }
    if (this.seen.has(key)) return this.#cheat(`sent the same ${key.split(":")[0]} message twice`, from);
    this.seen.add(key);
    const waiter = this.waiters.get(key);
    if (waiter) {
      this.waiters.delete(key);
      return waiter.resolve(value);
    }
    if ((this.ahead[from] ?? 0) >= MAX_AHEAD) return this.#cheat("sent too many messages ahead", from);
    this.ahead[from] = (this.ahead[from] ?? 0) + 1;
    this.inbox.set(key, { value, from });
  }

  // stopped: still wait once the match has stopped (a dispute's keys).
  #wait(key, stopped = false) {
    if (this.phase === "aborted" && !stopped) return Promise.reject(new FairPlayError(this.abortReason));
    if (this.inbox.has(key)) {
      const { value, from } = this.inbox.get(key);
      this.inbox.delete(key);
      this.ahead[from]--;
      return Promise.resolve(value);
    }
    return new Promise((resolve, reject) => this.waiters.set(key, { resolve, reject }));
  }

  // Sends items (a string's characters or an array's entries) in parts of `size`.
  #sendParts(msg, items, size) {
    const n = Math.max(1, Math.ceil(items.length / size));
    for (let i = 0; i < n; i++) this.send({ ...msg, i, n, d: items.slice(i * size, (i + 1) * size) });
  }

  // Waits for every part of `key` from `seat`; resolves to each part's data, in order.
  async #waitParts(key, seat) {
    const parts = [await this.#wait(`${key}:0`)];
    for (let i = 1; i < parts[0].n; i++) parts.push(await this.#wait(`${key}:${i}`));
    if (parts.some((p) => p.n !== parts[0].n)) throw new Cheat("sent parts that don't add up", seat);
    return parts.map((p) => p.d);
  }

  #cheat(reason, seat) {
    if (this.phase === "aborted") return;
    this.send({ t: "abort", reason, about: seat });
    this.abort(reason, seat);
  }

  // A deck job. Once the match is stopped, its result is dropped and the step ends.
  async #job(op, ...args) {
    const value = await this.deck[op](...args);
    if (this.phase === "aborted") throw new FairPlayError(this.abortReason);
    return value;
  }

  // Runs a deck job whose input came from `seat`; a bad input is their fault.
  async #check(seat, what, job) {
    try {
      return await job();
    } catch (err) {
      if (err instanceof DeckError) throw new Cheat(`sent ${what} that doesn't check out${err.crashed ? " (it crashed the deck)" : ""}`, seat);
      throw err;
    }
  }

  #busy(what) {
    if (this.busy === what) return;
    this.busy = what;
    this.emit("update");
  }

  // Binds a seat's keys to this match: its match number, seat, fresh chain tip and seal key.
  #context(seat, tip, sealKey) {
    return `ddp-cards/2/m${this.m}/seat${seat}/${tip}/${toBase64(sealKey)}`;
  }

  #table(slots, face) {
    return new Table({ slots, players: this.players, face, make: newSlot });
  }

  #liveTable() {
    return this.#table(this.slots, (id) => (this.slots[id].open ? this.slots[id].face : null));
  }

  async #setup() {
    const sr = await this.srReady;
    this.sealKey = await sealKeys();
    this.key = await this.#job("keygen", this.#context(this.me, sr.tip, this.sealKey.public));
    this.send({ t: "hello", tip: sr.tip, key: toBase64(this.key.hello), seal: toBase64(this.sealKey.public) });
    const hellos = [];
    for (let s = 0; s < this.players; s++) hellos[s] = s === this.me ? { tip: sr.tip, hello: this.key.hello, seal: this.sealKey.public } : await this.#wait(`hello:${s}`);
    // The seal key is in the proof's context, so the two keys can't be swapped apart.
    this.contexts = hellos.map((h, s) => this.#context(s, h.tip, h.seal));
    try {
      ({ joint: this.joint, pks: this.pks } = await this.#job("joinKeys", hellos.map((h, s) => ({ hello: h.hello, context: this.contexts[s] }))));
    } catch (err) {
      if (err instanceof DeckError && isSeat(err.at, this.players)) throw new Cheat(`sent a key that doesn't check out: ${err.message}`, err.at);
      throw err;
    }
    this.sealPks = [];
    for (let s = 0; s < this.players; s++) {
      if (s === this.me) this.sealPks[s] = this.sealKey.publicKey;
      else this.sealPks[s] = await sealPublic(hellos[s].seal).catch(() => Promise.reject(new Cheat("sent a key that doesn't check out: bad seal key", s)));
    }
    sr.setPeers(hellos.map((h) => h.tip), this.me);
    const rng = await sr.draw((k, v) => this.send({ t: "draw", k, v }));
    this.first = Math.floor(rng() * this.players);

    this.#busy("shuffling");
    const cards = await this.#shuffleRound(await this.#job("newDeck", this.rules.deckSize));
    const table = this.#liveTable();
    table.cards = cards.map((card) => this.slots.push({ ...newSlot(), card }) - 1);
    this.state = this.rules.newState(this.first, this.players, table);
    await this.#runOps(table.ops);
    await this.#settle();
    this.phase = "playing";
    this.busy = null;
    this.emit("start", { first: this.first });
    this.#checkOver();
  }

  // Every seat in turn shuffles the cards; I check everyone else's proof.
  async #shuffleRound(cards) {
    const k = ++this.k;
    for (let s = 0; s < this.players; s++) {
      if (s === this.me) {
        const out = await this.#job("shuffle", this.joint, this.key.secret, cards);
        this.#sendParts({ t: "shuffle", k }, toBase64(out.proof), PART_CHARS);
        cards = out.cards;
      } else {
        let proof;
        try {
          proof = fromBase64((await this.#waitParts(`shuffle:${k}:${s}`, s)).join(""));
        } catch (err) {
          throw err instanceof Cheat ? err : new Cheat("sent a malformed shuffle", s);
        }
        cards = await this.#check(s, "a shuffle", () => this.#job("verifyShuffle", this.joint, s, cards, proof));
      }
    }
    return cards;
  }

  // Every seat sends its shares, even none, and its sealed passes; checks the others' (see ARCHITECTURE.md).
  async #shareRound(all) {
    const k = ++this.k;
    // A passed card needs every share that isn't public, but the receiver's own.
    const passes = all.filter((op) => op.type === "pass").map((op) => ({ ...op, k, card: this.slots[op.slot].card, need: this.#missing(op.slot).filter((s) => s !== op.to) }));
    const sealed = passes.filter((p) => p.need.length);
    const ops = all.filter((op) => op.type !== "pass");
    const helps = (seat, op) => op.type === "open" || op.to !== seat;
    const mine = ops.filter((op) => helps(this.me, op));
    const shares = mine.length ? await this.#job("shares", this.key.secret, mine.map((op) => this.slots[op.slot].card)) : [];
    mine.forEach((op, i) => (this.slots[op.slot].shares[this.me] = shares[i]));
    this.#sendParts({ t: "shares", k }, shares.map(toBase64), PART_SHARES);
    const mySeals = sealed.filter((p) => p.from === this.me);
    for (const p of mySeals) p.envelope = await this.#sealPass(p);
    if (mySeals.length) this.#sendParts({ t: "seal", k }, mySeals.map((p) => toBase64(p.envelope)), this.#sealsPerPart());
    for (let s = 0; s < this.players; s++) {
      if (s === this.me) continue;
      const theirs = ops.filter((op) => helps(s, op));
      const shares = (await this.#waitParts(`shares:${k}:${s}`, s)).flat();
      if (shares.length !== theirs.length) throw new Cheat(`sent ${shares.length} shares where ${theirs.length} were due`, s);
      if (!theirs.length) continue;
      const items = theirs.map((op, i) => ({ card: this.slots[op.slot].card, pk: this.pks[s], share: shares[i] }));
      await this.#check(s, "a share", () => this.#job("verifyShares", this.joint, items));
      theirs.forEach((op, i) => (this.slots[op.slot].shares[s] = shares[i]));
    }
    for (let s = 0; s < this.players; s++) {
      const theirs = sealed.filter((p) => p.from === s);
      if (s === this.me || !theirs.length) continue;
      const envelopes = (await this.#waitParts(`seal:${k}:${s}`, s)).flat();
      if (envelopes.length !== theirs.length) throw new Cheat(`sent ${envelopes.length} sealed cards where ${theirs.length} were due`, s);
      theirs.forEach((p, i) => (p.envelope = envelopes[i]));
    }
    this.sealed.push(...sealed);
    this.sealedRound = k;
    if (this.dispute && this.dispute.k <= k) {
      this.#stopForDispute(this.dispute);
      throw new FairPlayError(this.abortReason);
    }
    for (const op of ops) {
      const slot = this.slots[op.slot];
      slot.pub = this.#seats(op.type === "deal" ? op.to : -1);
      if (op.type === "deal" && op.to !== this.me) continue;
      if (op.type === "deal") [slot.shares[this.me]] = await this.#job("shares", this.key.secret, [slot.card]);
      slot.face = await this.#job("open", this.joint, slot.card, slot.shares.map((share, s) => ({ pk: this.pks[s], share })));
    }
    for (const p of passes) if (p.to === this.me) await this.#receivePass(p);
  }

  // By seat: true for every seat but `but`.
  #seats(but) {
    return Array.from({ length: this.players }, (_, s) => s !== but);
  }

  // The seats whose share of a slot hasn't gone to everyone.
  #missing(id) {
    const { pub } = this.slots[id];
    return Array.from({ length: this.players }, (_, s) => s).filter((s) => !pub[s]);
  }

  #sealedMax() {
    return sealedBytes((this.players - 1) * SHARE_BYTES);
  }

  #sealsPerPart() {
    return Math.max(1, Math.floor(PART_CHARS / (4 * Math.ceil(this.#sealedMax() / 3))));
  }

  // Where an envelope belongs, which its key is bound to.
  #sealContext(p) {
    return `ddp-seal/m${this.m}/k${p.k}/slot${p.slot}/${p.from}-${p.to}`;
  }

  // My shares of a card I pass, and those sealed to me, sealed to its receiver.
  async #sealPass(p) {
    const slot = this.slots[p.slot];
    if (p.need.includes(this.me) && !slot.shares[this.me]) [slot.shares[this.me]] = await this.#job("shares", this.key.secret, [slot.card]);
    const envelope = await this.seals.seal(this.sealKey.privateKey, this.sealPks[p.to], this.#sealContext(p), concat(p.need.map((s) => slot.shares[s])));
    if (this.phase === "aborted") throw new FairPlayError(this.abortReason);
    return envelope;
  }

  // A sealed card's shares, opened with either side's key and checked; null if they don't check out.
  async #opens(p, privateKey, publicKey) {
    try {
      const plain = await this.seals.unseal(privateKey, publicKey, this.#sealContext(p), p.envelope);
      if (plain.length !== p.need.length * SHARE_BYTES) return null;
      const shares = p.need.map((_, i) => plain.slice(i * SHARE_BYTES, (i + 1) * SHARE_BYTES));
      await this.deck.verifyShares(this.joint, p.need.map((s, i) => ({ card: p.card, pk: this.pks[s], share: shares[i] })));
      return shares;
    } catch (err) {
      if (err instanceof SealError || err instanceof DeckError) return null;
      throw err;
    }
  }

  // A card passed to me: open the giver's envelope, check it and read the card.
  async #receivePass(p) {
    const slot = this.slots[p.slot];
    if (p.need.length) {
      const shares = await this.#opens(p, this.sealKey.privateKey, this.sealPks[p.from]);
      if (this.phase === "aborted") throw new FairPlayError(this.abortReason);
      if (!shares) throw new Cheat("passed a card that doesn't check out", p.from, p.k);
      p.need.forEach((s, i) => (slot.shares[s] = shares[i]));
    }
    if (!slot.shares[this.me]) [slot.shares[this.me]] = await this.#job("shares", this.key.secret, [slot.card]);
    slot.face = await this.#job("open", this.joint, slot.card, slot.shares.map((share, s) => ({ pk: this.pks[s], share })));
  }

  // A receiver says a sealed card is bad. Stop once we've recorded that step, so we can judge it.
  #disputed(d) {
    if (this.sealedRound >= d.k) this.#stopForDispute(d);
    else if (!this.dispute || d.k < this.dispute.k) this.dispute = d; // a made-up later step can't hide a real one
  }

  #stopForDispute({ k, giver, receiver, reason }) {
    this.dispute = null;
    const envelopes = this.sealed.filter((p) => p.k === k && p.from === giver && p.to === receiver);
    this.disputing = envelopes.length > 0;
    this.abort(reason, receiver === this.me ? giver : receiver, receiver === this.me ? undefined : giver);
    if (this.disputing) this.#settleDispute(envelopes, giver, receiver).catch((err) => console.error(err));
    else {
      this.verdict = { ok: false, reason: "said a passed card didn't check out, but none was passed to them", seat: receiver };
      this.emit("verified", this.verdict);
    }
  }

  // The giver and the receiver reveal their seal keys; either one that checks out opens the envelopes.
  async #settleDispute(envelopes, giver, receiver) {
    const parties = [giver, receiver];
    let key, other;
    if (parties.includes(this.me)) {
      this.send({ t: "unseal", key: toBase64(await sealSecret(this.sealKey)) });
      key = this.sealKey.privateKey;
      other = this.sealPks[this.me === giver ? receiver : giver];
    } else {
      try {
        ({ key, other } = await Promise.any(
          parties.map(async (s) => {
            const found = await revealedKey(await this.#wait(`unseal:${s}`, true), this.sealPks[s], this.sealKey);
            if (!found) throw new Error("not their key");
            return { key: found, other: this.sealPks[s === giver ? receiver : giver] };
          }),
        ));
      } catch {
        this.disputing = false; // neither revealed a key that checks out: no verdict
        return void this.emit("update");
      }
    }
    const opened = await Promise.all(envelopes.map((p) => this.#opens(p, key, other)));
    this.verdict = opened.every(Boolean)
      ? { ok: false, reason: "said a passed card didn't check out, but it did", seat: receiver }
      : { ok: false, reason: "passed a card that doesn't check out", seat: giver };
    this.emit("verified", this.verdict);
    this.emit("update");
  }

  async #runOps(ops) {
    for (let i = 0; i < ops.length; ) {
      if (ops[i].type === "shuffle") {
        const { from, into } = ops[i++];
        this.#busy("shuffling");
        const cards = await this.#shuffleRound(from.map((id) => this.slots[id].card));
        into.forEach((id, j) => (this.slots[id].card = cards[j]));
      } else {
        const batch = [];
        while (i < ops.length && ops[i].type !== "shuffle") batch.push(ops[i++]);
        this.#busy("dealing");
        await this.#shareRound(batch);
      }
    }
  }

  async #settle() {
    if (!this.rules.settle) return;
    for (let round = 0; round < MAX_SETTLE; round++) {
      const table = this.#liveTable();
      const events = this.rules.settle(this.state, table) ?? [];
      if (events.length) this.emit("events", { player: -1, move: null, events });
      if (!table.ops.length) return;
      await this.#runOps(table.ops);
    }
    throw new RuleError("settle kept dealing");
  }

  // The hidden cards from the player's hand that this move shows.
  #reveals(state, player, move) {
    const ids = this.rules.reveals?.(state, player, move) ?? [];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new RuleError("bad reveals");
    for (const id of ids) {
      const s = Number.isInteger(id) ? this.slots[id] : undefined;
      if (!s || s.gone || s.owner !== player) throw new RuleError("a move can only show cards from your own hand");
    }
    const hidden = ids.filter((id) => !this.slots[id].open);
    if (hidden.length > MAX_REVEALS) throw new RuleError(`a move can show at most ${MAX_REVEALS} hidden cards`);
    if (hidden.reduce((n, id) => n + this.#missing(id).length, 0) > MAX_REVEALS) throw new RuleError(`a move can carry at most ${MAX_REVEALS} shares`);
    return hidden;
  }

  async #handle(msg, from) {
    if (msg.t !== "move") throw new Cheat(`sent an unknown message ${String(msg.t).slice(0, 20)}`, from);
    if (this.phase !== "playing") throw new Cheat("moved outside play", from);
    if (this.state.turn !== from) throw new Cheat("moved out of turn", from);
    let shown;
    try {
      shown = this.#reveals(this.state, from, msg.move);
    } catch (err) {
      if (err?.name === "RuleError") throw new Cheat(`broke the rules: ${err.message}`, from);
      throw err;
    }
    let shares;
    try {
      if (!Array.isArray(msg.sh) || msg.sh.length !== shown.reduce((n, id) => n + this.#missing(id).length, 0)) throw new TypeError();
      shares = msg.sh.map((d) => bytes(d, { exact: SHARE_BYTES }));
    } catch {
      throw new Cheat("sent a move without the shares for the cards it shows", from);
    }
    await this.#apply(from, msg.move, shown, shares);
  }

  // shares: for each card shown, one for every seat whose share isn't public yet.
  async #apply(player, move, shown, shares) {
    let next = 0;
    for (const id of shown) {
      const slot = this.slots[id];
      for (const s of this.#missing(id)) slot.shares[s] = shares[next++];
      if (player !== this.me) {
        const all = slot.shares.map((share, s) => ({ pk: this.pks[s], share }));
        slot.face = await this.#check(player, "a share", () => this.#job("open", this.joint, slot.card, all));
      }
      slot.pub = this.#seats(-1);
      slot.open = true;
    }
    const table = this.#liveTable();
    let events;
    try {
      events = this.rules.applyMove(this.state, player, move, table);
    } catch (err) {
      if (err?.name === "RuleError") throw new Cheat(`broke the rules: ${err.message}`, player);
      throw err;
    }
    this.log.push({ player, move: structuredClone(move) });
    this.emit("events", { player, move, events });
    await this.#runOps(table.ops);
    await this.#settle();
    this.busy = null;
    this.#checkOver();
  }

  #checkOver() {
    if (this.phase !== "playing" || this.state.winner === -1) return;
    this.phase = "over";
    this.emit("over", { winner: this.state.winner });
    this.#enqueue(() => this.#audit());
  }

  async #audit() {
    this.#busy("auditing");
    this.send({ t: "audit", key: toBase64(this.key.secret), seal: toBase64(await sealSecret(this.sealKey)) });
    const secrets = [];
    for (let s = 0; s < this.players; s++) secrets[s] = s === this.me ? { key: this.key.secret } : await this.#wait(`audit:${s}`);
    const faces = [];
    const verdict = await this.#judge(secrets, faces);
    if (this.phase === "aborted") return;
    this.verdict = verdict;
    if (this.verdict.ok) this.audited = faces;
    this.busy = null;
    this.emit("verified", this.verdict);
  }

  // Fills `faces` with every slot's face once the keys check out.
  async #judge(secrets, faces) {
    const openers = [];
    for (let s = 0; s < this.players; s++) {
      if (s === this.me) {
        openers[s] = this.sealKey.privateKey;
        continue;
      }
      if (!(await this.#job("checkSecret", secrets[s].key, this.contexts[s], this.pks[s]))) return { ok: false, reason: "revealed a key that isn't the one they played with", seat: s };
      openers[s] = await revealedKey(secrets[s].seal, this.sealPks[s], this.sealKey);
      if (!openers[s]) return { ok: false, reason: "revealed a key that isn't the one they played with", seat: s };
    }
    // Every sealed card, opened with its giver's key: a receiver could only check its own.
    for (const p of this.sealed) if (!(await this.#opens(p, openers[p.from], this.sealPks[p.to]))) return { ok: false, reason: "passed a card that doesn't check out", seat: p.from };
    const unknown = this.slots.flatMap((slot, id) => (slot.face === null ? [id] : []));
    const found = await this.#job("faces", this.joint, secrets.map((s) => s.key), unknown.map((id) => this.slots[id].card));
    faces.push(...this.slots.map((slot) => slot.face));
    unknown.forEach((id, i) => (faces[id] = found[i]));
    const first = faces.slice(0, this.rules.deckSize);
    if (new Set(first).size !== first.length || first.some((f) => !(f >= 0 && f < this.rules.deckSize))) return { ok: false, reason: "the deck wasn't one full deck" };
    return this.#replay(faces);
  }

  // The whole game again, with every face known to the rules.
  #replay(faces) {
    const slots = [];
    const table = () => new Table({ slots, players: this.players, face: (id) => faces[id], make: () => ({ owner: -1, open: false, gone: false }) });
    const settle = () => {
      for (let round = 0; this.rules.settle; round++) {
        if (round === MAX_SETTLE) throw new RuleError("settle kept dealing");
        const t = table();
        this.rules.settle(state, t);
        if (!t.ops.length) return;
      }
    };
    const start = table();
    start.cards = faces.slice(0, this.rules.deckSize).map(() => slots.push({ owner: -1, open: false, gone: false }) - 1);
    let state;
    try {
      state = this.rules.newState(this.first, this.players, start);
      settle();
    } catch (err) {
      return { ok: false, reason: `the deal broke the rules: ${err.message}` };
    }
    for (const { player, move } of this.log) {
      try {
        for (const id of this.rules.reveals?.(state, player, move) ?? []) slots[id].open = true;
        this.rules.applyMove(state, player, move, table());
        settle();
      } catch (err) {
        return { ok: false, reason: `broke the rules: ${err.message}`, seat: player };
      }
    }
    if (JSON.stringify(state) !== JSON.stringify(this.state)) return { ok: false, reason: "the game plays out differently with every card known" };
    return { ok: true };
  }
}

// Drive a robot over a session for a CardMatch game. choose(state, me, rng,
// face) returns a legal move; face(slot) is what this seat knows.
export function startCardRobot(session, { rules, choose, delay = 600, rng = Math.random }) {
  const router = matchRouter(session);
  let match = null;
  let timer = null;
  let destroyed = false;
  function schedule() {
    if (destroyed || timer || !match.canMove()) return;
    timer = setTimeout(() => {
      timer = null;
      if (!destroyed && match.canMove()) match.play(choose(match.state, match.me, rng, (slot) => match.face(slot)));
    }, robotPause(delay));
  }
  function newMatch(m) {
    match = new CardMatch({ send: (msg) => session.send(msg), me: session.index, players: session.players.length, rules, m });
    match.on("update", schedule);
    router.start(match);
  }
  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
