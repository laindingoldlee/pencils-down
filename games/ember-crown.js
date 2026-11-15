'use strict';
/*
 * The Ember Crown: a deduction game for 3–4 players, played inside a party room.
 *
 * 18 Adventurer cards: five 0s (Apprentice), five 1s (Warrior), and one each of 2–9.
 * Optional Ember Wraith ("10"): counts as both a 0 and a 1 when guessing a hand.
 *
 * Each round: 4 cards each, 2 face down in the center. With 3 players, 4 cards are
 * removed and shown to everyone first. With the Wraith, one card is removed and shown
 * to everyone before that.
 *
 * On your turn: scout the center, play an Adventurer (needs 2+ cards, except the
 * Plague Doctor), or challenge a rival by naming their whole hand. A correct challenge
 * knocks them out and scores their hand size, and you may challenge again.
 * The round ends when one player is left (or the Water Goddess wins it).
 *
 * House rulings agreed with the designer:
 *  - Duelist: three whole-hand guesses, each answered right or wrong. No knock-out.
 *  - Doomblade: discards go face up to a public discard pile.
 *  - Warrior: if nobody holds the number, nothing happens. Otherwise you pick the card
 *    to give back (it can be the one you just took).
 *  - Apprentice: each chosen player picks the card they give.
 *  - Water Goddess wins automatically at the start of your turn. Playing it does nothing.
 *  - Plague Doctor stays face up in front of you; you take back your other played cards.
 *  - Wraith counts as 10 (or 1, host's choice) toward the Barbarian's "more than 10".
 *  - Plague Doctor: if putting a card back would leave you with none, you keep it.
 *  - A tie at the top after someone reaches the target: keep playing rounds.
 *
 * Secret information stays on the server: each player is only sent the cards they're
 * allowed to see. Log entries can carry a private part shown only to certain players.
 */
const crypto = require('crypto');

const WRAITH = 10;
const AWAY_MS = 20000;        // a disconnected player's choices are made for them after this long
const ROUND_END_MS = 15000;   // how long the round's reveal stays up
const MAX_GUESS = 8;

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Ember Crown error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pickRandom = a => a[crypto.randomInt(a.length)];
const nums = cards => cards.map(c => c.n).sort((a, b) => a - b);

/* ---------- settings ---------- */
const defaults = () => ({
  mode: 'renown',     // 'renown': first to `target`; 'last': last adventurer standing, count round wins
  target: 15,
  rounds: 5,          // for 'last' mode
  wraith: false,
  wraithTotal: 10     // what the Wraith adds to a hand's total for the Barbarian: 10 or 1
});
function cleanSettings(p, base) {
  const s = Object.assign({}, base);
  if (p.mode === 'renown' || p.mode === 'last') s.mode = p.mode;
  if (p.target !== undefined) s.target = clampInt(p.target, 5, 40, s.target);
  if (p.rounds !== undefined) s.rounds = clampInt(p.rounds, 1, 15, s.rounds);
  if (typeof p.wraith === 'boolean') s.wraith = p.wraith;
  if (p.wraithTotal === 10 || p.wraithTotal === 1) s.wraithTotal = p.wraithTotal;
  return s;
}
function canStart(s, players) {
  if (players > 4) return `The Ember Crown is for 3 or 4 players. ${players} are here; anyone extra can wait in the room.`;
  return null;
}

/* ---------- card rules ---------- */
// The numbers a card stands for when someone names a hand.
const named = c => (c.n === WRAITH ? [0, 1] : [c.n]);
const handTotal = (g, cards) => cards.reduce((a, c) => a + (c.n === WRAITH ? g.s.wraithTotal : c.n), 0);
function guessMatches(cards, guess) {
  const want = cards.flatMap(named).sort((a, b) => a - b);
  const got = guess.slice().sort((a, b) => a - b);
  return want.length === got.length && want.every((v, i) => v === got[i]);
}
function cleanGuess(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_GUESS) return null;
  const g = raw.map(Number);
  return g.every(n => Number.isInteger(n) && n >= 0 && n <= 9) ? g : null;
}

/* ---------- game ---------- */
function start(ctx, settings) {
  const order = ctx.onlineIds().slice(0, 4);   // seats go clockwise in the order people joined
  const g = {
    id: 'ember', ctx, s: Object.assign({}, settings), order,
    scores: Object.fromEntries(order.map(p => [p, 0])),
    wins: Object.fromEntries(order.map(p => [p, 0])),
    round: 0, starter: pickRandom(order), nextId: 1,
    phase: 'play', p: {}, center: [], removed: [], hidden: null, discard: [],
    turn: null, log: [], logSeq: 0, summary: null, winners: null, timer: null, awayTimer: null, nextRoundAt: 0
  };
  startRound(g);
  return g;
}
function clear(g) {
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
}
function stop(g) { clear(g); }
/* A log entry. `see` lists players who also get the `secret` part. */
function log(g, e, see, secret) {
  g.logSeq += 1;
  g.log.push(Object.assign({ seq: g.logSeq, round: g.round }, e, see ? { see, secret } : {}));
  if (g.log.length > 200) g.log.shift();
}

