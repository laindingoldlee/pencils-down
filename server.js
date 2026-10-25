'use strict';
/*
 * Pencils Down game server.
 * Holds every game in memory, runs the round timers, collects answers and votes,
 * and scores each round. Players connect with Socket.IO from public/index.html.
 *
 * If the server restarts (Render does this on every update, and sometimes on its own),
 * each player's page still has the last state it saw. The first page to reconnect sends
 * that state back and the game carries on from where it was.
 */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

const DEFAULT_SETTINGS = {
  rounds: 5,
  seconds: 60,
  categories: ['City', 'Country', 'Job', 'Ways to die', 'First name'],
  letters: 'ABCDEFGHIJKLMNOPRSTUVW'
};
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
const POINTS = 10;
const GET_READY_MS = 3500;
const COLLECT_MS = 1200;
const ADVANCE_DELAY_MS = 3000;           // short countdown once everyone has voted to continue
const AWAY_GRACE_MS = 30 * 1000;         // keep waiting this long for someone whose phone dropped out
const MAX_PLAYERS = 12;
const MAX_ROOMS = 500;
const LOBBY_DROP_MS = 2 * 60 * 1000;     // remove lobby players who left more than 2 minutes ago
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000; // forget games nobody has been in for 3 hours
const HOST_GRACE_MS = 15 * 1000;         // give a disconnected host 15s to come back

/* ---------- web server ---------- */
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use(express.static(PUBLIC, {
  maxAge: '5m',
  // Pages are always re-checked, so an update reaches everyone the next time they open the link.
  setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.get(/^\/[A-Za-z]{4}\/?$/, (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC, 'index.html'));
});
app.use((req, res) => res.redirect('/'));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 100 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000
});

/* ---------- helpers ---------- */
const rooms = new Map();
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const isId = v => typeof v === 'string' && /^[a-z0-9]{8,32}$/.test(v);
const isLetter = v => typeof v === 'string' && /^[A-Z]$/.test(v);
// Wraps timer callbacks so one bad moment is logged instead of stopping the whole server.
const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Error:', e); } };

function newCode() {
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function makeRoom(code) {
  const room = {
    code, hostPid: null, phase: 'lobby',
    settings: cleanSettings({}, DEFAULT_SETTINGS),
    round: 0, letter: '', usedLetters: [], startsAt: 0, endsAt: 0,
    stoppedBy: null, stopReason: null,
    players: new Map(), history: [], names: {},
    timer: null, hostTimer: null, advanceTimer: null, advanceAt: 0,
    lastActive: Date.now()
  };
  rooms.set(code, room);
  return room;
}
function newRoom() {
  const code = newCode();
  return code ? makeRoom(code) : null;
}
function newPlayer(pid, secret, name, joinedAt) {
  return { pid, secret, name, sockets: new Set(), joinedAt, answers: [], invalid: new Set(), ready: false, leftAt: 0 };
}

/* House rules from the host, or from a game being brought back, cleaned up. */
function cleanSettings(p, base) {
  const s = { rounds: base.rounds, seconds: base.seconds, categories: base.categories.slice(), letters: base.letters };
  if (p.rounds !== undefined) s.rounds = clampInt(p.rounds, 1, 20, s.rounds);
  if (p.seconds !== undefined) s.seconds = clampInt(p.seconds, 20, 300, s.seconds);
  if (Array.isArray(p.categories)) {
    const seen = new Set();
    const cats = [];
    for (const x of p.categories) {
      const v = str(x, 40);
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); cats.push(v); }
      if (cats.length >= 12) break;
    }
    if (cats.length) s.categories = cats;
  }
  if (typeof p.letters === 'string') {
    const L = ALPHABET.split('').filter(l => p.letters.toUpperCase().includes(l)).join('');
    if (L) s.letters = L;
  }
  return s;
}

const isOn = p => p.sockets.size > 0;
// Still counted as in the game: connected now, or dropped out less than AWAY_GRACE_MS ago.
const present = p => isOn(p) || (p.leftAt > 0 && Date.now() - p.leftAt < AWAY_GRACE_MS);
const connectedPlayers = room => [...room.players.values()].filter(isOn);
const orderedPlayers = room => [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);

