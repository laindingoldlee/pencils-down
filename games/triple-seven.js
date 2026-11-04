'use strict';
/*
 * The Triple Seven: a hidden-card game played inside a party room.
 *
 * Everyone has a row of face-down cards (3 to start) and peeks at one of them. On your
 * turn you draw a card and either play it, or put it in place of one of your cards and
 * play that one instead. Played cards go face up to the discard pile and their power
 * happens (powers are mandatory). Lowest total when the round ends wins:
 * 7 counts 0, A counts 1, J/Q/K/Joker count 10, the rest count their number.
 *
 * A round ends when a card has to be drawn and the pile is empty, or, if the host allows
 * it, one lap after someone calls "last round". A caller who isn't the lowest gets a penalty.
 *
 * Locked cards (K) can't be looked at, moved, replaced or removed, except by a Joker,
 * which swaps two players' whole rows, locks and all.
 */
const crypto = require('crypto');

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const POWER_RANKS = ['A', '2', '3', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'X'];
const PEEK_MS = 45000;        // time to choose the opening peek
const AWAY_MS = 20000;        // a disconnected player's moves are made for them after this long
const ROUND_END_MS = 14000;   // how long the round's reveal stays up

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Triple Seven error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pickRandom = a => a[crypto.randomInt(a.length)];
const value = c => (c.r === '7' ? 0 : c.r === 'A' ? 1 : ['J', 'Q', 'K', 'X'].includes(c.r) ? 10 : Number(c.r));

/* ---------- settings ---------- */
const defaults = () => ({
  decks: 0,          // 0 = automatic: one deck per 6 players
  rounds: 1,
  allowCall: true,
  penalty: 10,
  powers: Object.fromEntries(POWER_RANKS.map(r => [r, true]))
});
function cleanSettings(p, base) {
  const s = JSON.parse(JSON.stringify(base));
  if (p.decks !== undefined) s.decks = clampInt(p.decks, 0, 4, s.decks);
  if (p.rounds !== undefined) s.rounds = clampInt(p.rounds, 1, 10, s.rounds);
  if (typeof p.allowCall === 'boolean') s.allowCall = p.allowCall;
  if (p.penalty !== undefined) s.penalty = clampInt(p.penalty, 0, 30, s.penalty);
  if (p.powers && typeof p.powers === 'object') for (const r of POWER_RANKS) if (typeof p.powers[r] === 'boolean') s.powers[r] = p.powers[r];
  return s;
}
const decksFor = (s, players) => s.decks || Math.max(1, Math.ceil(players / 6));
function canStart(s, players) {
  if (decksFor(s, players) * 54 <= players * 3 + 1) return `Not enough cards for ${players} players. Add another deck.`;
  return null;
}

/* ---------- game ---------- */
function start(ctx, settings) {
  const order = ctx.onlineIds().slice();
  const g = {
    id: 't7', ctx, s: JSON.parse(JSON.stringify(settings)), order,
    totals: Object.fromEntries(order.map(p => [p, 0])),
    round: 0, first: crypto.randomInt(order.length), nextId: 1,
    phase: 'peek', rows: {}, pile: [], discard: [], turn: null, queue: [], skips: 0,
    called: null, lastPower: null, peeked: new Set(), log: [], touched: { seq: 0, ids: [] },
    summary: null, winners: null, timer: null, awayTimer: null, peekEnds: 0, nextRoundAt: 0
  };
  startRound(g);
  return g;
}
function clear(g) {
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
}
function stop(g) { clear(g); }
function log(g, e) { g.log.push(e); if (g.log.length > 100) g.log.shift(); }
function touch(g, ids) { g.touched = { seq: g.touched.seq + 1, ids: ids.filter(Boolean) }; }

function startRound(g) {
  clear(g);
  g.round += 1;
  const decks = decksFor(g.s, g.order.length);
  g.pile = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) g.pile.push({ id: g.nextId++, r, s });
    for (let k = 0; k < 2; k++) g.pile.push({ id: g.nextId++, r: 'X', s: null });
  }
  for (const c of g.pile) Object.assign(c, { locked: false, up: false, known: new Set() });
  shuffle(g.pile);
  g.discard = [];
  g.rows = {};
  for (const pid of g.order) g.rows[pid] = g.pile.splice(0, 3);
  Object.assign(g, { phase: 'peek', turn: null, queue: [], skips: 0, called: null, lastPower: null, summary: null, peeked: new Set() });
  g.peekEnds = Date.now() + PEEK_MS;
  log(g, { k: 'round', n: g.round, decks });
  g.timer = setTimeout(safe(() => {
    for (const pid of g.order) if (!g.peeked.has(pid)) peekOpening(g, pid, pickRandom(g.rows[pid]).id);
  }), PEEK_MS);
  g.ctx.broadcast();
}
function peekOpening(g, pid, id) {
  const c = g.rows[pid].find(x => x.id === id);
  if (!c || g.peeked.has(pid)) return false;
  c.known.add(pid);
  g.peeked.add(pid);
  log(g, { k: 'peek0', pid, idx: g.rows[pid].indexOf(c) });
  if (g.order.every(p => g.peeked.has(p))) {
    clear(g);
    g.phase = 'play';
    startTurn(g, g.order[(g.first + g.round - 1) % g.order.length]);
  } else g.ctx.broadcast();
  return true;
}

