'use strict';
/*
 * Countercurrent: The Pelagos Protocol. A deduction game for 3 or 4 players.
 *
 * 14 compound samples (2 crimson, 3 amber, 4 jade, 5 cobalt). Each round two are sealed
 * away as the formula and the other 12 are dealt out. Seven reaction profiles lie on the
 * table: the six pairs of different colours, and one "same colour" profile.
 *
 * On your turn you move your Field Team to a profile other than the one it was on last
 * turn and use one unused protocol tile with that profile's colours:
 *   Scan        give one A (it comes back); the target privately tells you how many B they hold.
 *   Transfer    give one A; the target gives you all their B.
 *   Synthesize  the target gives you one of each colour on the profile, if they have them.
 *   Acquire     name a colour on the profile; the target gives you one if they have one.
 *   Declare     claim the profile you think is the formula; the others may claim, back or pass.
 * On the same-colour profile the active player names the colour, and it's public.
 * A cycle is one turn per tile in the chosen set; then the tiles come back.
 *
 * Card colours stay private to the two players involved; how many cards move is public.
 */
const crypto = require('crypto');

const COLORS = ['crimson', 'amber', 'jade', 'cobalt'];
const COUNTS = { crimson: 2, amber: 3, jade: 4, cobalt: 5 };
const SAME = 6; // index of the same-colour profile
const PROFILES = [['crimson', 'amber'], ['crimson', 'jade'], ['crimson', 'cobalt'], ['amber', 'jade'], ['amber', 'cobalt'], ['jade', 'cobalt'], null];
const TILES = ['scan', 'transfer', 'synthesize', 'acquire', 'declare'];
const SETS = { intro: ['scan', 'declare'], standard: ['transfer', 'acquire', 'declare'], full: TILES };
const TRACE_SUPPLY = 8;
const AWAY_MS = 20000;        // a disconnected player's turn is played for them after this long
const AWAY_REPLY_MS = 6000;   // a disconnected player passes on a declaration after this long
const REPLY_MS = 45000;       // time to answer a declaration (claim, back or pass)
const ROUND_END_MS = 20000;   // how long the reveal stays up

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Countercurrent error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pickRandom = a => a[crypto.randomInt(a.length)];
const emptyHand = () => Object.fromEntries(COLORS.map(c => [c, 0]));
const handSize = h => COLORS.reduce((a, c) => a + h[c], 0);
const profileOf = (a, b) => (a === b ? SAME : PROFILES.findIndex(p => p && p.includes(a) && p.includes(b)));

/* ---------- settings ---------- */
const defaults = () => ({ protocols: 'full', target: 6, trace: false });
function cleanSettings(p, base) {
  const s = Object.assign({}, base);
  if (SETS[p.protocols]) s.protocols = p.protocols;
  if (p.target !== undefined) s.target = clampInt(p.target, 3, 15, s.target);
  if (typeof p.trace === 'boolean') s.trace = p.trace;
  return s;
}
function canStart(s, players) {
  if (players > 4) return 'Countercurrent is for 3 or 4 players. Some people will need to sit this one out.';
  return null;
}

/* ---------- game ---------- */
function start(ctx, settings) {
  const order = shuffle(ctx.onlineIds().slice());
  const g = {
    id: 'cc', ctx, s: Object.assign({}, settings), order,
    scores: Object.fromEntries(order.map(p => [p, 0])),
    round: 0, first: 0, phase: 'play', log: [], seq: 0,
    timer: null, awayTimer: null, winners: null, summary: null
  };
  startRound(g);
  return g;
}
function clear(g) {
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
}
function stop(g) { clear(g); }
/* vis: the players allowed to see the entry's secret part (sec). Everyone sees the rest. */
function log(g, e) { e.n = ++g.seq; g.log.push(e); if (g.log.length > 150) g.log.shift(); }
const tilesOf = g => SETS[g.s.protocols];

