'use strict';
/*
 * Black, White & Eleven: a hidden-number bluffing game played inside a party room.
 *
 * Tiles come in colors (black, white, then blue, red, green, yellow for bigger groups),
 * numbered 0-11. Everyone sees the color of every tile but only the numbers of their own.
 * Rows are kept in order from smallest to largest; for the same number the color order
 * above decides (black is lowest). Wildcards (optional) can go anywhere, chosen once.
 *
 * On your turn you draw a tile, then point at someone's hidden tile and name it.
 * They answer Yes or No. A No may be a lie. The guesser then accepts the No (a chip goes
 * into the Liar's Pot) or calls the bluff (the server checks; whoever was wrong flips as
 * many of their tiles as there are chips in the pot). Right guesses let you draw and guess
 * again; wrong ones flip the tile you just drew. Once every tile in your row is flipped,
 * you're out. Last one standing wins.
 */
const crypto = require('crypto');

const COLORS = ['black', 'white', 'blue', 'red', 'green', 'yellow'];
const START_TILES = 3;
const ANSWER_MS = 30000;       // a defender who doesn't answer in time answers truthfully
const AWAY_SKIP_MS = 20000;    // a disconnected player's turn is skipped after this long
const SETUP_MS = 60000;        // anyone who hasn't taken their starting tiles by then gets them dealt

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Black, White & Eleven error:', e); } };
const pickRandom = a => a[crypto.randomInt(a.length)];

/* Recommended colors: one color for every two players, at least two. */
const recommendedColors = players => Math.min(COLORS.length, Math.max(2, Math.ceil(players / 2)));

/* ---------- settings ---------- */
const defaults = () => ({ colors: 0, wilds: false }); // colors 0 = use the recommendation
function cleanSettings(p, base) {
  const s = { colors: base.colors, wilds: base.wilds };
  const c = Number(p.colors);
  if (Number.isInteger(c) && (c === 0 || (c >= 2 && c <= COLORS.length))) s.colors = c;
  if (typeof p.wilds === 'boolean') s.wilds = p.wilds;
  return s;
}

/* ---------- tiles and rows ---------- */
const isWild = t => t.n < 0;
const keyOf = (g, t) => t.n * g.colors + t.c;
/* Where a tile may go in a row: anywhere for a wildcard; otherwise between the numbered
   tiles just below and just above it, on either side of any wildcards in between. */
function slotsFor(g, row, t) {
  if (isWild(t)) return { from: 0, to: row.length };
  const k = keyOf(g, t);
  let from = 0, to = row.length;
  row.forEach((x, i) => {
    if (isWild(x)) return;
    if (keyOf(g, x) < k) from = i + 1;
    else if (to === row.length) to = i;
  });
  return { from, to };
}

/* ---------- game flow ----------
   ctx: broadcast(), fx(data), playerIds(), onlineIds() — see server.js */
function start(ctx, settings) {
  const players = ctx.onlineIds();
  const colors = settings.colors || recommendedColors(players.length);
  const g = {
    id: 'bw11', ctx, colors, wilds: !!settings.wilds,
    pool: [], hands: {}, pending: {}, order: players.slice(), dead: [], winner: null,
    phase: 'setup', setupEnds: Date.now() + SETUP_MS,
    turn: null, pot: 1, log: [], nextId: 1,
    killsBy: {}, liesCaught: 0, liesAway: 0, timer: null, awayTimer: null
  };
  for (let c = 0; c < colors; c++) {
    for (let n = 0; n <= 11; n++) g.pool.push({ id: g.nextId++, c, n, up: false });
    if (g.wilds) g.pool.push({ id: g.nextId++, c, n: -1, up: false });
  }
  for (const pid of players) { g.hands[pid] = []; g.pending[pid] = null; g.killsBy[pid] = 0; }
  g.timer = setTimeout(safe(() => finishSetup(g, true)), SETUP_MS);
  ctx.broadcast();
  return g;
}
function clear(g) {
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
}
function stop(g) { clear(g); }
const alive = g => g.order.filter(pid => !g.dead.includes(pid));
const inGame = (g, pid) => g.order.includes(pid);
function log(g, e) {
  g.log.push(Object.assign({ at: Date.now() }, e));
  if (g.log.length > 80) g.log.shift();
}