/* ---------- turns ---------- */
/* again: this is an extra turn from a 9, with `extra` more still to come after it. */
function startTurn(g, pid, extra, again) {
  g.turn = { pid, step: 'start', drawn: null, extra: extra || 0 };
  if (!g.pile.length) return endRound(g, 'pile');
  // Without calling (or once someone has called, or on a "go again"), go straight to the draw.
  if (!g.s.allowCall || g.called || again) return draw(g);
  watchAway(g);
  g.ctx.broadcast();
}
function draw(g) {
  const t = g.turn;
  if (!g.pile.length) return endRound(g, 'pile');
  t.drawn = g.pile.shift();
  t.drawn.known.add(t.pid);
  t.step = 'decide';
  watchAway(g);
  g.ctx.broadcast();
}
function play(g, card, from) {
  card.up = true; card.locked = false;
  g.discard.push(card);
  log(g, Object.assign({ k: 'play', pid: g.turn.pid, card: pub(card) }, from || {}));
  g.ctx.fx({ type: 'play', pid: g.turn.pid, card: pub(card), why: from && from.k2 });
  if (g.s.powers[card.r]) g.queue.push({ r: card.r });
}
function advance(g) {
  let i = g.order.indexOf(g.turn.pid);
  for (let guard = 0; guard < g.order.length * 4; guard++) {
    i = (i + 1) % g.order.length;
    const pid = g.order[i];
    if (g.called && pid === g.called) return endRound(g, 'call');
    if (g.skips > 0) { g.skips -= 1; log(g, { k: 'skipped', pid }); g.ctx.fx({ type: 'skipped', pid }); continue; }
    return startTurn(g, pid);
  }
  endRound(g, 'pile');
}

function watchAway(g) {
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  if (g.phase !== 'play' || !g.turn) return;
  const t = g.turn;
  if (g.ctx.onlineIds().includes(t.pid)) return;
  g.awayTimer = setTimeout(safe(() => {
    g.awayTimer = null;
    if (g.phase !== 'play' || g.turn !== t || g.ctx.onlineIds().includes(t.pid)) return;
    autoMove(g);
  }), AWAY_MS);
}
/* Make a sensible move for a player who has dropped out, then keep going until their turn ends. */
function autoMove(g) {
  for (let guard = 0; guard < 50 && g.phase === 'play' && g.turn && !g.ctx.onlineIds().includes(g.turn.pid); guard++) {
    const t = g.turn, pid = t.pid;
    if (t.step === 'start') { draw(g); continue; }
    if (t.step === 'decide') { pick(g, pid, { a: 'play' }); continue; }
    if (t.step === 'power') {
      const opts = options(g, pid, g.queue[0].r);
      pick(g, pid, randomChoice(opts));
      continue;
    }
    break;
  }
}

/* ---------- powers ----------
   Each power says what it needs: cards (how many, from which set) or players. */
const allCards = g => g.order.flatMap(pid => g.rows[pid].map(c => ({ pid, c })));
const free = g => allCards(g).filter(x => !x.c.locked);
function options(g, pid, r) {
  const others = g.order.filter(p => p !== pid);
  switch (r) {
    case 'A': return g.pile.length ? { players: g.order, n: 1 } : null;
    case '2': return { players: others, n: 1 };
    case '7': {
      const mine = g.rows[pid];
      const ok = mine.length > 1 ? mine.filter(c => !c.locked) : [];
      return ok.length ? { cards: ok.map(c => c.id), n: 1 } : null;
    }
    case '10': { const ok = free(g).filter(x => !x.c.up); return ok.length ? { cards: ok.map(x => x.c.id), n: 1 } : null; }
    case 'J': { const ok = free(g).filter(x => !x.c.up); return ok.length ? { cards: ok.map(x => x.c.id), n: 1 } : null; }
    case 'Q': { const ok = free(g); return ok.length >= 2 ? { cards: ok.map(x => x.c.id), n: 2 } : null; }
    case 'K': return { cards: allCards(g).map(x => x.c.id), n: 1 };
    case 'X': return g.order.length >= 2 ? { players: g.order, n: 2 } : null;
  }
  return null;
}
function randomChoice(o) {
  if (o.players) return { a: 'power', pids: shuffle(o.players.slice()).slice(0, o.n) };
  return { a: 'power', ids: shuffle(o.cards.slice()).slice(0, o.n) };
}
function locate(g, id) {
  for (const pid of g.order) { const i = g.rows[pid].findIndex(c => c.id === id); if (i >= 0) return { pid, i, c: g.rows[pid][i] }; }
  return null;
}

