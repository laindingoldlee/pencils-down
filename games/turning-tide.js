'use strict';
/*
 * The Turning Tide: A Pirate's Claim, a tactical card game for 2 to 4 captains.
 *
 * 78 cards: 56 Crew (Tide, Powder, Gale and Stone, numbered 2-15), 12 Captain's Signs
 * (1-12, the zodiac, each belonging to a force) and 10 Legendary Ships (0-9, no force).
 * Ship 0 is the Sun Ship: it counts as 10 whenever numbers are compared, fights and
 * tie-breaks alike. A card's v is the value that's compared; n is the number printed on it.
 * 16 cards go face down in a 4x4 chart, everyone gets 5, the rest are the draw pile.
 *
 * On your turn, do one thing:
 *  - Scout: turn a hidden card face up. It's yours and attacks the face-up cards beside it.
 *  - Board: play a card from your hand over a face-up card it defeats, then it attacks
 *    the cards beside it.
 *  - Draw one card (hand limit 6), or trade 2 or 3 cards for new ones.
 * A card that defeats a neighbour takes it over. Fights: a force that counters the other
 * wins (Tide > Powder > Gale > Stone > Tide); otherwise the higher number wins.
 * When the last hidden card is revealed, most locations wins. Ties: fewer cards in hand,
 * then the lower total on your locations' top cards, then a shared win.
 *
 * Each captain sits on one side of the chart (0 bottom, 1 left, 2 top, 3 right, clockwise),
 * and a card's owner is the side it faces.
 */
const crypto = require('crypto');

const FORCES = ['tide', 'powder', 'gale', 'stone'];
const BEATS = { tide: 'powder', powder: 'gale', gale: 'stone', stone: 'tide' };
// Captain's Signs go round the zodiac: fire, earth, air, water.
const SIGN_FORCE = ['powder', 'stone', 'gale', 'tide'];
const SIZE = 4;
const HAND_START = 5;
const HAND_MAX = 6;
const MAX_PLAYERS = 4;
const AWAY_MS = 20000;   // a disconnected captain scouts at random after this long

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Turning Tide error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- cards and fights ---------- */
function makeDeck() {
  const deck = [];
  let id = 1;
  for (const f of FORCES) for (let n = 2; n <= 15; n++) deck.push({ id: id++, t: 'crew', f, n, v: n });
  for (let n = 1; n <= 12; n++) deck.push({ id: id++, t: 'sign', f: SIGN_FORCE[(n - 1) % 4], n, v: n });
  for (let n = 0; n <= 9; n++) deck.push({ id: id++, t: 'ship', f: null, n, v: n === 0 ? 10 : n });
  return deck;
}
/* Does attacker a defeat defender d? Equal numbers with no counter: nobody wins. */
function beats(a, d) {
  if (a.f && d.f && a.f !== d.f) {
    if (BEATS[a.f] === d.f) return true;
    if (BEATS[d.f] === a.f) return false;
  }
  return a.v > d.v;
}

/* ---------- settings ---------- */
const defaults = () => ({});
const cleanSettings = (p, base) => Object.assign({}, base);
function canStart(s, players) {
  if (players > MAX_PLAYERS) return `The Turning Tide is for 2 to 4 captains, and ${players} are here.`;
  return null;
}

/* ---------- game ---------- */
function start(ctx) {
  const order = ctx.onlineIds().slice(0, MAX_PLAYERS);
  const deck = shuffle(makeDeck());
  const g = {
    id: 'tide', ctx, s: {}, order,
    // two captains sit across from each other
    sides: Object.fromEntries(order.map((p, i) => [p, order.length === 2 ? i * 2 : i])),
    grid: deck.splice(0, SIZE * SIZE).map(c => ({ up: false, stack: [c], owner: null })),
    hands: {}, pile: null, discard: 0,
    turn: order[crypto.randomInt(order.length)], phase: 'play',
    log: [], last: { seq: 0 }, result: null, awayTimer: null
  };
  for (const pid of order) g.hands[pid] = deck.splice(0, HAND_START);
  g.pile = deck;
  log(g, { k: 'start', pid: g.turn });
  watchAway(g);
  return g;
}
function stop(g) { if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; } }
function log(g, e) { g.log.push(e); if (g.log.length > 120) g.log.shift(); }
const top = cell => cell.stack[cell.stack.length - 1];
const hiddenLeft = g => g.grid.filter(c => !c.up).length;
function neighbours(i) {
  const r = Math.floor(i / SIZE), c = i % SIZE, out = [];
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  return out;
}
/* The card now on top of cell i attacks every face-up card beside it. */
function attack(g, i, pid) {
  const a = top(g.grid[i]);
  const fights = [];
  for (const j of neighbours(i)) {
    const cell = g.grid[j];
    if (!cell.up) continue;
    const d = top(cell);
    const won = beats(a, d);
    const took = won && cell.owner !== pid;
    fights.push({ cell: j, won, took, from: cell.owner });
    if (won) cell.owner = pid;
  }
  return fights;
}
function finishMove(g, pid, e) {
  g.last = Object.assign({ seq: g.last.seq + 1, pid }, e);
  log(g, Object.assign({ pid }, e));
  const took = (e.fights || []).filter(f => f.took).length;
  if (took) g.ctx.fx({ type: 'took', pid, n: took });
  if (!hiddenLeft(g)) return endGame(g);
  const i = g.order.indexOf(pid);
  g.turn = g.order[(i + 1) % g.order.length];
  watchAway(g);
  g.ctx.broadcast();
}