function startRound(g) {
  clear(g);
  g.round += 1;
  const deck = shuffle(COLORS.flatMap(c => Array(COUNTS[c]).fill(c)));
  g.formula = deck.splice(0, 2);
  g.hands = {};
  for (const pid of g.order) g.hands[pid] = emptyHand();
  deck.forEach((c, i) => { g.hands[g.order[i % g.order.length]][c] += 1; });
  g.field = Object.fromEntries(g.order.map(p => [p, null]));
  g.marker = Object.fromEntries(g.order.map(p => [p, true]));
  g.dead = [];          // profiles shown to be wrong this round
  g.wrongBacks = [];    // { pid, profile } — each cost a point straight away
  g.traces = [];        // { pid, color }
  g.used = [];          // protocol tiles used this cycle
  g.passes = 0;         // turns passed in a row (a full lap of passes resets the tiles)
  g.forced = null;      // the one player left with a claim marker must declare
  g.decl = null;
  g.summary = null;
  g.phase = 'play';
  g.firstPid = g.order[(g.round - 1) % g.order.length];
  log(g, { k: 'round', round: g.round, first: g.firstPid });
  startTurn(g, g.firstPid);
}

function startTurn(g, pid) {
  g.turn = { pid, step: 'act' };
  if (g.marker[pid] && g.order.filter(p => g.marker[p]).length === 1 && g.order.length > 1) g.forced = pid;
  else g.forced = null;
  watchAway(g);
  g.ctx.broadcast();
}
function nextTurn(g) {
  const i = g.order.indexOf(g.turn.pid);
  startTurn(g, g.order[(i + 1) % g.order.length]);
}
function useTile(g, tile) {
  if (!g.used.includes(tile)) g.used.push(tile);
  g.passes = 0;
  if (g.used.length >= tilesOf(g).length) { g.used = []; log(g, { k: 'cycle' }); }
}

/* ---------- checking a move ----------
   m: { tile, profile, give, color, target, claim } */
function check(g, pid, m) {
  const tile = m.tile;
  if (!TILES.includes(tile) || !tilesOf(g).includes(tile)) return 'Pick one of this game’s protocols.';
  const forced = g.forced === pid;
  if (forced && tile !== 'declare') return 'You’re the last team with a claim marker, so you must Declare.';
  if (!forced && g.used.includes(tile)) return 'That protocol has already been used this cycle.';
  const p = Number(m.profile);
  if (!Number.isInteger(p) || p < 0 || p > SAME) return 'Move your Field Team to a reaction profile first.';
  if (p === g.field[pid]) return 'Your Field Team has to move to a different profile from last turn.';
  const hand = g.hands[pid];
  if (tile === 'declare') {
    if (!g.marker[pid]) return 'You’ve lost your claim marker for this round.';
    const c = Number(m.claim);
    if (!Number.isInteger(c) || c < 0 || c > SAME) return 'Pick the profile you’re claiming.';
    if (g.dead.includes(c)) return 'That profile has already been shown to be wrong.';
    return null;
  }
  if (!g.order.includes(m.target) || m.target === pid) return 'Pick another team.';
  const pair = PROFILES[p];
  if (p === SAME) {
    if (!COLORS.includes(m.color)) return 'Name a colour for the same-colour profile.';
    if ((tile === 'scan' || tile === 'transfer') && !hand[m.color]) return `You need a ${m.color} sample to give.`;
    return null;
  }
  if (tile === 'scan' || tile === 'transfer') {
    if (!pair.includes(m.give)) return 'Choose which colour you give.';
    if (!hand[m.give]) return `You need a ${m.give} sample to give.`;
  }
  if (tile === 'acquire' && !pair.includes(m.color)) return 'Name one of the two colours on the profile.';
  return null;
}
/* Every legal move except Declare, for a player who dropped out (and to see whether passing is allowed). */
function plainMoves(g, pid) {
  const out = [];
  const others = g.order.filter(p => p !== pid);
  for (const tile of tilesOf(g)) {
    if (tile === 'declare' || g.used.includes(tile)) continue;
    for (let p = 0; p <= SAME; p++) {
      const opts = p === SAME ? COLORS.map(c => ({ color: c })) : PROFILES[p].map(c => ({ give: c, color: c }));
      for (const o of opts) for (const target of others) {
        const m = Object.assign({ tile, profile: p, target }, o);
        if (!check(g, pid, m)) out.push(m);
      }
    }
  }
  return out;
}
const canDeclare = (g, pid) => g.marker[pid] && (g.forced === pid || (tilesOf(g).includes('declare') && !g.used.includes('declare')));
const canPass = (g, pid) => g.forced !== pid && !plainMoves(g, pid).length;