function takeFromPool(g, color) {
  const of = g.pool.filter(t => t.c === color);
  if (!of.length) return null;
  const t = pickRandom(of);
  g.pool.splice(g.pool.indexOf(t), 1);
  return t;
}
/* Put a tile in a row. Returns true if it went in, false if the player has to choose where. */
function placeOrAsk(g, pid, t) {
  const row = g.hands[pid];
  const s = slotsFor(g, row, t);
  if (s.from === s.to) { row.splice(s.from, 0, t); return true; }
  g.pending[pid] = t;
  return false;
}

/* --- setup: everyone picks the colors of their starting tiles --- */
function setupDone(g, pid) { return g.hands[pid].length >= START_TILES && !g.pending[pid]; }
function finishSetup(g, force) {
  if (g.phase !== 'setup') return;
  if (force) {
    for (const pid of g.order) {
      const row = g.hands[pid];
      if (g.pending[pid]) { const t = g.pending[pid]; row.splice(slotsFor(g, row, t).from, 0, t); g.pending[pid] = null; }
      while (row.length < START_TILES && g.pool.length) {
        const t = takeFromPool(g, pickRandom([...new Set(g.pool.map(x => x.c))]));
        row.splice(slotsFor(g, row, t).from, 0, t);
      }
    }
  }
  if (!g.order.every(pid => setupDone(g, pid))) return;
  clear(g);
  g.phase = 'play';
  log(g, { k: 'start' });
  startTurn(g, pickRandom(g.order));
}

/* --- turns --- */
function startTurn(g, pid) {
  clear(g);
  g.turn = { pid, step: 'draw', drawn: null, guess: null, streak: {}, right: 0 };
  beginDraw(g);
}
function beginDraw(g) {
  const t = g.turn;
  t.guess = null;
  t.drawn = null;
  t.step = g.pool.length ? 'draw' : 'guess';
  watchAway(g);
  g.ctx.broadcast();
}
function nextTurn(g) {
  if (checkOver(g)) return;
  const a = alive(g);
  const i = g.order.indexOf(g.turn.pid);
  let next = null;
  for (let k = 1; k <= g.order.length; k++) {
    const pid = g.order[(i + k) % g.order.length];
    if (a.includes(pid)) { next = pid; break; }
  }
  startTurn(g, next);
}
function checkOver(g) {
  const a = alive(g);
  if (a.length > 1) return false;
  clear(g);
  g.phase = 'over';
  g.winner = a[0] || null;
  if (g.turn) g.turn.step = 'done';
  log(g, { k: 'over', pid: g.winner });
  g.ctx.broadcast();
  return true;
}

/* If the player whose move it is has dropped out, move the game along after a while. */
function watchAway(g) {
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  if (g.phase !== 'play' || !g.turn) return;
  const t = g.turn;
  const waitingOn = t.step === 'answer' ? t.guess.target : t.pid;
  if (g.ctx.onlineIds().includes(waitingOn)) return;
  g.awayTimer = setTimeout(safe(() => {
    g.awayTimer = null;
    if (g.phase !== 'play' || g.turn !== t || g.ctx.onlineIds().includes(waitingOn)) return;
    if (t.step === 'answer') return answer(g, t.guess.target, { yes: t.guess.right });
    if (t.step === 'place') { const row = g.hands[t.pid]; const d = g.pending[t.pid]; row.splice(slotsFor(g, row, d).from, 0, d); g.pending[t.pid] = null; }
    log(g, { k: 'skip', pid: t.pid });
    nextTurn(g);
  }), AWAY_SKIP_MS);
}

/* Flip a tile face up. credit is who gets the kill if that was the owner's last hidden tile. */
function flip(g, owner, tile, credit) {
  if (tile.up) return;
  tile.up = true;
  g.ctx.fx({ type: 'flip', pid: owner, id: tile.id });
  if (g.dead.includes(owner) || g.hands[owner].some(t => !t.up)) return;
  g.dead.push(owner);
  let streak = 0;
  if (credit && credit !== owner) {
    g.killsBy[credit] = (g.killsBy[credit] || 0) + 1;
    streak = g.turn.streak[credit] = (g.turn.streak[credit] || 0) + 1;
  }
  log(g, { k: 'kill', pid: owner, by: credit !== owner ? credit : null, streak });
  g.ctx.fx({ type: 'kill', pid: owner, by: credit !== owner ? credit : null, streak, bluff: !!g.bluffing });
}
function flipRandom(g, owner, count, credit) {
  const hidden = g.hands[owner].filter(t => !t.up);
  const out = [];
  for (let i = 0; i < count && hidden.length; i++) out.push(hidden.splice(crypto.randomInt(hidden.length), 1)[0]);
  for (const t of out) flip(g, owner, t, credit);
  return out.length;
}