function totals(room) {
  const t = {};
  for (const h of room.history) for (const [pid, arr] of Object.entries(h.pts)) t[pid] = (t[pid] || 0) + arr.reduce((a, b) => a + b, 0);
  return t;
}

/* Two answers count as the same when they match after ignoring capitals,
   spaces, punctuation and accents: "New York", "new york" and "NewYork!" match. */
function answerKey(a) {
  const s = String(a || '').trim();
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || s.toLowerCase();
}

/* People who wrote the same answer split the POINTS between them, rounded down,
   never below 1: one person 10, two 5 each, three 3, four or five 2, six or more 1. */
const shareOf = n => Math.max(1, Math.floor(POINTS / Math.max(1, n)));

/* Each filled answer starts at its share. Every other player who votes it invalid
   takes away an equal part of that share. Players who are gone and never voted don't count. */
function scoreRound(room) {
  const res = {};
  const n = room.settings.categories.length;
  const all = [...room.players.values()];
  const counts = Array.from({ length: n }, (_, ci) => {
    const m = new Map();
    for (const p of all) {
      const a = (p.answers[ci] || '').trim();
      if (a) { const k = answerKey(a); m.set(k, (m.get(k) || 0) + 1); }
    }
    return m;
  });
  for (const p of all) {
    res[p.pid] = Array.from({ length: n }, (_, ci) => {
      const a = (p.answers[ci] || '').trim();
      if (!a) return 0;
      const share = shareOf(counts[ci].get(answerKey(a)));
      const voters = all.filter(v => v.pid !== p.pid && (present(v) || v.invalid.size > 0));
      if (!voters.length) return share;
      const inv = voters.filter(v => v.invalid.has(p.pid + '|' + ci)).length;
      return Math.round(share * (voters.length - inv) / voters.length);
    });
  }
  return res;
}

function pickLetter(room) {
  const pool = room.settings.letters.split('');
  let avail = pool.filter(l => !room.usedLetters.includes(l));
  if (!avail.length) avail = pool;
  return avail[crypto.randomInt(avail.length)];
}

function publicState(room, forPid) {
  const ph = room.phase;
  const n = room.settings.categories.length;
  const tot = totals(room);
  const showAnswers = ph === 'review';
  const me = room.players.get(forPid);
  return {
    code: room.code,
    you: forPid,
    hostPid: room.hostPid,
    phase: ph,
    settings: room.settings,
    round: room.round,
    letter: room.letter,
    usedLetters: room.usedLetters,
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    advanceAt: room.advanceAt || 0,
    serverNow: Date.now(),
    stoppedBy: room.stoppedBy,
    stopReason: room.stopReason,
    players: orderedPlayers(room).map(p => ({
      pid: p.pid,
      name: p.name,
      connected: isOn(p),
      present: present(p),
      score: tot[p.pid] || 0,
      filled: p.answers.slice(0, n).filter(a => a && a.trim()).length,
      ready: p.ready,
      answers: showAnswers ? p.answers.slice(0, n) : undefined,
      invalid: showAnswers ? [...p.invalid] : undefined
    })),
    projected: ph === 'review' ? scoreRound(room) : undefined,
    myAnswers: (ph === 'playing' || ph === 'collecting') && me ? me.answers.slice(0, n) : undefined,
    history: room.history,
    names: room.names
  };
}
function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players.values()) {
    if (!p.sockets.size) continue;
    const st = publicState(room, p.pid);
    for (const sid of p.sockets) io.to(sid).emit('state', st);
  }
}

/* ---------- game flow ---------- */
function clearTimer(room) { if (room.timer) { clearTimeout(room.timer); room.timer = null; } }
function cancelAdvance(room) {
  if (room.advanceTimer) { clearTimeout(room.advanceTimer); room.advanceTimer = null; }
  room.advanceAt = 0;
}

function startRound(room, n, keepLetter) {
  clearTimer(room);
  cancelAdvance(room);
  room.round = n;
  if (!keepLetter || !room.letter) {
    room.letter = pickLetter(room);
    room.usedLetters.push(room.letter);
  }
  room.phase = 'playing';
  room.startsAt = Date.now() + GET_READY_MS;
  room.endsAt = room.startsAt + room.settings.seconds * 1000;
  room.stoppedBy = null;
  room.stopReason = null;
  for (const p of room.players.values()) { p.answers = []; p.invalid = new Set(); p.ready = false; }
  room.timer = setTimeout(safe(() => endRound(room, 'time', null)), room.endsAt - Date.now());
  broadcast(room);
}

