'use strict';
/*
 * Starlight Signal: a reaction game of counting constellations, played inside a party room.
 *
 * 56 star cards (crimson, amber, jade and cobalt, 1 to 5 stars) and one comet card are dealt
 * out face down. Players take turns flipping the top card of their pile onto their own face-up
 * pile. Only the top face-up card of each player counts. When the visible stars of one colour
 * total exactly 5, anyone can ring the bell. The first correct ring wins every face-up card
 * (and the comet), which go to the bottom of the winner's pile. A wrong ring gives one card to
 * each opponent.
 *
 * The comet: when it is flipped it goes beside the bell, and until someone wins a bell round
 * the target is 4 instead of 5.
 *
 * Running out: with no face-down cards you can still ring. If someone else wins a bell round
 * while you have none, you are out. With two players left, the next bell round wins the game.
 * If nobody can flip and nobody rings, the game ends and the most cards wins.
 */
const crypto = require('crypto');

const COLOURS = ['crimson', 'amber', 'jade', 'cobalt'];
const COPIES = { 1: 5, 2: 3, 3: 3, 4: 2, 5: 1 };   // cards of each star count, per colour: 14 per colour
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const FLIP_TIMES = [2, 3, 4, 6];  // seconds before a card flips by itself
const FIRST_MS = 3000;            // countdown before the first flip
const READY_MS = 450;             // a new turn can't flip quite at once, so every card is seen
const RESULT_MS = 2400;           // how long a won bell round stays on screen
const GRACE_MS = 450;             // a ring judged on the cards the player saw, if they changed this recently
const COOL_MS = 1500;             // after a wrong ring, that player can't ring again for this long
const STALL_MS = 5000;            // nobody can flip: the game ends after this long without a ring
const STALL_SIGNAL_MS = 10000;    // ...or this long if there's a signal on the table nobody has rung

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Starlight Signal error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pub = c => (c ? (c.comet ? { id: c.id, comet: true } : { id: c.id, c: c.c, n: c.n }) : null);

/* ---------- settings ---------- */
const defaults = () => ({ flip: 4, away: true, short: false, totals: false });
function cleanSettings(p, base) {
  const s = Object.assign({}, base);
  if (FLIP_TIMES.includes(Number(p.flip))) s.flip = Number(p.flip);
  for (const k of ['away', 'short', 'totals']) if (typeof p[k] === 'boolean') s[k] = p[k];
  return s;
}
function canStart(s, players) {
  if (players > MAX_PLAYERS) return `Starlight Signal is for ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`;
  return null;
}

/* ---------- the deck ---------- */
function makeDeck() {
  const deck = [];
  let id = 1;
  for (const c of COLOURS) for (const [n, k] of Object.entries(COPIES)) for (let i = 0; i < k; i++) deck.push({ id: id++, c, n: Number(n) });
  deck.push({ id: id++, comet: true });
  return shuffle(deck);
}

/* ---------- game ---------- */
function start(ctx, settings) {
  const order = shuffle(ctx.onlineIds().slice()).slice(0, MAX_PLAYERS);
  const deck = makeDeck();
  const draw = Object.fromEntries(order.map(p => [p, []]));
  // Deal as evenly as possible, starting with a random player.
  const off = crypto.randomInt(order.length);
  deck.forEach((c, i) => draw[order[(i + off) % order.length]].push(c));
  const g = {
    id: 'sl', ctx, s: Object.assign({}, settings), order,
    draw,                                              // index 0 is the top card
    face: Object.fromEntries(order.map(p => [p, []])), // last is the top card
    out: [],                                           // eliminated, in the order they went out
    comet: null,                                       // the comet card, while it's beside the bell
    phase: 'play', turn: null, turnEnds: 0, readyAt: 0,
    seq: 0, hist: [], cool: {},
    round: 1, result: null, nextAt: 0, stallAt: 0,
    log: [], winners: null, final: null, endWhy: '',
    timer: null
  };
  g.turn = order[crypto.randomInt(order.length)];
  record(g);
  log(g, { k: 'start', pid: g.turn });
  beginTurn(g, g.turn, FIRST_MS);
  return g;
}
function clear(g) { if (g.timer) { clearTimeout(g.timer); g.timer = null; } }
function stop(g) { clear(g); g.phase = g.phase === 'over' ? 'over' : 'stopped'; }
function log(g, e) { g.log.push(e); if (g.log.length > 80) g.log.shift(); }
const alive = g => g.order.filter(p => !g.out.includes(p));
const target = g => (g.comet ? 4 : 5);
const cardsOf = (g, pid) => g.draw[pid].length + g.face[pid].length;