/* ---------- moves ---------- */
function canBoard(g, card) {
  return g.grid.some(c => c.up && beats(card, top(c)));
}
function pick(g, pid, p) {
  if (g.phase !== 'play') return { ok: false };
  if (!g.order.includes(pid)) return { ok: false, error: 'You’re watching this game.' };
  if (g.turn !== pid) return { ok: false, error: 'It’s not your turn.' };
  const hand = g.hands[pid];

  if (p.a === 'scout') {
    const i = Number(p.cell);
    const cell = g.grid[i];
    if (!Number.isInteger(i) || !cell || cell.up) return { ok: false, error: 'Pick a hidden location.' };
    cell.up = true;
    cell.owner = pid;
    const card = top(cell);
    finishMove(g, pid, { k: 'scout', cell: i, card: pub(card), fights: attack(g, i, pid) });
    return { ok: true };
  }

  if (p.a === 'board') {
    const i = Number(p.cell);
    const cell = g.grid[i];
    const h = hand.findIndex(c => c.id === Number(p.id));
    if (h < 0) return { ok: false, error: 'Pick a card from your hand.' };
    if (!Number.isInteger(i) || !cell || !cell.up) return { ok: false, error: 'You can only board a face-up location.' };
    const card = hand[h];
    const under = top(cell);
    if (!beats(card, under)) return { ok: false, error: 'That card can’t defeat the card on that location.' };
    hand.splice(h, 1);
    const from = cell.owner;
    cell.stack.push(card);
    cell.owner = pid;
    finishMove(g, pid, { k: 'board', cell: i, card: pub(card), under: pub(under), from, fights: attack(g, i, pid) });
    return { ok: true };
  }

  if (p.a === 'draw') {
    if (hand.length >= HAND_MAX) return { ok: false, error: `You already have ${HAND_MAX} cards.` };
    if (!g.pile.length) return { ok: false, error: 'The draw pile is empty.' };
    hand.push(g.pile.shift());
    finishMove(g, pid, { k: 'draw' });
    return { ok: true };
  }

  if (p.a === 'trade') {
    const ids = Array.isArray(p.ids) ? [...new Set(p.ids.map(Number))] : [];
    if (ids.length < 2 || ids.length > 3) return { ok: false, error: 'Trade 2 or 3 cards.' };
    if (ids.some(id => !hand.some(c => c.id === id))) return { ok: false, error: 'Pick cards from your hand.' };
    if (g.pile.length < ids.length) return { ok: false, error: g.pile.length ? `Only ${g.pile.length} card${g.pile.length === 1 ? '' : 's'} left to draw.` : 'The draw pile is empty.' };
    g.hands[pid] = hand.filter(c => !ids.includes(c.id));
    g.discard += ids.length;
    g.hands[pid].push(...g.pile.splice(0, ids.length));
    finishMove(g, pid, { k: 'trade', n: ids.length });
    return { ok: true };
  }
  return { ok: false };
}

/* A captain who has dropped out scouts a random hidden location. */
function watchAway(g) {
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  if (g.phase !== 'play' || g.ctx.onlineIds().includes(g.turn)) return;
  const turn = g.turn, seq = g.last.seq;
  g.awayTimer = setTimeout(safe(() => {
    g.awayTimer = null;
    if (g.phase !== 'play' || g.turn !== turn || g.last.seq !== seq || g.ctx.onlineIds().includes(turn)) return;
    const hidden = g.grid.map((c, i) => (c.up ? -1 : i)).filter(i => i >= 0);
    pick(g, turn, { a: 'scout', cell: hidden[crypto.randomInt(hidden.length)] });
  }), AWAY_MS);
}