function endRound(room, reason, pid) {
  if (room.phase !== 'playing') return;
  clearTimer(room);
  room.phase = 'collecting';
  room.stopReason = reason;
  room.stoppedBy = pid;
  broadcast(room);
  io.to(room.code).emit('pencilsDown');
  room.timer = setTimeout(safe(() => {
    room.timer = null;
    if (room.phase !== 'collecting') return;
    room.phase = 'review';
    broadcast(room);
  }), COLLECT_MS);
}

function advance(room) {
  cancelAdvance(room);
  if (room.phase !== 'review') return;
  room.history.push({ round: room.round, letter: room.letter, pts: scoreRound(room) });
  if (room.round >= room.settings.rounds) {
    clearTimer(room);
    room.phase = 'final';
    broadcast(room);
  } else {
    startRound(room, room.round + 1);
  }
}

/* When everyone still in the game has voted to continue, count down a few seconds
   before moving on. Anyone tapping "Ready" again to undo it stops the countdown. */
function checkAdvance(room) {
  if (room.phase !== 'review') return;
  const here = [...room.players.values()].filter(present);
  const allReady = here.length > 0 && here.every(p => p.ready);
  if (allReady && !room.advanceTimer) {
    room.advanceAt = Date.now() + ADVANCE_DELAY_MS;
    room.advanceTimer = setTimeout(safe(() => {
      room.advanceTimer = null;
      room.advanceAt = 0;
      advance(room);
    }), ADVANCE_DELAY_MS);
    broadcast(room);
  } else if (!allReady && room.advanceTimer) {
    cancelAdvance(room);
    broadcast(room);
  }
}

function ensureHost(room) {
  const host = room.players.get(room.hostPid);
  if (host && isOn(host)) return;
  const next = orderedPlayers(room).find(isOn);
  if (next) room.hostPid = next.pid;
  else if (!host) room.hostPid = null;
}

function removePlayer(room, pid) {
  const p = room.players.get(pid);
  if (!p) return;
  for (const sid of p.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s) { s.leave(room.code); s.data.code = null; s.data.pid = null; }
  }
  room.players.delete(pid);
  if (room.hostPid === pid) { room.hostPid = null; ensureHost(room); }
  checkAdvance(room);
}

function detachSocket(socket) {
  const { code, pid } = socket.data;
  if (!code) return;
  socket.data.code = null;
  socket.data.pid = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(pid);
  if (!p) return;
  p.sockets.delete(socket.id);
  if (!p.sockets.size) {
    p.leftAt = Date.now();
    if (room.hostPid === pid) {
      clearTimeout(room.hostTimer);
      room.hostTimer = setTimeout(safe(() => { ensureHost(room); broadcast(room); }), HOST_GRACE_MS);
    }
    // Once their grace period is over, stop waiting for them.
    setTimeout(safe(() => {
      if (rooms.get(code) === room && room.players.get(pid) === p && !isOn(p)) { checkAdvance(room); broadcast(room); }
    }), AWAY_GRACE_MS + 250);
  }
  broadcast(room);
}

/* Rebuild a game from the last state a player's page saw, after a server restart.
   Everyone except the player restoring it gets their place back when their own page
   reconnects. A round that was being played starts again with the same letter, and
   each page sends back what its player had typed. */