function startRound(g) {
  clear(g);
  g.round += 1;
  const deck = [];
  for (let k = 0; k < 5; k++) deck.push(0, 1);
  for (let n = 2; n <= 9; n++) deck.push(n);
  if (g.s.wraith) deck.push(WRAITH);
  const cards = shuffle(deck.map(n => ({ id: g.nextId++, n })));
  g.removed = [];
  if (g.s.wraith) g.removed.push(cards.shift());
  if (g.order.length === 3) g.removed.push(...cards.splice(0, 4));
  g.p = {};
  for (const pid of g.order) g.p[pid] = { hand: cards.splice(0, 4), played: [], alive: true, hadTurn: false };
  g.center = cards.splice(0, 2);
  g.discard = [];
  g.summary = null;
  log(g, { k: 'round', n: g.round, removed: nums(g.removed) });
  g.phase = 'play';
  startTurn(g, g.starter);
}

const alive = g => g.order.filter(pid => g.p[pid].alive);
const rivals = (g, pid) => alive(g).filter(p => p !== pid);

/* ---------- turns ---------- */
function startTurn(g, pid) {
  const me = g.p[pid];
  const first = !me.hadTurn;
  me.hadTurn = true;
  g.turn = { pid, step: 'choose', first };
  // Water Goddess: begin your turn holding only her and you win the round.
  if (me.hand.length === 1 && me.hand[0].n === 9) {
    const pts = rivals(g, pid).reduce((a, p) => a + g.p[p].hand.length, 0);
    log(g, { k: 'goddess', pid, pts });
    g.ctx.fx({ type: 'goddess', pid, pts });
    return endRound(g, 'goddess', pid, pts);
  }
  watchAway(g);
  g.ctx.broadcast();
}
function endTurn(g) {
  if (g.phase !== 'play') return;
  const live = alive(g);
  if (live.length <= 1) return endRound(g, 'last', live[0], 0);
  let i = g.order.indexOf(g.turn.pid);
  for (let k = 0; k < g.order.length; k++) {
    i = (i + 1) % g.order.length;
    if (g.p[g.order[i]].alive) return startTurn(g, g.order[i]);
  }
}
function eliminate(g, pid, by, how) {
  const P = g.p[pid];
  P.alive = false;
  const size = P.hand.length;
  log(g, { k: 'out', pid, by, how, hand: nums(P.hand), size });
  g.ctx.fx({ type: 'out', pid, by, how });
  return size;
}

/* Who the game is waiting on right now. */
function waitingOn(g) {
  const t = g.turn;
  if (g.phase !== 'play' || !t) return [];
  if (t.step === 'apprentice') return t.pair.filter(p => !t.gives[p]);
  return [t.pid];
}
function watchAway(g) {
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  const online = g.ctx.onlineIds();
  if (!waitingOn(g).some(p => !online.includes(p))) return;
  g.awayTimer = setTimeout(safe(() => { g.awayTimer = null; autoMove(g); }), AWAY_MS);
}
/* Make a harmless move for anyone who has dropped out, until we're waiting on someone present. */
function autoMove(g) {
  for (let guard = 0; guard < 40; guard++) {
    const online = g.ctx.onlineIds();
    const away = waitingOn(g).filter(p => !online.includes(p));
    if (!away.length) break;
    const pid = away[0], t = g.turn, hand = g.p[pid].hand;
    const step = t.step;
    if (step === 'choose') act(g, pid, { a: 'scout', slot: 0 });
    else if (step === 'scout') act(g, pid, { a: 'return' });
    else if (step === 'apprentice') act(g, pid, { a: 'give', id: pickRandom(hand).id });
    else if (step === 'pair') act(g, pid, { a: 'targets', pids: shuffle(rivals(g, pid)).slice(0, 2) });
    else if (step === 'name') act(g, pid, { a: 'name', n: 2 + crypto.randomInt(8) });
    else if (step === 'warrior') act(g, pid, { a: 'give', id: pickRandom(hand).id });
    else if (step === 'duelTarget' || step === 'duel' || step === 'chain') act(g, pid, { a: 'done' });
    else if (step === 'bury') act(g, pid, { a: 'bury', id: pickRandom(hand).id });
    else break;
  }
  watchAway(g);
  g.ctx.broadcast();
}