/* ---------- game end ---------- */
function endGame(g) {
  stop(g);
  g.phase = 'final';
  g.turn = null;
  const rows = g.order.map(pid => {
    const mine = g.grid.filter(c => c.owner === pid);
    return { pid, locations: mine.length, hand: g.hands[pid].length, sum: mine.reduce((a, c) => a + top(c).v, 0) };
  });
  // Most locations, then fewer cards in hand, then the lower total.
  rows.sort((a, b) => b.locations - a.locations || a.hand - b.hand || a.sum - b.sum);
  const best = rows[0];
  const tiedLoc = rows.filter(r => r.locations === best.locations);
  const tiedHand = tiedLoc.filter(r => r.hand === best.hand);
  const tiedSum = tiedHand.filter(r => r.sum === best.sum);
  g.result = {
    rows,
    winners: tiedSum.map(r => r.pid),
    // which tie-breaker decided it: 0 = locations, 1 = hand, 2 = total, 3 = shared
    by: tiedLoc.length === 1 ? 0 : tiedHand.length === 1 ? 1 : tiedSum.length === 1 ? 2 : 3
  };
  log(g, { k: 'end' });
  g.ctx.broadcast();
}

/* ---------- bots ----------
   A practice captain. It decides from its own view (its hand and the face-up chart):
   it boards when a card from its hand wins locations, otherwise it scouts, and now
   and then draws or trades when its hand is short of useful cards. */
function bot(g, pid) {
  if (g.phase !== 'play' || g.turn !== pid) return null;
  const v = view(g, pid);
  const hand = v.hand || [];
  const takes = (card, i) => neighbours(i).filter(j => {
    const c = v.grid[j];
    return c.up && c.owner !== pid && beats(card, c.card);
  }).length;
  const options = [];
  const hidden = v.grid.map((c, i) => (c.up ? -1 : i)).filter(i => i >= 0);
  for (const i of hidden) {
    // An unknown card: it's ours, and it may take a neighbour or two.
    const rivalsNear = neighbours(i).filter(j => v.grid[j].up && v.grid[j].owner !== pid).length;
    options.push({ score: 1 + 0.35 * rivalsNear, move: { a: 'scout', cell: i } });
  }
  v.grid.forEach((c, i) => {
    if (!c.up) return;
    for (const card of hand) {
      if (!beats(card, c.card)) continue;
      const gain = (c.owner !== pid ? 1 : 0) + takes(card, i);
      if (gain) options.push({ score: gain + 0.4 - card.v * 0.01, move: { a: 'board', id: card.id, cell: i } });
    }
  });
  if (hand.length < v.handMax && v.pileLeft && hand.length < 3) options.push({ score: 1.1, move: { a: 'draw' } });
  if (hand.length >= 3 && v.pileLeft >= 2 && !options.some(o => o.move.a === 'board')) {
    const weak = hand.slice().sort((a, b) => a.v - b.v).slice(0, 2).map(c => c.id);
    options.push({ score: 0.6, move: { a: 'trade', ids: weak } });
  }
  for (const o of options) o.score += Math.random() * 0.6;
  options.sort((a, b) => b.score - a.score);
  return { move: options[0].move };
}

function playersChanged(g) { if (g.phase === 'play') watchAway(g); }
function playerJoined() { /* late arrivals watch until the next game */ }

/* ---------- what each player sees ---------- */
const pub = c => ({ t: c.t, f: c.f, n: c.n, v: c.v });
function view(g, viewer) {
  const over = g.phase === 'final';
  return {
    id: 'tide', phase: g.phase, order: g.order, sides: g.sides, turn: g.turn,
    grid: g.grid.map(c => (c.up ? { up: true, card: pub(top(c)), owner: c.owner, depth: c.stack.length } : { up: false })),
    hand: g.hands[viewer] ? g.hands[viewer].map(c => Object.assign({ id: c.id }, pub(c))) : null,
    handCounts: Object.fromEntries(g.order.map(p => [p, g.hands[p].length])),
    // everyone's hands are shown at the end, since they break ties
    hands: over ? Object.fromEntries(g.order.map(p => [p, g.hands[p].map(pub)])) : null,
    pileLeft: g.pile.length, discard: g.discard, hiddenLeft: hiddenLeft(g),
    handMax: HAND_MAX, last: g.last, log: g.log.slice(-60), result: g.result
  };
}

module.exports = {
  id: 'tide', name: 'The Turning Tide', minPlayers: 2,
  defaults, cleanSettings, canStart,
  start, stop, pick, view, playersChanged, playerJoined, bot,
  beats, makeDeck // for tests
};