function restoreRoom(code, s) {
  if (!s || typeof s !== 'object') return null;
  const room = makeRoom(code);
  room.settings = cleanSettings(s.settings && typeof s.settings === 'object' ? s.settings : {}, DEFAULT_SETTINGS);
  const n = room.settings.categories.length;
  const phase = ['lobby', 'playing', 'collecting', 'review', 'final'].includes(s.phase) ? s.phase : 'lobby';
  room.round = clampInt(s.round, 0, 99, 0);
  room.letter = isLetter(s.letter) ? s.letter : '';
  room.usedLetters = (Array.isArray(s.usedLetters) ? s.usedLetters : []).filter(isLetter).slice(0, 100);
  room.history = (Array.isArray(s.history) ? s.history : []).slice(0, 100).map(h => {
    if (!h || typeof h !== 'object' || !h.pts || typeof h.pts !== 'object') return null;
    const pts = {};
    for (const [pid, arr] of Object.entries(h.pts).slice(0, 50)) {
      if (isId(pid) && Array.isArray(arr)) pts[pid] = arr.slice(0, 12).map(x => clampInt(x, 0, POINTS, 0));
    }
    return { round: clampInt(h.round, 1, 99, 1), letter: isLetter(h.letter) ? h.letter : '', pts };
  }).filter(Boolean);
  if (s.names && typeof s.names === 'object') {
    for (const [pid, nm] of Object.entries(s.names).slice(0, 100)) { const v = str(nm, 20); if (isId(pid) && v) room.names[pid] = v; }
  }
  const t = Date.now();
  let order = 0;
  for (const sp of (Array.isArray(s.players) ? s.players : []).slice(0, MAX_PLAYERS)) {
    if (!sp || typeof sp !== 'object' || !isId(sp.pid) || room.players.has(sp.pid)) continue;
    const pl = newPlayer(sp.pid, null, str(sp.name, 20) || 'Player', t + order++);
    pl.leftAt = t; // counts as still here while their page reconnects
    if (phase === 'review') {
      if (Array.isArray(sp.answers)) pl.answers = Array.from({ length: n }, (_, i) => str(sp.answers[i], 60));
      if (Array.isArray(sp.invalid)) pl.invalid = new Set(sp.invalid.filter(k => typeof k === 'string' && /^[a-z0-9]{8,32}\|\d{1,2}$/.test(k)).slice(0, 200));
    }
    room.players.set(pl.pid, pl);
    room.names[pl.pid] = pl.name;
  }
  room.hostPid = isId(s.hostPid) && room.players.has(s.hostPid) ? s.hostPid : null;
  const live = phase === 'playing' || phase === 'collecting' || phase === 'review';
  if (live && (room.round < 1 || !room.letter)) {
    Object.assign(room, { phase: 'lobby', round: 0, letter: '', usedLetters: [], history: [] });
  } else if (phase === 'playing' || phase === 'collecting') {
    startRound(room, room.round, true);
  } else {
    room.phase = phase;
    if (phase === 'review') {
      room.stoppedBy = isId(s.stoppedBy) ? s.stoppedBy : null;
      room.stopReason = s.stopReason === 'stop' ? 'stop' : 'time';
    }
  }
  return room;
}

