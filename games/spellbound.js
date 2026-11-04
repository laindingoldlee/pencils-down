'use strict';
/*
 * Spellbound Mayhem (咒語大亂鬥): a spell-guessing game played inside a party room.
 *
 * Everyone holds spell stones they can't see, while seeing everyone else's. On your turn
 * you name a spell you think you hold. Right: it's cast, and you may keep going. Wrong:
 * you lose a life and your turn ends. At the end of your turn your rack is refilled.
 * A round ends at the first knock-out, or when someone casts every stone in their rack.
 * Points carry over between rounds; first to the target wins.
 *
 * Spell n (1-9) has n copies by default. Every number here can be changed by the host.
 */
const crypto = require('crypto');

const SPELLS = 9;
const AWAY_SKIP_MS = 20000;   // a disconnected player's turn ends after this long
const ROUND_END_MS = 9000;    // how long the round summary stays up
const WHEEL = ['heal', 'hurt', 'left', 'right', 'all', 'peek', 'laugh', 'laugh'];

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Spellbound error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/* ---------- settings ---------- */
const defaults = () => ({
  stones: 5, lives: 6, maxLives: 6, target: 10,
  killPts: 3, clearPts: 3, selfPts: 1,
  copies: [1, 2, 3, 4, 5, 6, 7, 8, 9]
});
function cleanSettings(p, base) {
  const s = JSON.parse(JSON.stringify(base));
  if (p.stones !== undefined) s.stones = clampInt(p.stones, 2, 8, s.stones);
  if (p.lives !== undefined) s.lives = clampInt(p.lives, 1, 15, s.lives);
  if (p.maxLives !== undefined) s.maxLives = clampInt(p.maxLives, 1, 20, s.maxLives);
  if (p.target !== undefined) s.target = clampInt(p.target, 1, 50, s.target);
  if (p.killPts !== undefined) s.killPts = clampInt(p.killPts, 0, 10, s.killPts);
  if (p.clearPts !== undefined) s.clearPts = clampInt(p.clearPts, 0, 10, s.clearPts);
  if (p.selfPts !== undefined) s.selfPts = clampInt(p.selfPts, 0, 10, s.selfPts);
  if (Array.isArray(p.copies)) s.copies = Array.from({ length: SPELLS }, (_, i) => clampInt(p.copies[i], 0, 15, s.copies[i]));
  if (s.maxLives < s.lives) s.maxLives = s.lives;
  return s;
}
function canStart(s, players) {
  const total = s.copies.reduce((a, b) => a + b, 0);
  if (total < players * s.stones) return `符石不夠：${players} 位玩家每人 ${s.stones} 顆需要 ${players * s.stones} 顆，但只有 ${total} 顆。請增加符石數量。`;
  return null;
}

/* ---------- game ---------- */
function start(ctx, settings) {
  const order = shuffle(ctx.onlineIds().slice());
  const g = {
    id: 'spell', ctx, s: JSON.parse(JSON.stringify(settings)),
    order, scores: {}, round: 0, starter: -1,
    phase: 'play', lives: {}, racks: {}, known: {}, status: {}, pile: [], discard: [],
    turn: null, deaths: [], cleared: null, summary: null, winners: null,
    log: [], nextId: 1, timer: null, awayTimer: null, nextRoundAt: 0
  };
  for (const pid of order) g.scores[pid] = 0;
  startRound(g);
  return g;
}
function clear(g) {
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
}
function stop(g) { clear(g); }
function log(g, e) { g.log.push(e); if (g.log.length > 80) g.log.shift(); }
const others = (g, pid) => g.order.filter(x => x !== pid);

function startRound(g) {
  clear(g);
  g.round += 1;
  g.phase = 'play';
  g.deaths = []; g.cleared = null; g.summary = null; g.discard = [];
  g.pile = [];
  g.s.copies.forEach((n, i) => { for (let k = 0; k < n; k++) g.pile.push({ id: g.nextId++, n: i + 1 }); });
  shuffle(g.pile);
  for (const pid of g.order) {
    g.lives[pid] = g.s.lives;
    g.racks[pid] = g.pile.splice(0, g.s.stones);
    g.known[pid] = new Set();
    g.status[pid] = { phoenix: false, curse: null, silenced: false, link: null, fog: null };
  }
  g.starter = (g.starter + 1) % g.order.length;
  log(g, { k: 'round', n: g.round });
  startTurn(g, g.order[g.starter]);
}