function afterRight(g) {
  if (checkOver(g)) return;
  g.turn.right += 1;
  g.turn.step = 'more';
  g.turn.guess = null;
  watchAway(g);
  g.ctx.broadcast();
}
/* A wrong guess: the guesser shows the tile they drew this time (if it's still hidden). */
function penalty(g, credit) {
  const t = g.turn;
  const d = t.drawn && g.hands[t.pid].find(x => x.id === t.drawn);
  if (d && !d.up) flip(g, t.pid, d, credit);
}

/* ---------- moves ---------- */
function pick(g, pid, p) {
  if (g.phase === 'setup') return setupMove(g, pid, p);
  if (g.phase !== 'play' || !g.turn) return { ok: false };
  const t = g.turn;
  if (p.a === 'answer') return answer(g, pid, p);
  if (pid !== t.pid) return { ok: false, error: 'It’s not your turn.' };

  if (p.a === 'draw') {
    if (t.step !== 'draw') return { ok: false };
    const tile = takeFromPool(g, Number(p.color));
    if (!tile) return { ok: false, error: 'There are no tiles of that color left.' };
    t.drawn = tile.id;
    t.step = placeOrAsk(g, pid, tile) ? 'guess' : 'place';
    log(g, { k: 'draw', pid, c: tile.c });
    g.ctx.broadcast();
    return { ok: true };
  }
  if (p.a === 'place') {
    if (t.step !== 'place') return { ok: false };
    if (!placePending(g, pid, p.slot)) return { ok: false, error: 'That tile can’t go there.' };
    t.step = 'guess';
    g.ctx.broadcast();
    return { ok: true };
  }
  if (p.a === 'guess') {
    if (t.step !== 'guess') return { ok: false };
    const target = p.target;
    if (target === pid || !inGame(g, target) || g.dead.includes(target)) return { ok: false, error: 'Pick a tile from someone still in the game.' };
    const tile = g.hands[target].find(x => x.id === p.id);
    if (!tile || tile.up) return { ok: false, error: 'Pick a tile that’s still hidden.' };
    const value = p.value === 'wild' ? -1 : Number(p.value);
    if (!(Number.isInteger(value) && value >= -1 && value <= 11) || (value === -1 && !g.wilds)) return { ok: false };
    t.guess = { target, id: tile.id, idx: g.hands[target].indexOf(tile), c: tile.c, value, right: tile.n === value };
    t.step = 'answer';
    t.answerEnds = Date.now() + ANSWER_MS;
    g.timer = setTimeout(safe(() => { if (g.turn === t && t.step === 'answer') answer(g, target, { yes: t.guess.right }); }), ANSWER_MS);
    watchAway(g);
    g.ctx.broadcast();
    return { ok: true };
  }
  if (p.a === 'call' || p.a === 'accept') {
    if (t.step !== 'verdict') return { ok: false };
    return verdict(g, p.a === 'call');
  }
  if (p.a === 'more' || p.a === 'stop') {
    if (t.step !== 'more') return { ok: false };
    if (p.a === 'stop') { log(g, { k: 'stop', pid }); nextTurn(g); }
    else beginDraw(g);
    return { ok: true };
  }
  return { ok: false };
}

function placePending(g, pid, slot) {
  const tile = g.pending[pid];
  if (!tile) return false;
  const s = slotsFor(g, g.hands[pid], tile);
  slot = Number(slot);
  if (!Number.isInteger(slot) || slot < s.from || slot > s.to) return false;
  g.hands[pid].splice(slot, 0, tile);
  g.pending[pid] = null;
  return true;
}

function setupMove(g, pid, p) {
  if (!inGame(g, pid)) return { ok: false, error: 'This game started before you joined. You can watch.' };
  if (p.a === 'place') {
    if (!placePending(g, pid, p.slot)) return { ok: false };
  } else if (p.a === 'draw') {
    if (g.pending[pid] || g.hands[pid].length >= START_TILES) return { ok: false };
    const tile = takeFromPool(g, Number(p.color));
    if (!tile) return { ok: false, error: 'There are no tiles of that color left.' };
    placeOrAsk(g, pid, tile);
  } else return { ok: false };
  if (g.order.every(x => setupDone(g, x))) finishSetup(g);
  else g.ctx.broadcast();
  return { ok: true };
}