/* Work through the powers waiting to happen. Stops when one needs the player to choose. */
function runQueue(g) {
  const t = g.turn;
  while (g.queue.length) {
    if (g.phase !== 'play') return;
    const p = g.queue[0];
    let r = p.r;
    if (r === '6') {
      g.queue.shift();
      if (!g.lastPower) { log(g, { k: 'fizzle', pid: t.pid, r: '6' }); continue; }
      log(g, { k: 'echo', pid: t.pid, r: g.lastPower });
      g.queue.unshift({ r: g.lastPower, echo: true });
      continue;
    }
    g.lastPower = r;
    if (r === '3') {
      for (const c of g.rows[t.pid]) if (!c.locked) c.known.add(t.pid);
      log(g, { k: 'fullsight', pid: t.pid });
      touch(g, g.rows[t.pid].map(c => c.id));
      g.queue.shift(); continue;
    }
    if (r === '8') { g.skips += 1; log(g, { k: 'skip', pid: t.pid }); g.queue.shift(); continue; }
    if (r === '9') { t.extra += 1; log(g, { k: 'again', pid: t.pid }); g.queue.shift(); continue; }
    if (!options(g, t.pid, r)) { log(g, { k: 'fizzle', pid: t.pid, r }); g.queue.shift(); continue; }
    t.step = 'power';
    watchAway(g);
    g.ctx.broadcast();
    return;
  }
  if (t.extra > 0) return startTurn(g, t.pid, t.extra - 1, true);
  advance(g);
}

function applyPower(g, pid, p) {
  const r = g.queue[0].r;
  const o = options(g, pid, r);
  if (!o) { g.queue.shift(); return true; }
  if (o.players) {
    const ps = Array.isArray(p.pids) ? [...new Set(p.pids)] : [];
    if (ps.length !== o.n || ps.some(x => !o.players.includes(x))) return false;
    if (r === 'A') {
      const c = g.pile.shift();
      g.rows[ps[0]].push(c);
      log(g, { k: 'add', pid, target: ps[0] });
      touch(g, [c.id]);
    } else if (r === '2') {
      for (const c of g.rows[ps[0]]) if (!c.locked) c.known.add(pid);
      log(g, { k: 'spy', pid, target: ps[0] });
      touch(g, g.rows[ps[0]].map(c => c.id));
    } else if (r === 'X') {
      [g.rows[ps[0]], g.rows[ps[1]]] = [g.rows[ps[1]], g.rows[ps[0]]];
      log(g, { k: 'rows', pid, a: ps[0], b: ps[1] });
      touch(g, [...g.rows[ps[0]], ...g.rows[ps[1]]].map(c => c.id));
      g.ctx.fx({ type: 'rows', a: ps[0], b: ps[1] });
    }
    g.queue.shift();
    return true;
  }
  const ids = Array.isArray(p.ids) ? [...new Set(p.ids.map(Number))] : [];
  if (ids.length !== o.n || ids.some(id => !o.cards.includes(id))) return false;
  const L = ids.map(id => locate(g, id));
  if (r === '7') {
    const { pid: owner, i, c } = L[0];
    g.rows[owner].splice(i, 1);
    g.queue.shift();
    log(g, { k: 'remove', pid, idx: i });
    play(g, c, { k2: 'removed' });
    // play() queued the removed card's power at the back; it happens next.
    if (g.s.powers[c.r]) g.queue.unshift(g.queue.pop());
    return true;
  }
  if (r === '10') { L[0].c.up = true; log(g, { k: 'spot', pid, target: L[0].pid, idx: L[0].i, card: pub(L[0].c) }); }
  if (r === 'J') { L[0].c.known.add(pid); log(g, { k: 'jpeek', pid, target: L[0].pid, idx: L[0].i }); }
  if (r === 'K') { L[0].c.locked = !L[0].c.locked; log(g, { k: L[0].c.locked ? 'lock' : 'unlock', pid, target: L[0].pid, idx: L[0].i }); }
  if (r === 'Q') {
    const [a, b] = L;
    g.rows[a.pid][a.i] = b.c; g.rows[b.pid][b.i] = a.c;
    log(g, { k: 'swap', pid, a: a.pid, ai: a.i, b: b.pid, bi: b.i });
  }
  touch(g, ids);
  g.queue.shift();
  return true;
}