/* The colours that total exactly the target right now. */
function totals(g) {
  const t = Object.fromEntries(COLOURS.map(c => [c, 0]));
  for (const p of alive(g)) {
    const top = g.face[p][g.face[p].length - 1];
    if (top && !top.comet) t[top.c] += top.n;
  }
  return t;
}
function signal(g) {
  const t = totals(g), want = target(g);
  return COLOURS.filter(c => t[c] === want);
}
/* Every change to what's on the table gets a number, and we remember what the signal was,
   so a ring can be judged on the cards that player was looking at. */
function record(g) {
  g.seq++;
  g.hist.push({ seq: g.seq, at: Date.now(), sig: signal(g), target: target(g) });
  if (g.hist.length > 30) g.hist.shift();
}

/* ---------- turns ---------- */
function nextFrom(g, pid) {
  const live = g.order.filter(p => !g.out.includes(p) && g.draw[p].length > 0);
  if (!live.length) return null;
  const i = g.order.indexOf(pid);
  for (let k = 1; k <= g.order.length; k++) {
    const p = g.order[(i + k) % g.order.length];
    if (live.includes(p)) return p;
  }
  return null;
}
function beginTurn(g, pid, wait) {
  clear(g);
  g.phase = 'play';
  if (!pid || g.out.includes(pid) || !g.draw[pid].length) pid = nextFrom(g, pid || g.order[0]);
  if (!pid) return stall(g);
  g.turn = pid;
  g.stallAt = 0;
  const now = Date.now();
  g.readyAt = now + (wait || READY_MS);
  g.turnEnds = g.readyAt + g.s.flip * 1000;
  g.timer = setTimeout(safe(() => { g.timer = null; if (g.phase === 'play' && g.turn === pid) flip(g, pid, true); }), g.turnEnds - now);
  g.ctx.broadcast();
}
/* Nobody has a card to flip. Wait a little for a ring, then the most cards wins. */
function stall(g) {
  clear(g);
  g.turn = null;
  const ms = signal(g).length ? STALL_SIGNAL_MS : STALL_MS;
  g.stallAt = Date.now() + ms;
  g.timer = setTimeout(safe(() => { g.timer = null; if (g.phase === 'play' && !g.turn) finish(g, 'stall'); }), ms);
  g.ctx.broadcast();
}
function flip(g, pid, auto) {
  const card = g.draw[pid].shift();
  if (!card) return beginTurn(g, nextFrom(g, pid));
  if (card.comet) {
    g.comet = card;
    log(g, { k: 'comet', pid, auto: !!auto });
    g.ctx.fx({ type: 'comet', pid });
  } else {
    g.face[pid].push(card);
    log(g, { k: 'flip', pid, card: pub(card), auto: !!auto });
    g.ctx.fx({ type: 'flip', pid, card: pub(card) });
  }
  record(g);
  beginTurn(g, nextFrom(g, pid));
}

/* ---------- the bell ---------- */
function ring(g, pid, seenSeq) {
  if (!g.order.includes(pid)) return { ok: false, error: 'You’re watching this game.' };
  if (g.out.includes(pid)) return { ok: false, error: 'You’re out, so you can’t ring the bell.' };
  if (g.phase === 'result') return { ok: true, result: 'late' };
  if (g.phase !== 'play') return { ok: false };
  const now = Date.now();
  if ((g.cool[pid] || 0) > now) return { ok: true, result: 'cool' };
  // Right now, or on the cards they saw if those changed only a moment ago.
  let sig = signal(g), want = target(g);
  if (!sig.length && Number.isInteger(seenSeq) && seenSeq < g.seq) {
    const seen = g.hist.find(h => h.seq === seenSeq);
    const after = g.hist.find(h => h.seq === seenSeq + 1);
    if (seen && after && now - after.at <= GRACE_MS && seen.sig.length) { sig = seen.sig; want = seen.target; }
  }
  if (sig.length) { win(g, pid, sig, want); return { ok: true, result: 'win' }; }
  wrong(g, pid);
  return { ok: true, result: 'wrong' };
}
function win(g, pid, sig, want) {
  clear(g);
  const before = alive(g).length;
  const won = [];
  // What was showing when the bell rang, so everyone can see why it was right.
  const tops = Object.fromEntries(g.order.map(p => [p, pub(g.face[p][g.face[p].length - 1])]));
  for (const p of g.order) { won.push(...g.face[p]); g.face[p] = []; }
  const comet = !!g.comet;
  if (g.comet) { won.push(g.comet); g.comet = null; }
  g.draw[pid].push(...won);
  // Anyone else with no face-down cards left is out.
  const outNow = alive(g).filter(p => p !== pid && !g.draw[p].length);
  g.out.push(...outNow);
  g.result = { pid, sig, target: want, n: won.length, comet, out: outNow, tops };
  log(g, { k: 'win', pid, sig, target: want, n: won.length, comet });
  for (const p of outNow) log(g, { k: 'out', pid: p });
  g.ctx.fx({ type: 'win', pid, sig, target: want, n: won.length, comet, out: outNow });
  record(g);
  if (alive(g).length <= 1) return finish(g, 'last');
  if (before === 2) return finish(g, 'duel', [pid]);
  if (g.s.short && outNow.length) return finish(g, 'short');
  g.phase = 'result';
  g.nextAt = Date.now() + RESULT_MS;
  g.turn = pid;
  g.timer = setTimeout(safe(() => { g.timer = null; if (g.phase === 'result') { g.round++; g.result = null; beginTurn(g, pid); } }), RESULT_MS);
  g.ctx.broadcast();
}
function wrong(g, pid) {
  const gave = [];
  for (const p of alive(g)) {
    if (p === pid || !g.draw[pid].length) continue;
    g.draw[p].push(g.draw[pid].shift());
    gave.push(p);
  }
  g.cool[pid] = Date.now() + COOL_MS;
  log(g, { k: 'wrong', pid, n: gave.length, target: target(g) });
  g.ctx.fx({ type: 'wrong', pid, to: gave });
  // They may have just given away their last card: if it was their turn, move on.
  // If nobody could flip, the cards they gave away get the game going again.
  if (g.turn === pid && !g.draw[pid].length) beginTurn(g, nextFrom(g, pid));
  else if (!g.turn && nextFrom(g, pid)) beginTurn(g, nextFrom(g, pid));
  else g.ctx.broadcast();
}