/* ---------- doing a move ---------- */
function act(g, pid, m) {
  const why = check(g, pid, m);
  if (why) return why;
  const p = Number(m.profile), t = m.target, mine = g.hands[pid];
  g.field[pid] = p;
  if (m.tile === 'declare') {
    if (!(g.forced === pid && g.used.includes('declare'))) useTile(g, 'declare');
    declare(g, pid, Number(m.claim));
    return null;
  }
  const theirs = g.hands[t];
  const same = p === SAME;
  const A = same ? m.color : (m.tile === 'acquire' ? m.color : m.give);
  const B = same ? m.color : (m.tile === 'acquire' ? m.color : PROFILES[p].find(c => c !== A));
  const e = { k: m.tile, pid, target: t, profile: p, vis: [pid, t] };
  if (same) e.color = m.color;
  if (m.tile === 'scan') {
    e.sec = { give: A, ask: B, answer: theirs[B] };
  } else if (m.tile === 'transfer') {
    mine[A] -= 1; theirs[A] += 1;
    const n = theirs[B];
    theirs[B] = 0; mine[B] += n;
    e.got = n;
    e.sec = { give: A, take: B };
  } else if (m.tile === 'synthesize') {
    const got = [];
    if (same) { const n = Math.min(2, theirs[A]); for (let i = 0; i < n; i++) got.push(A); }
    else for (const c of PROFILES[p]) if (theirs[c]) got.push(c);
    for (const c of got) { theirs[c] -= 1; mine[c] += 1; }
    e.got = got.length;
    e.sec = { got };
  } else if (m.tile === 'acquire') {
    e.color = A;   // the named colour is public, and so is whether a card came back
    const n = theirs[A] ? 1 : 0;
    theirs[A] -= n; mine[A] += n;
    e.got = n;
  }
  log(g, e);
  useTile(g, m.tile);
  g.ctx.fx({ type: 'act', tile: m.tile, pid, target: t });
  if (g.s.trace && g.traces.length < TRACE_SUPPLY) {
    g.turn.step = 'trace';
    watchAway(g);
    g.ctx.broadcast();
  } else nextTurn(g);
  return null;
}