/* ---------- abilities ---------- */
function playCard(g, pid, card) {
  const me = g.p[pid], t = g.turn;
  me.hand.splice(me.hand.indexOf(card), 1);
  me.played.push(card);
  log(g, { k: 'play', pid, n: card.n });
  g.ctx.fx({ type: 'play', pid, n: card.n });
  const others = rivals(g, pid);
  switch (card.n) {
    case 0: // Apprentice
      if (others.length < 2) { log(g, { k: 'fizzle', pid, n: 0 }); return endTurn(g); }
      if (others.length === 2) return pairUp(g, pid, others);
      t.step = 'pair'; return;
    case 1: t.step = 'name'; return; // Warrior
    case 2: { // Barbarian
      const big = others.filter(p => handTotal(g, g.p[p].hand) > 10);
      log(g, { k: 'barbarian', pid, shown: big }, [pid], { hands: Object.fromEntries(big.map(p => [p, nums(g.p[p].hand)])) });
      return endTurn(g);
    }
    case 3: t.step = 'duelTarget'; t.left = 3; return; // Duelist
    case 4: case 5: { // Shadow Hunter, Princess Knight
      const keep = card.n === 4 ? (c => c.n >= 5 && c.n <= 9) : (c => [2, 4, 6, 8].includes(c.n));
      log(g, { k: card.n === 4 ? 'hunter' : 'knight', pid }, [pid],
        { hands: Object.fromEntries(others.map(p => [p, nums(g.p[p].hand.filter(keep))])) });
      return endTurn(g);
    }
    case 6: { // Doomblade
      const lost = {};
      for (const p of others) {
        const h = g.p[p].hand;
        const can = h.filter(c => c.n !== WRAITH);
        if (h.length < 2 || !can.length) continue;
        const low = can.reduce((a, c) => (c.n < a.n ? c : a));
        h.splice(h.indexOf(low), 1);
        g.discard.push(low);
        lost[p] = low.n;
      }
      log(g, { k: 'doom', pid, lost });
      return endTurn(g);
    }
    case 7: { // Spirit Caller
      const hit = others.filter(p => g.p[p].hand.filter(c => c.n === 0).length === 2);
      let pts = 0;
      log(g, { k: 'spirit', pid, hit });
      for (const p of hit) pts += eliminate(g, p, pid, 'spirit');
      if (pts) { g.scores[pid] += pts; log(g, { k: 'score', pid, pts }); }
      return endTurn(g);
    }
    case 8: { // Plague Doctor
      const back = me.played.filter(c => c !== card);
      me.played = [card];
      const fromCenter = g.center.splice(0);
      me.hand.push(...back, ...fromCenter);
      log(g, { k: 'plague', pid, back: nums(back), center: fromCenter.length }, [pid], { got: nums(fromCenter) });
      // You never put back your last card: a hand can't be empty.
      if (me.hand.length < 2) { log(g, { k: 'noBury', pid }); return endTurn(g); }
      t.step = 'bury'; return;
    }
    default: // Water Goddess, Ember Wraith: no effect when played
      return endTurn(g);
  }
}
function pairUp(g, pid, pair) {
  const t = g.turn;
  t.step = 'apprentice'; t.pair = pair; t.gives = {};
  log(g, { k: 'pair', pid, a: pair[0], b: pair[1] });
}
function finishApprentice(g) {
  const t = g.turn, [a, b] = t.pair;
  const ca = t.gives[a], cb = t.gives[b];
  const ha = g.p[a].hand, hb = g.p[b].hand;
  ha.splice(ha.indexOf(ca), 1); hb.splice(hb.indexOf(cb), 1);
  ha.push(cb); hb.push(ca);
  log(g, { k: 'swapped', pid: t.pid, a, b }, [a, b], { [a]: { gave: ca.n, got: cb.n }, [b]: { gave: cb.n, got: ca.n } });
  endTurn(g);
}
/* A challenge or Duelist guess. Returns true if right. */
function judge(g, pid, target, guess, duel) {
  const right = guessMatches(g.p[target].hand, guess);
  log(g, { k: duel ? 'duelGuess' : 'challenge', pid, target, guess: guess.slice().sort((a, b) => a - b), right });
  g.ctx.fx({ type: duel ? 'duel' : 'challenge', pid, target, right });
  return right;
}