function finish(g, why, winners) {
  clear(g);
  g.phase = 'over';
  g.turn = null;
  g.endWhy = why;
  g.final = Object.fromEntries(g.order.map(p => [p, cardsOf(g, p)]));
  if (!winners) {
    const live = alive(g);
    const pool = live.length ? live : g.order;
    const best = Math.max(...pool.map(p => g.final[p]));
    winners = pool.filter(p => g.final[p] === best);
  }
  g.winners = winners;
  log(g, { k: 'over', why, winners });
  g.ctx.fx({ type: 'over', winners });
  g.ctx.broadcast();
}

/* A player left the room for good: their cards leave the game. */
function playersChanged(g) {
  if (g.phase !== 'play' && g.phase !== 'result') return;
  const here = g.ctx.playerIds();
  const gone = alive(g).filter(p => !here.includes(p));
  if (!gone.length) return;
  for (const p of gone) { g.out.push(p); g.draw[p] = []; g.face[p] = []; log(g, { k: 'left', pid: p }); }
  record(g);
  if (alive(g).length <= 1) return finish(g, 'last');
  if (g.phase === 'play' && (!g.turn || gone.includes(g.turn))) return beginTurn(g, nextFrom(g, g.turn || g.order[0]));
  g.ctx.broadcast();
}
function playerJoined() { /* late arrivals watch until the next game */ }

/* ---------- moves ---------- */
function pick(g, pid, p) {
  if (p.a === 'ring') return ring(g, pid, Number.isInteger(p.seq) ? p.seq : null);
  if (p.a === 'flip') {
    if (g.phase !== 'play' || g.turn !== pid) return { ok: false };
    if (Date.now() < g.readyAt) return { ok: false };
    flip(g, pid, false);
    return { ok: true };
  }
  return { ok: false };
}

/* ---------- what each player sees (everything is public except the order of the piles) ---------- */
function view(g, viewer) {
  return {
    id: 'sl', settings: g.s, phase: g.phase, order: g.order, out: g.out,
    seats: Object.fromEntries(g.order.map(p => [p, {
      draw: g.draw[p].length, face: g.face[p].length,
      top: pub(g.face[p][g.face[p].length - 1]), cards: cardsOf(g, p)
    }])),
    comet: g.comet ? pub(g.comet) : null, target: target(g),
    totals: g.s.totals ? totals(g) : null,
    turn: g.turn, readyAt: g.readyAt, turnEnds: g.turnEnds, stallAt: g.stallAt,
    seq: g.seq, round: g.round, result: g.result, nextAt: g.nextAt,
    cool: (g.cool[viewer] || 0) > Date.now() ? g.cool[viewer] : 0,
    log: g.log.slice(-40), winners: g.winners, final: g.final, endWhy: g.endWhy
  };
}

module.exports = {
  id: 'sl', name: 'Starlight Signal', minPlayers: MIN_PLAYERS,
  COLOURS, FLIP_TIMES, defaults, cleanSettings, canStart,
  start, stop, pick, view, playersChanged, playerJoined,
  _signal: signal, _makeDeck: makeDeck // for tests
};