/* ---------- declaring ---------- */
function declare(g, pid, claim) {
  const i = g.order.indexOf(pid);
  const queue = [];
  for (let k = 1; k < g.order.length; k++) { const q = g.order[(i + k) % g.order.length]; if (g.marker[q]) queue.push(q); }
  g.decl = { by: pid, claims: [{ pid, profile: claim, type: 'claim' }], queue, cur: null, ends: 0 };
  g.turn.step = 'declare';
  log(g, { k: 'declare', pid, profile: claim });
  g.ctx.fx({ type: 'declare', pid, profile: claim });
  askNext(g);
}
function askNext(g) {
  const d = g.decl;
  clear(g);
  d.cur = d.queue.shift() || null;
  if (!d.cur) return resolve(g);
  d.ends = Date.now() + REPLY_MS;
  const cur = d.cur;
  g.timer = setTimeout(safe(() => { if (g.decl === d && d.cur === cur) reply(g, cur, { type: 'pass' }); }), REPLY_MS);
  watchAway(g);
  g.ctx.broadcast();
}
function reply(g, pid, r) {
  const d = g.decl;
  if (!d || d.cur !== pid) return 'It’s not your turn to answer.';
  const claimed = d.claims.map(c => c.profile);
  const p = Number(r.profile);
  if (r.type === 'claim') {
    if (!Number.isInteger(p) || p < 0 || p > SAME) return 'Pick a profile.';
    if (g.dead.includes(p)) return 'That profile has already been shown to be wrong.';
    if (claimed.includes(p)) return 'Someone has already claimed that profile. Back it instead.';
    d.claims.push({ pid, profile: p, type: 'claim' });
    log(g, { k: 'claim', pid, profile: p });
  } else if (r.type === 'back') {
    if (!d.claims.some(c => c.type === 'claim' && c.profile === p)) return 'Pick a profile that has been claimed.';
    d.claims.push({ pid, profile: p, type: 'back' });
    log(g, { k: 'back', pid, profile: p });
  } else if (r.type === 'pass') {
    log(g, { k: 'pass', pid });
  } else return 'Claim, back or pass.';
  askNext(g);
  return null;
}
function resolve(g) {
  clear(g);
  const d = g.decl;
  const right = profileOf(g.formula[0], g.formula[1]);
  const hit = d.claims.some(c => c.profile === right);
  const wrong = d.claims.filter(c => c.profile !== right);
  // A wrong back costs a point at once; the backer keeps their marker.
  for (const c of wrong.filter(c => c.type === 'back')) {
    g.scores[c.pid] = Math.max(0, g.scores[c.pid] - 1);
    g.wrongBacks.push({ pid: c.pid, profile: c.profile });
  }
  if (hit) {
    g.decl = null;
    return endRound(g, d.claims);
  }
  for (const c of wrong.filter(c => c.type === 'claim')) g.marker[c.pid] = false;
  for (const c of d.claims) if (!g.dead.includes(c.profile)) g.dead.push(c.profile);
  log(g, { k: 'wrong', claims: d.claims.map(c => ({ pid: c.pid, profile: c.profile, type: c.type })) });
  g.ctx.fx({ type: 'wrong' });
  g.decl = null;
  if (!g.order.some(p => g.marker[p])) return endRound(g, null);
  nextTurn(g);
}

/* ---------- trace markers ---------- */
function trace(g, pid, color) {
  if (color != null) {
    if (!COLORS.includes(color)) return 'Pick a colour.';
    if (g.traces.length >= TRACE_SUPPLY) return 'The Trace markers have run out.';
    g.traces.push({ pid, color });
    log(g, { k: 'trace', pid, vis: [pid], sec: { color } });
  }
  nextTurn(g);
  return null;
}

/* ---------- round end ---------- */
function endRound(g, claims) {
  clear(g);
  const right = profileOf(g.formula[0], g.formula[1]);
  const delta = Object.fromEntries(g.order.map(p => [p, { claim: 0, back: 0, trace: 0, before: g.scores[p] }]));
  if (claims) for (const c of claims) {
    if (c.profile !== right) continue;
    if (c.type === 'claim') delta[c.pid].claim += 3; else delta[c.pid].back += 1;
  }
  const traces = g.traces.map(t => Object.assign({ ok: g.formula.includes(t.color) }, t));
  for (const t of traces) delta[t.pid].trace += t.ok ? 1 : -1;
  for (const p of g.order) {
    const d = delta[p];
    g.scores[p] = Math.max(0, g.scores[p] + d.claim + d.back + d.trace);
  }
  g.summary = {
    formula: g.formula.slice(), right, found: !!claims, claims: claims || [], traces, delta,
    wrongBacks: g.wrongBacks.slice()
  };
  g.turn = null; g.decl = null; g.forced = null;
  log(g, { k: 'reveal', formula: g.formula.slice(), found: !!claims });
  const top = Math.max(...g.order.map(p => g.scores[p]));
  const leaders = g.order.filter(p => g.scores[p] === top);
  if (top >= g.s.target && leaders.length === 1) {
    g.phase = 'over';
    g.winners = leaders;
  } else {
    g.summary.tie = top >= g.s.target;
    g.phase = 'roundEnd';
    g.nextRoundAt = Date.now() + ROUND_END_MS;
    g.timer = setTimeout(safe(() => startRound(g)), ROUND_END_MS);
  }
  g.ctx.broadcast();
}