/* ---------- socket events ---------- */
io.on('connection', socket => {
  socket.data = { code: null, pid: null, tokens: 60, at: Date.now() };

  // A small flood guard: about 20 events a second, bursts of 60.
  const allow = () => {
    const d = socket.data, t = Date.now();
    d.tokens = Math.min(60, d.tokens + (t - d.at) * 0.02);
    d.at = t;
    if (d.tokens < 1) return false;
    d.tokens -= 1;
    return true;
  };
  // After any refused action, send this player the real state, so their screen
  // never keeps showing a vote or a "Ready" that the server didn't record.
  const resync = () => {
    const room = rooms.get(socket.data.code);
    if (room && room.players.has(socket.data.pid)) socket.emit('state', publicState(room, socket.data.pid));
  };
  const on = (event, fn, opts) => socket.on(event, (payload, ack) => {
    const send = typeof ack === 'function' ? ack : () => {};
    const reply = r => { send(r); if (r && r.ok === false && !(opts && opts.noResync)) resync(); };
    if (!allow()) return reply({ ok: false, error: 'Slow down a little.' });
    try { fn(payload && typeof payload === 'object' ? payload : {}, reply); }
    catch (e) { console.error(event, e); reply({ ok: false, error: 'Something went wrong on the server.' }); }
  });
  const ctx = () => {
    const room = rooms.get(socket.data.code);
    const me = room && room.players.get(socket.data.pid);
    return room && me ? { room, me, isHost: room.hostPid === me.pid } : null;
  };

  function attach(room, p, reply) {
    const pid = p.pid, secret = p.secret, name = str(p.name, 20);
    if (!isId(pid) || !isId(secret)) return reply({ ok: false, error: 'Reload the page and try again.' });
    if (!name) return reply({ ok: false, error: 'Type a name first.' });
    let pl = room.players.get(pid);
    if (pl && pl.secret && pl.secret !== secret) return reply({ ok: false, error: 'Reload the page and try again.' });
    if (!pl) {
      if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: 'This game is full. Twelve players is the limit.' });
      pl = newPlayer(pid, secret, name, Date.now());
      room.players.set(pid, pl);
    }
    if (!pl.secret) pl.secret = secret; // a player from a restored game claiming their place
    if (socket.data.code && (socket.data.code !== room.code || socket.data.pid !== pid)) detachSocket(socket);
    pl.name = name;
    pl.leftAt = 0;
    room.names[pid] = name;
    pl.sockets.add(socket.id);
    socket.data.code = room.code;
    socket.data.pid = pid;
    socket.join(room.code);
    if (room.hostPid === pid) clearTimeout(room.hostTimer);
    if (!room.hostPid) room.hostPid = pid;
    reply({ ok: true, code: room.code });
    broadcast(room);
    checkAdvance(room);
  }

  on('create', (p, reply) => {
    if (rooms.size >= MAX_ROOMS) return reply({ ok: false, error: 'The server is busy. Try again in a few minutes.' });
    if (!str(p.name, 20)) return reply({ ok: false, error: 'Type a name first.' });
    const room = newRoom();
    if (!room) return reply({ ok: false, error: 'Couldn’t make a new game. Try again.' });
    attach(room, p, reply);
    if (!room.players.size) rooms.delete(room.code);
  }, { noResync: true });

  on('join', (p, reply) => {
    const code = str(p.code, 4).toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: 'There’s no game with that code. Check it, or start a new game.', gone: true });
    attach(room, p, reply);
  }, { noResync: true });

  on('restore', (p, reply) => {
    const code = str(p.code, 4).toUpperCase();
    const gone = msg => reply({ ok: false, gone: true, error: msg || 'There’s no game with that code. Check it, or start a new game.' });
    const existing = rooms.get(code);
    if (existing) {
      // Someone else's page already brought the game back: just rejoin it.
      if (existing.players.has(p.pid)) return attach(existing, p, reply);
      return gone('That game has ended. Start a new one.');
    }
    if (!/^[A-Z]{4}$/.test(code) || !isId(p.pid) || !isId(p.secret) || !str(p.name, 20)) return gone();
    if (rooms.size >= MAX_ROOMS) return gone('The server is busy. Try again in a few minutes.');
    const room = restoreRoom(code, p.snap);
    if (!room) return gone('Couldn’t bring that game back. Start a new one.');
    if (!room.players.has(p.pid)) { clearTimer(room); rooms.delete(code); return gone('Couldn’t bring that game back. Start a new one.'); }
    if (room.hostPid && room.hostPid !== p.pid) {
      room.hostTimer = setTimeout(safe(() => { ensureHost(room); broadcast(room); }), HOST_GRACE_MS);
    }
    console.log(`Brought back game ${code} after a restart (${room.phase}, round ${room.round}, ${room.players.size} players)`);
    attach(room, p, reply);
  }, { noResync: true });

  on('settings', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.phase !== 'lobby') return reply({ ok: false });
    c.room.settings = cleanSettings(p, c.room.settings);
    reply({ ok: true });
    broadcast(c.room);
  });

  on('start', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.phase !== 'lobby') return reply({ ok: false });
    const room = c.room;
    room.history = [];
    room.usedLetters = [];
    startRound(room, 1);
    reply({ ok: true });
  });

  on('answers', (p) => {
    const c = ctx();
    if (!c) return;
    const { room, me } = c;
    if ((room.phase !== 'playing' && room.phase !== 'collecting') || p.round !== room.round || !Array.isArray(p.values)) return;
    const n = room.settings.categories.length;
    const before = me.answers.filter(a => a && a.trim()).length;
    me.answers = Array.from({ length: n }, (_, i) => str(p.values[i], 60));
    const after = me.answers.filter(a => a).length;
    if (before !== after) broadcast(room);
  });

  on('stop', (p, reply) => {
    const c = ctx();
    if (!c) return reply({ ok: false });
    const { room, me } = c;
    if (room.phase !== 'playing' || Date.now() < room.startsAt) return reply({ ok: false });
    const n = room.settings.categories.length;
    if (Array.isArray(p.values) && p.round === room.round) me.answers = Array.from({ length: n }, (_, i) => str(p.values[i], 60));
    if (me.answers.slice(0, n).filter(a => a).length < n) return reply({ ok: false, error: 'Fill every box first.' });
    endRound(room, 'stop', me.pid);
    reply({ ok: true });
  });

  on('vote', (p, reply) => {
    const c = ctx();
    if (!c || c.room.phase !== 'review') return reply({ ok: false });
    const { room, me } = c;
    const target = room.players.get(p.target);
    const ci = clampInt(p.ci, 0, room.settings.categories.length - 1, -1);
    if (!target || target.pid === me.pid || ci < 0 || !(target.answers[ci] || '').trim()) return reply({ ok: false });
    const k = target.pid + '|' + ci;
    if (p.invalid) me.invalid.add(k); else me.invalid.delete(k);
    reply({ ok: true });
    broadcast(room);
  });

  on('ready', (p, reply) => {
    const c = ctx();
    if (!c || c.room.phase !== 'review') return reply({ ok: false });
    c.me.ready = !!p.ready;
    reply({ ok: true });
    broadcast(c.room);
    checkAdvance(c.room);
  });

  on('skip', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.phase !== 'review') return reply({ ok: false });
    advance(c.room);
    reply({ ok: true });
  });

  on('endGame', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || !['playing', 'collecting', 'review'].includes(c.room.phase)) return reply({ ok: false });
    clearTimer(c.room);
    cancelAdvance(c.room);
    c.room.phase = 'final';
    broadcast(c.room);
    reply({ ok: true });
  });

  on('again', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.phase !== 'final') return reply({ ok: false });
    const room = c.room;
    clearTimer(room);
    cancelAdvance(room);
    Object.assign(room, { phase: 'lobby', round: 0, letter: '', usedLetters: [], history: [], startsAt: 0, endsAt: 0, stoppedBy: null, stopReason: null });
    for (const pl of room.players.values()) { pl.answers = []; pl.invalid = new Set(); pl.ready = false; }
    // Players who have left go away so the new game starts with whoever is here.
    for (const pl of [...room.players.values()]) if (!isOn(pl)) room.players.delete(pl.pid);
    room.names = {};
    for (const pl of room.players.values()) room.names[pl.pid] = pl.name;
    broadcast(room);
    reply({ ok: true });
  });

  on('kick', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || p.pid === c.me.pid || !c.room.players.has(p.pid)) return reply({ ok: false });
    const victim = c.room.players.get(p.pid);
    for (const sid of victim.sockets) io.to(sid).emit('kicked');
    removePlayer(c.room, p.pid);
    broadcast(c.room);
    reply({ ok: true });
  });

  on('leave', (p, reply) => {
    const c = ctx();
    if (!c) return reply({ ok: true });
    const room = c.room;
    removePlayer(room, c.me.pid);
    broadcast(room);
    reply({ ok: true });
  }, { noResync: true });

  socket.on('disconnect', safe(() => detachSocket(socket)));
});

/* ---------- housekeeping ---------- */
setInterval(safe(() => {
  const t = Date.now();
  for (const room of rooms.values()) {
    const anyone = connectedPlayers(room).length > 0;
    if (!anyone && t - room.lastActive > ROOM_IDLE_MS) {
      clearTimer(room); cancelAdvance(room); clearTimeout(room.hostTimer);
      rooms.delete(room.code);
      continue;
    }
    if (room.phase === 'lobby') {
      let changed = false;
      for (const p of [...room.players.values()]) {
        if (!isOn(p) && p.leftAt && t - p.leftAt > LOBBY_DROP_MS) { room.players.delete(p.pid); delete room.names[p.pid]; changed = true; }
      }
      if (changed) { ensureHost(room); broadcast(room); }
    }
  }
}), 30 * 1000).unref();

// Log anything unexpected and keep running, so one error never wipes every game.
process.on('uncaughtException', e => console.error('Unexpected error (server kept running):', e));
process.on('unhandledRejection', e => console.error('Unexpected promise error:', e));

// If the server can't start at all (for example the port is taken), stop so the host can restart it.
server.on('error', e => { console.error('Could not start the server:', e); process.exit(1); });
server.listen(PORT, () => console.log(`Pencils Down is running on port ${PORT}`));