function startTurn(g, pid) {
  clear(g);
  // Life Link and Fog cast by this player wear off now.
  g.status[pid].link = null;
  for (const x of g.order) if (g.status[x].fog === pid) g.status[x].fog = null;
  g.turn = { pid, step: 'cast', casts: 0, spell: 0 };
  if (g.status[pid].silenced) {
    g.status[pid].silenced = false;
    log(g, { k: 'silenced', pid });
    g.ctx.fx({ type: 'silenced', pid });
    return nextTurn(g);
  }
  const curser = g.status[pid].curse;
  if (curser) {
    log(g, { k: 'curse-tick', pid, by: curser });
    damage(g, pid, 1, curser);
    if (checkRoundEnd(g)) return;
  }
  watchAway(g);
  g.ctx.broadcast();
}
function endTurn(g) {
  const pid = g.turn.pid;
  const rack = g.racks[pid];
  while (rack.length < g.s.stones && g.pile.length) rack.push(g.pile.shift());
  nextTurn(g);
}
function nextTurn(g) {
  const i = g.order.indexOf(g.turn.pid);
  startTurn(g, g.order[(i + 1) % g.order.length]);
}

function watchAway(g) {
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  if (g.phase !== 'play' || !g.turn) return;
  const t = g.turn;
  if (g.ctx.onlineIds().includes(t.pid)) return;
  g.awayTimer = setTimeout(safe(() => {
    g.awayTimer = null;
    if (g.phase !== 'play' || g.turn !== t || g.ctx.onlineIds().includes(t.pid)) return;
    log(g, { k: 'away', pid: t.pid });
    endTurn(g);
  }), AWAY_SKIP_MS);
}

/* ---------- life ---------- */
function heal(g, pid, n) {
  g.lives[pid] = Math.min(g.s.maxLives, g.lives[pid] + n);
}
/* Take life away. source is who caused it (the player themself for their own mistakes).
   Life Link passes the same loss on to the linked player. */
function damage(g, pid, n, source, seen) {
  seen = seen || new Set();
  if (seen.has(pid) || g.lives[pid] <= 0) return;
  seen.add(pid);
  g.lives[pid] -= n;
  g.ctx.fx({ type: 'hurt', pid, n });
  if (g.lives[pid] <= 0) {
    if (g.status[pid].phoenix) {
      g.status[pid].phoenix = false;
      g.lives[pid] = 1;
      log(g, { k: 'phoenix', pid });
      g.ctx.fx({ type: 'phoenix', pid });
    } else {
      g.lives[pid] = 0;
      g.deaths.push({ pid, by: source });
      log(g, { k: 'dead', pid, by: source === pid ? null : source });
      g.ctx.fx({ type: 'dead', pid, by: source === pid ? null : source });
    }
  }
  const link = g.status[pid].link;
  if (link && g.lives[link] > 0) damage(g, link, n, source === pid ? pid : source, seen);
}

/* ---------- round end and scoring ---------- */
function checkRoundEnd(g) {
  if (!g.deaths.length && !g.cleared) return false;
  clear(g);
  const pts = {};
  const add = (pid, n) => { if (n) { pts[pid] = (pts[pid] || 0) + n; g.scores[pid] += n; } };
  for (const d of g.deaths) {
    if (d.by && d.by !== d.pid) add(d.by, g.s.killPts);
    else for (const o of others(g, d.pid)) add(o, g.s.selfPts);
  }
  if (g.cleared) add(g.cleared, g.s.clearPts);
  g.summary = { deaths: g.deaths.slice(), cleared: g.cleared, pts };
  g.turn = null;
  const top = Math.max(...g.order.map(p => g.scores[p]));
  if (top >= g.s.target) {
    g.phase = 'over';
    g.winners = g.order.filter(p => g.scores[p] === top);
    log(g, { k: 'over', pids: g.winners });
  } else {
    g.phase = 'roundEnd';
    g.nextRoundAt = Date.now() + ROUND_END_MS;
    g.timer = setTimeout(safe(() => startRound(g)), ROUND_END_MS);
  }
  g.ctx.broadcast();
  return true;
}

/* ---------- casting ---------- */
const NEEDS = { 2: 2, 4: 1, 5: 1, 6: 1, 7: 1 }; // spells that need targets, and how many