/* ---------- moves from players ---------- */
function pick(g, pid, p) {
  if (g.phase !== 'play') return { ok: false };
  let err = 'It’s not your turn.';
  if (p.a === 'reply') err = reply(g, pid, p);
  else if (g.turn && g.turn.pid === pid) {
    if (g.turn.step === 'act' && p.a === 'act') err = act(g, pid, p);
    else if (g.turn.step === 'act' && p.a === 'pass') {
      if (!canPass(g, pid)) err = g.forced === pid ? 'You must Declare.' : 'You can still use a protocol, so you can’t pass.';
      else {
        err = null;
        log(g, { k: 'skip', pid });
        g.passes += 1;
        if (g.passes >= g.order.length) { g.used = []; g.passes = 0; log(g, { k: 'cycle' }); }
        nextTurn(g);
      }
    } else if (g.turn.step === 'trace' && p.a === 'trace') err = trace(g, pid, p.color == null ? null : p.color);
  }
  return err ? { ok: false, error: err } : { ok: true };
}

/* ---------- players who drop out ---------- */
function watchAway(g) {
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  if (g.phase !== 'play' || !g.turn) return;
  const who = g.decl ? g.decl.cur : g.turn.pid;
  if (!who || g.ctx.onlineIds().includes(who)) return;
  const stamp = g.seq + ':' + who + ':' + g.turn.step;
  g.awayTimer = setTimeout(safe(() => {
    g.awayTimer = null;
    const now = g.decl ? g.decl.cur : g.turn && g.turn.pid;
    if (g.phase !== 'play' || now !== who || stamp !== g.seq + ':' + who + ':' + g.turn.step || g.ctx.onlineIds().includes(who)) return;
    autoMove(g, who);
  }), g.decl ? AWAY_REPLY_MS : AWAY_MS);
}
function autoMove(g, pid) {
  if (g.decl) return reply(g, pid, { type: 'pass' });
  const t = g.turn;
  if (t.step === 'trace') return trace(g, pid, null);
  const moveTo = () => pickRandom([0, 1, 2, 3, 4, 5, 6].filter(p => p !== g.field[pid]));
  if (g.forced === pid) {
    const open = [0, 1, 2, 3, 4, 5, 6].filter(p => !g.dead.includes(p));
    return act(g, pid, { tile: 'declare', profile: moveTo(), claim: pickRandom(open) });
  }
  const moves = plainMoves(g, pid);
  if (moves.length) return act(g, pid, pickRandom(moves));
  pick(g, pid, { a: 'pass' });
}
/* ---------- bots ----------
   A practice opponent. It only uses what its seat could know: its own hand, and the
   profiles already shown to be wrong. It plays a random legal protocol and declares
   once few profiles are still possible from where it sits. */