/* ---------- moves ---------- */
function pick(g, pid, p) {
  if (g.phase === 'peek') {
    if (p.a !== 'peek' || !g.order.includes(pid)) return { ok: false };
    return peekOpening(g, pid, Number(p.id)) ? { ok: true } : { ok: false };
  }
  if (g.phase !== 'play' || !g.turn || g.turn.pid !== pid) return { ok: false, error: 'It’s not your turn.' };
  const t = g.turn;
  if (p.a === 'draw' && t.step === 'start') { draw(g); return { ok: true }; }
  if (p.a === 'call' && t.step === 'start') {
    if (!g.s.allowCall || g.called) return { ok: false };
    g.called = pid;
    log(g, { k: 'call', pid });
    g.ctx.fx({ type: 'call', pid });
    advance(g);
    return { ok: true };
  }
  if (t.step === 'decide' && (p.a === 'play' || p.a === 'keep')) {
    const drawn = t.drawn;
    t.drawn = null;
    t.step = 'power';
    if (p.a === 'play') {
      play(g, drawn, { k2: 'drawn' });
      touch(g, []);
    } else {
      const row = g.rows[pid];
      const i = row.findIndex(c => c.id === Number(p.id));
      if (i < 0 || row[i].locked) { t.drawn = drawn; t.step = 'decide'; return { ok: false, error: 'Pick one of your unlocked cards.' }; }
      const old = row[i];
      row[i] = drawn;
      play(g, old, { k2: 'swapped', idx: i });
      touch(g, [drawn.id]);
    }
    runQueue(g);
    return { ok: true };
  }
  if (t.step === 'power' && p.a === 'power') {
    if (!applyPower(g, pid, p)) return { ok: false, error: 'That choice doesn’t work for this power.' };
    runQueue(g);
    return { ok: true };
  }
  return { ok: false };
}

/* ---------- round end ---------- */
function endRound(g, why) {
  clear(g);
  const scores = {};
  for (const pid of g.order) scores[pid] = g.rows[pid].reduce((a, c) => a + value(c), 0);
  let penalty = 0;
  if (g.called) {
    const low = Math.min(...g.order.map(p => scores[p]));
    if (scores[g.called] > low) penalty = g.s.penalty;
  }
  const add = Object.assign({}, scores);
  if (penalty) add[g.called] += penalty;
  for (const pid of g.order) g.totals[pid] += add[pid];
  g.summary = { why, scores, add, caller: g.called, penalty };
  g.turn = null; g.queue = [];
  log(g, { k: 'roundEnd', n: g.round });
  if (g.round >= g.s.rounds) {
    g.phase = 'over';
    const best = Math.min(...g.order.map(p => g.totals[p]));
    g.winners = g.order.filter(p => g.totals[p] === best);
  } else {
    g.phase = 'roundEnd';
    g.nextRoundAt = Date.now() + ROUND_END_MS;
    g.timer = setTimeout(safe(() => startRound(g)), ROUND_END_MS);
  }
  g.ctx.broadcast();
}

function playersChanged(g) { if (g.phase === 'play') watchAway(g); }
function playerJoined() { /* late arrivals watch until the next game */ }

/* ---------- what each player sees ---------- */
const pub = c => ({ r: c.r, s: c.s });
function view(g, viewer) {
  const reveal = g.phase === 'roundEnd' || g.phase === 'over';
  const rows = {};
  for (const pid of g.order) {
    rows[pid] = g.rows[pid].map(c => {
      const see = reveal || c.up || c.known.has(viewer);
      return { id: c.id, locked: c.locked, up: c.up, face: see ? pub(c) : null, priv: !reveal && !c.up && c.known.has(viewer) };
    });
  }
  const t = g.turn;
  return {
    id: 't7', settings: g.s, phase: g.phase, round: g.round, order: g.order, totals: g.totals,
    rows, pileLeft: g.pile.length, discard: g.discard.slice(-8).map(pub), discardCount: g.discard.length,
    peeked: [...g.peeked], peekEnds: g.peekEnds, called: g.called, skips: g.skips, lastPower: g.lastPower,
    turn: t ? {
      pid: t.pid, step: t.step, extra: t.extra,
      drawn: t.drawn ? (t.pid === viewer ? pub(t.drawn) : true) : null,
      power: t.step === 'power' && g.queue[0] ? Object.assign({ r: g.queue[0].r, echo: !!g.queue[0].echo }, viewer === t.pid ? { opts: options(g, t.pid, g.queue[0].r) } : {}) : null
    } : null,
    touched: g.touched, log: g.log.slice(-40), summary: g.summary, nextRoundAt: g.nextRoundAt, winners: g.winners
  };
}

module.exports = {
  id: 't7', name: 'The Triple Seven', minPlayers: 2,
  POWER_RANKS, defaults, cleanSettings, canStart,
  start, stop, pick, view, playersChanged, playerJoined,
  _startRound: startRound, value // for tests
};