function answer(g, pid, p) {
  const t = g.turn;
  if (!t || t.step !== 'answer' || pid !== t.guess.target) return { ok: false };
  const yes = !!p.yes;
  if (yes && !t.guess.right) return { ok: false, error: 'That guess is wrong, so the answer has to be No.' };
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  const tile = g.hands[t.guess.target].find(x => x.id === t.guess.id);
  if (yes) {
    log(g, { k: 'guess', pid: t.pid, target: t.guess.target, c: t.guess.c, idx: t.guess.idx, value: t.guess.value, res: 'yes' });
    flip(g, t.guess.target, tile, t.pid);
    afterRight(g);
  } else {
    t.guess.lie = t.guess.right;
    t.step = 'verdict';
    watchAway(g);
    g.ctx.broadcast();
  }
  return { ok: true };
}

function verdict(g, call) {
  const t = g.turn, gu = t.guess;
  const defender = gu.target;
  const base = { k: 'guess', pid: t.pid, target: defender, c: gu.c, idx: gu.idx, value: gu.value };
  if (!call) {
    if (gu.lie) g.liesAway += 1;
    g.pot += 1;
    log(g, Object.assign(base, { res: 'accept', pot: g.pot }));
    penalty(g, defender);
    nextTurn(g);
    return { ok: true };
  }
  const stake = g.pot;
  g.pot = 1;
  g.bluffing = true; // knock-outs from here on were caused by a called bluff
  try {
  if (gu.lie) {
    g.liesCaught += 1;
    const tile = g.hands[defender].find(x => x.id === gu.id);
    log(g, Object.assign(base, { res: 'caught', stake }));
    g.ctx.fx({ type: 'bluff', caught: true, pid: defender, by: t.pid, stake });
    flip(g, defender, tile, t.pid);
    flipRandom(g, defender, stake, t.pid);
  } else {
    log(g, Object.assign(base, { res: 'truth', stake }));
    g.ctx.fx({ type: 'bluff', caught: false, pid: t.pid, by: defender, stake });
    penalty(g, defender);
    flipRandom(g, t.pid, stake, defender);
  }
  } finally { g.bluffing = false; }
  if (gu.lie) afterRight(g); else nextTurn(g);
  return { ok: true };
}

/* ---------- room events ---------- */
function playersChanged(g) {
  if (g.phase === 'play') watchAway(g);
}
function playerJoined() { /* people who arrive mid-game watch until the next one */ }

/* ---------- what each player sees ---------- */
function view(g, viewer) {
  const t = g.turn;
  const over = g.phase === 'over';
  const hands = {};
  for (const pid of g.order) {
    hands[pid] = g.hands[pid].map(x => ({
      id: x.id, c: x.c, up: x.up,
      n: (x.up || pid === viewer || over) ? x.n : null
    }));
  }
  const counts = Array.from({ length: g.colors }, (_, c) => g.pool.filter(x => x.c === c).length);
  let mine = null;
  const pend = g.pending[viewer];
  if (pend) mine = { pending: { c: pend.c, n: pend.n }, slots: slotsFor(g, g.hands[viewer], pend) };
  let turn = null;
  if (t) {
    turn = { pid: t.pid, step: t.step, drawn: t.drawn, right: t.right, answerEnds: t.answerEnds || 0 };
    if (t.guess) {
      turn.guess = { target: t.guess.target, id: t.guess.id, value: t.guess.value };
      if (viewer === t.guess.target) turn.guess.right = t.guess.right;
    }
  }
  return {
    id: 'bw11', colors: g.colors, colorNames: COLORS.slice(0, g.colors), wilds: g.wilds,
    phase: g.phase, setupEnds: g.setupEnds, order: g.order, dead: g.dead, winner: g.winner,
    pool: counts, poolLeft: g.pool.length, pot: g.pot,
    hands, mine, turn, log: g.log.slice(-30), killsBy: g.killsBy,
    lies: over ? { caught: g.liesCaught, away: g.liesAway } : null,
    setupDone: g.phase === 'setup' ? g.order.filter(pid => setupDone(g, pid)) : null
  };
}

module.exports = {
  id: 'bw11', name: 'Black, White & Eleven', minPlayers: 2,
  COLORS, recommendedColors, defaults, cleanSettings,
  start, stop, pick, view, playersChanged, playerJoined,
  slotsFor // for tests
};