function pick(g, pid, p) {
  if (g.phase !== 'play' || !g.turn || g.turn.pid !== pid) return { ok: false, error: '還沒輪到你。' };
  const t = g.turn;
  if (p.a === 'cast') {
    if (t.step !== 'cast') return { ok: false };
    const n = Number(p.spell);
    if (!Number.isInteger(n) || n < 1 || n > SPELLS) return { ok: false };
    const rack = g.racks[pid];
    const i = rack.findIndex(x => x.n === n);
    if (i < 0) {
      log(g, { k: 'miss', pid, n });
      g.ctx.fx({ type: 'miss', pid, n });
      damage(g, pid, 1, pid);
      if (!checkRoundEnd(g)) endTurn(g);
      return { ok: true, hit: false };
    }
    const stone = rack.splice(i, 1)[0];
    g.known[pid].delete(stone.id);
    g.discard.push(stone.n);
    t.casts += 1;
    g.status[pid].curse = null; // a correct cast lifts a curse
    log(g, { k: 'cast', pid, n });
    g.ctx.fx({ type: 'cast', pid, n });
    if (NEEDS[n] && others(g, pid).length) {
      t.step = 'target'; t.spell = n;
      g.ctx.broadcast();
      return { ok: true, hit: true };
    }
    resolve(g, pid, n, []);
    return { ok: true, hit: true };
  }
  if (p.a === 'target') {
    if (t.step !== 'target') return { ok: false };
    const want = Math.min(NEEDS[t.spell], others(g, pid).length);
    const ts = Array.isArray(p.targets) ? [...new Set(p.targets)] : [];
    if (ts.length !== want || ts.some(x => x === pid || !g.order.includes(x))) return { ok: false, error: want === 2 ? '請選兩位不同的玩家。' : '請選一位玩家。' };
    resolve(g, pid, t.spell, ts);
    return { ok: true };
  }
  if (p.a === 'end') {
    if (t.step !== 'cast') return { ok: false };
    if (!t.casts) return { ok: false, error: '至少要施放一次咒語才能結束回合。' };
    log(g, { k: 'end', pid });
    endTurn(g);
    return { ok: true };
  }
  return { ok: false };
}

function resolve(g, pid, n, targets) {
  const t = g.turn;
  const S = g.status;
  const order = g.order, i = order.indexOf(pid);
  const left = order[(i - 1 + order.length) % order.length];
  const right = order[(i + 1) % order.length];
  switch (n) {
    case 1: { // All In
      const roll = 1 + crypto.randomInt(6);
      log(g, { k: 'dice', pid, roll });
      g.ctx.fx({ type: 'dice', pid, roll });
      if (roll === 1) damage(g, pid, 2, pid);
      else for (const o of others(g, pid)) damage(g, o, 2, pid);
      break;
    }
    case 2: // Double Drain
      for (const o of targets) damage(g, o, 1, pid);
      heal(g, pid, 2);
      break;
    case 3: S[pid].phoenix = true; break;
    case 4: S[targets[0]].curse = pid; break;
    case 5: S[targets[0]].silenced = true; break;
    case 6: S[pid].link = targets[0]; break;
    case 7: S[targets[0]].fog = pid; break;
    case 8: { // Wheel of Fate
      const slice = crypto.randomInt(WHEEL.length);
      const w = WHEEL[slice];
      let peekId = null;
      if (w === 'heal') heal(g, pid, 1);
      else if (w === 'hurt') damage(g, pid, 1, pid);
      else if (w === 'left') damage(g, left, 1, pid);
      else if (w === 'right') damage(g, right, 1, pid);
      else if (w === 'all') for (const x of order) heal(g, x, 1);
      else if (w === 'peek') {
        const unknown = g.racks[pid].filter(x => !g.known[pid].has(x.id));
        if (unknown.length) { peekId = unknown[crypto.randomInt(unknown.length)].id; g.known[pid].add(peekId); }
      }
      log(g, { k: 'wheel', pid, w, left, right });
      g.ctx.fx({ type: 'wheel', pid, slice, w });
      break;
    }
    case 9: heal(g, pid, 1); break;
  }
  if (n !== 1 && n !== 8 && targets.length) log(g, { k: 'target', pid, n, targets });
  t.step = 'cast'; t.spell = 0;
  if (!g.racks[pid].length) g.cleared = pid;
  if (checkRoundEnd(g)) return;
  watchAway(g);
  g.ctx.broadcast();
}

function playersChanged(g) { if (g.phase === 'play') watchAway(g); }
function playerJoined() { /* late arrivals watch until the next game */ }

/* ---------- what each player sees ---------- */
function view(g, viewer) {
  const reveal = g.phase !== 'play';
  const racks = {};
  for (const pid of g.order) {
    const fogged = !!g.status[pid].fog && !reveal;
    racks[pid] = g.racks[pid].map(x => ({
      id: x.id,
      n: reveal || (pid === viewer ? g.known[pid].has(x.id) : !fogged) ? x.n : null
    }));
  }
  const status = {};
  for (const pid of g.order) {
    const st = g.status[pid];
    status[pid] = { phoenix: st.phoenix, curse: st.curse, silenced: st.silenced, link: st.link, fog: st.fog };
  }
  return {
    id: 'spell', settings: g.s, phase: g.phase, round: g.round, order: g.order,
    scores: g.scores, lives: g.lives, racks, status, pileLeft: g.pile.length, discard: g.discard,
    turn: g.turn ? { pid: g.turn.pid, step: g.turn.step, casts: g.turn.casts, spell: g.turn.spell } : null,
    summary: g.summary, nextRoundAt: g.nextRoundAt, winners: g.winners, log: g.log.slice(-30)
  };
}

module.exports = {
  id: 'spell', name: 'Spellbound Mayhem', minPlayers: 2,
  defaults, cleanSettings, canStart,
  start, stop, pick, view, playersChanged, playerJoined,
  _startRound: startRound // for tests
};