function plausible(g, pid) {
  const h = g.hands[pid];
  const left = c => COUNTS[c] - h[c];   // samples of this colour it can't see
  return [0, 1, 2, 3, 4, 5, 6].filter(p => {
    if (g.dead.includes(p)) return false;
    if (p === SAME) return COLORS.some(c => left(c) >= 2);
    return PROFILES[p].every(c => left(c) >= 1);
  });
}
function bot(g, pid) {
  if (g.phase !== 'play' || !g.turn) return null;
  if (g.decl) {
    if (g.decl.cur !== pid) return null;
    const ok = plausible(g, pid);
    const backable = g.decl.claims.filter(c => c.type === 'claim' && ok.includes(c.profile));
    const free = ok.filter(p => !g.decl.claims.some(c => c.profile === p));
    if (ok.length === 1 && free.includes(ok[0])) return { move: { a: 'reply', type: 'claim', profile: ok[0] } };
    if (backable.length && Math.random() < 0.3) return { move: { a: 'reply', type: 'back', profile: pickRandom(backable).profile } };
    return { move: { a: 'reply', type: 'pass' } };
  }
  if (g.turn.pid !== pid) return null;
  if (g.turn.step === 'trace') {
    if (Math.random() < 0.5) return { move: { a: 'trace', color: null } };
    const h = g.hands[pid];
    const best = COLORS.slice().sort((a, b) => (COUNTS[b] - h[b]) - (COUNTS[a] - h[a]))[0];
    return { move: { a: 'trace', color: best } };
  }
  const moveTo = () => pickRandom([0, 1, 2, 3, 4, 5, 6].filter(p => p !== g.field[pid]));
  const ok = plausible(g, pid);
  const claim = () => pickRandom(ok.length ? ok : [0, 1, 2, 3, 4, 5, 6].filter(p => !g.dead.includes(p)));
  if (g.forced === pid || (canDeclare(g, pid) && (ok.length <= 2 || Math.random() < 0.08))) {
    return { move: { a: 'act', tile: 'declare', profile: moveTo(), claim: claim() } };
  }
  const moves = plainMoves(g, pid);
  if (moves.length) return { move: Object.assign({ a: 'act' }, pickRandom(moves)) };
  if (canDeclare(g, pid)) return { move: { a: 'act', tile: 'declare', profile: moveTo(), claim: claim() } };
  return { move: { a: 'pass' } };
}

function playersChanged(g) { if (g.phase === 'play') watchAway(g); }
function playerJoined() { /* late arrivals watch until the next game */ }

/* ---------- what each player sees ---------- */
function view(g, viewer) {
  const reveal = g.phase === 'roundEnd' || g.phase === 'over';
  const playing = g.order.includes(viewer);
  const counts = Object.fromEntries(g.order.map(p => [p, handSize(g.hands[p])]));
  const t = g.turn;
  return {
    id: 'cc', settings: g.s, phase: g.phase, round: g.round, order: g.order, scores: g.scores,
    firstPid: g.firstPid, counts, hand: playing ? g.hands[viewer] : null,
    hands: reveal ? g.hands : null,
    formula: reveal ? g.formula : null,
    field: g.field, marker: g.marker, dead: g.dead, tiles: tilesOf(g), used: g.used,
    forced: g.forced,
    traces: g.traces.map(x => ({ pid: x.pid, color: reveal || x.pid === viewer ? x.color : null })),
    traceLeft: TRACE_SUPPLY - g.traces.length,
    turn: t ? {
      pid: t.pid, step: t.step,
      canPass: t.pid === viewer && t.step === 'act' ? canPass(g, viewer) : false,
      canDeclare: t.pid === viewer ? canDeclare(g, viewer) : false
    } : null,
    decl: g.decl ? { by: g.decl.by, claims: g.decl.claims, cur: g.decl.cur, ends: g.decl.ends, waiting: g.decl.queue } : null,
    log: g.log.slice(-60).map(e => {
      const o = Object.assign({}, e);
      delete o.vis;
      if (e.vis && !e.vis.includes(viewer)) delete o.sec;
      return o;
    }),
    summary: g.summary, nextRoundAt: g.nextRoundAt, winners: g.winners
  };
}

module.exports = {
  id: 'cc', name: 'Countercurrent', minPlayers: 3,
  COLORS, COUNTS, PROFILES, TILES, SETS,
  defaults, cleanSettings, canStart,
  start, stop, pick, view, playersChanged, playerJoined, bot,
  _profileOf: profileOf, _startRound: startRound, _autoMove: autoMove // for tests
};