/* ---------- moves ---------- */
function pick(g, pid, p) {
  if (g.phase !== 'play' || !g.turn) return { ok: false };
  const r = act(g, pid, p);
  if (r.ok) { watchAway(g); g.ctx.broadcast(); }
  return r;
}
const bad = error => ({ ok: false, error });
function act(g, pid, p) {
  const t = g.turn;
  const me = g.p[pid];
  if (!me) return bad('You’re watching this game.');
  const findCard = id => me.hand.find(c => c.id === Number(id));

  // The two players picked by an Apprentice choose at the same time, on someone else's turn.
  if (t.step === 'apprentice') {
    if (!t.pair.includes(pid) || t.gives[pid] || p.a !== 'give') return bad('Waiting for the Apprentice’s swap.');
    const c = findCard(p.id);
    if (!c) return bad('Pick one of your cards.');
    t.gives[pid] = c;
    if (t.pair.every(x => t.gives[x])) finishApprentice(g);
    return { ok: true };
  }
  if (t.pid !== pid) return bad('It’s not your turn.');

  switch (t.step) {
    case 'choose': {
      if (p.a === 'scout') {
        if (!g.center.length) return bad('The center is empty.');
        const slot = clampInt(p.slot, 0, g.center.length - 1, 0);
        t.step = 'scout'; t.slot = slot;
        return { ok: true };
      }
      if (p.a === 'play') {
        const c = findCard(p.id);
        if (!c) return bad('Pick one of your cards.');
        if (me.hand.length < 2 && c.n !== 8) return bad('You need at least 2 cards to play one (except the Plague Doctor).');
        if (c.n === 7 && t.first) return bad('The Spirit Caller can’t be played on your first turn of the round.');
        playCard(g, pid, c);
        return { ok: true };
      }
      if (p.a === 'challenge') return challenge(g, pid, p);
      return bad('Pick an action.');
    }
    case 'scout': {
      const look = g.center[t.slot];
      if (p.a === 'swap') {
        const c = findCard(p.id);
        if (!c) return bad('Pick one of your cards to swap.');
        me.hand.splice(me.hand.indexOf(c), 1, look);
        g.center[t.slot] = c;
        log(g, { k: 'scout', pid, swapped: true }, [pid], { saw: look.n, gave: c.n });
      } else if (p.a === 'return') {
        log(g, { k: 'scout', pid, swapped: false }, [pid], { saw: look.n });
      } else return bad('Swap it for one of your cards, or put it back.');
      g.ctx.fx({ type: 'scout', pid, swapped: p.a === 'swap' });
      endTurn(g);
      return { ok: true };
    }
    case 'pair': {
      const ps = Array.isArray(p.pids) ? [...new Set(p.pids)] : [];
      const ok = rivals(g, pid);
      if (p.a !== 'targets' || ps.length !== 2 || ps.some(x => !ok.includes(x))) return bad('Pick two other players.');
      pairUp(g, pid, ps);
      return { ok: true };
    }
    case 'name': {
      const n = Number(p.n);
      if (p.a !== 'name' || !Number.isInteger(n) || n < 2 || n > 9) return bad('Name a number from 2 to 9.');
      const holder = rivals(g, pid).find(x => g.p[x].hand.some(c => c.n === n));
      log(g, { k: 'warrior', pid, n, holder: holder || null });
      if (!holder) { endTurn(g); return { ok: true }; }
      const hh = g.p[holder].hand;
      const c = hh.find(x => x.n === n);
      hh.splice(hh.indexOf(c), 1);
      me.hand.push(c);
      t.step = 'warrior'; t.holder = holder;
      return { ok: true };
    }
    case 'warrior': {
      const c = findCard(p.id);
      if (p.a !== 'give' || !c) return bad('Pick a card to give back.');
      me.hand.splice(me.hand.indexOf(c), 1);
      g.p[t.holder].hand.push(c);
      log(g, { k: 'warriorGive', pid, holder: t.holder }, [pid, t.holder], { n: c.n });
      endTurn(g);
      return { ok: true };
    }
    case 'duelTarget': {
      if (p.a === 'done') { endTurn(g); return { ok: true }; }
      if (p.a !== 'target' || !rivals(g, pid).includes(p.pid)) return bad('Pick a rival.');
      t.target = p.pid; t.step = 'duel';
      return { ok: true };
    }
    case 'duel': {
      if (p.a === 'done') { log(g, { k: 'duelStop', pid, target: t.target }); endTurn(g); return { ok: true }; }
      const guess = cleanGuess(p.guess);
      if (p.a !== 'guess' || !guess) return bad('Name a whole hand.');
      judge(g, pid, t.target, guess, true);
      t.left -= 1;
      if (t.left <= 0) endTurn(g);
      return { ok: true };
    }
    case 'chain': {
      if (p.a === 'done') { endTurn(g); return { ok: true }; }
      if (p.a === 'challenge') return challenge(g, pid, p);
      return bad('Challenge another rival or end your turn.');
    }
    case 'bury': {
      const c = findCard(p.id);
      if (p.a !== 'bury' || !c) return bad('Pick a card to put face down in the center.');
      me.hand.splice(me.hand.indexOf(c), 1);
      g.center.push(c);
      log(g, { k: 'bury', pid }, [pid], { n: c.n });
      endTurn(g);
      return { ok: true };
    }
  }
  return bad('That move isn’t possible right now.');
}
function challenge(g, pid, p) {
  const guess = cleanGuess(p.guess);
  if (!rivals(g, pid).includes(p.target)) return bad('Pick a rival who’s still in.');
  if (!guess) return bad('Name every card in their hand.');
  const t = g.turn;
  if (!judge(g, pid, p.target, guess, false)) { endTurn(g); return { ok: true }; }
  const pts = eliminate(g, p.target, pid, 'challenge');
  g.scores[pid] += pts;
  log(g, { k: 'score', pid, pts });
  if (rivals(g, pid).length === 0) { endRound(g, 'last', pid, 0); return { ok: true }; }
  t.step = 'chain';
  return { ok: true };
}

/* ---------- round end ---------- */
function endRound(g, why, winner, pts) {
  clear(g);
  if (pts) g.scores[winner] += pts;
  if (winner) g.wins[winner] += 1;
  g.starter = winner || g.starter;
  g.summary = { why, winner, pts, hands: Object.fromEntries(g.order.map(p => [p, nums(g.p[p].hand)])), center: nums(g.center) };
  g.turn = null;
  log(g, { k: 'roundEnd', n: g.round, winner, why });
  const tally = g.s.mode === 'renown' ? g.scores : g.wins;
  const best = Math.max(...g.order.map(p => tally[p]));
  const leaders = g.order.filter(p => tally[p] === best);
  const reached = g.s.mode === 'renown' ? best >= g.s.target : g.round >= g.s.rounds;
  if (reached && leaders.length === 1) {
    g.phase = 'over';
    g.winners = leaders;
  } else {
    g.phase = 'roundEnd';
    g.tiebreak = reached;
    g.nextRoundAt = Date.now() + ROUND_END_MS;
    g.timer = setTimeout(safe(() => startRound(g)), ROUND_END_MS);
  }
  g.ctx.broadcast();
}

function playersChanged(g) { if (g.phase === 'play') watchAway(g); }
function playerJoined() { /* late arrivals watch until the next game */ }

/* ---------- what each player sees ---------- */
function view(g, viewer) {
  const reveal = g.phase === 'roundEnd' || g.phase === 'over';
  const players = {};
  for (const pid of g.order) {
    const P = g.p[pid];
    const open = reveal || !P.alive || pid === viewer;
    players[pid] = {
      alive: P.alive, count: P.hand.length, played: P.played.map(c => c.n),
      hand: open ? (pid === viewer && !reveal && P.alive ? P.hand.map(c => ({ id: c.id, n: c.n })).sort((a, b) => a.n - b.n || a.id - b.id) : nums(P.hand)) : null
    };
  }
  const t = g.turn;
  let turn = null;
  if (t) {
    turn = { pid: t.pid, step: t.step, first: t.first, target: t.target || null, left: t.left || 0, holder: t.holder || null, slot: t.slot };
    if (t.step === 'apprentice') turn.pair = t.pair, turn.given = t.pair.filter(p => t.gives[p]);
    if (t.step === 'scout' && t.pid === viewer) turn.look = g.center[t.slot].n;
  }
  return {
    id: 'ember', settings: g.s, phase: g.phase, round: g.round, order: g.order,
    scores: g.scores, wins: g.wins, players, centerCount: g.center.length,
    removed: nums(g.removed), discard: g.discard.map(c => c.n),
    turn, waiting: waitingOn(g),
    log: g.log.slice(-120).map(e => {
      const out = Object.assign({}, e);
      delete out.see; delete out.secret;
      if (e.see && e.see.includes(viewer)) out.mine = e.secret;
      return out;
    }),
    summary: g.summary, nextRoundAt: g.nextRoundAt, winners: g.winners, tiebreak: !!g.tiebreak
  };
}

module.exports = {
  id: 'ember', name: 'The Ember Crown', minPlayers: 3,
  defaults, cleanSettings, canStart,
  start, stop, pick, view, playersChanged, playerJoined,
  _guessMatches: guessMatches, _startRound: startRound, _autoMove: autoMove // for tests
};
