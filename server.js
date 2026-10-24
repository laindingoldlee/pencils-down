'use strict';
/*
 * Pencils Down game server.
 * Holds every game in memory, runs the round timers, collects answers and votes,
 * and scores each round. Players connect with Socket.IO from public/index.html.
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
const MAX_PLAYERS = 12;
const MAX_ROOMS = 500;
const LOBBY_DROP_MS = 2 * 60 * 1000;   // remove lobby players who left more than 2 minutes ago
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000; // forget games nobody has been in for 3 hours
const HOST_GRACE_MS = 15 * 1000;        // give a disconnected host 15s to come back

/* ---------- web server ---------- */
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use(express.static(PUBLIC, { maxAge: '5m' }));
app.get(/^\/[A-Za-z]{4}\/?$/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.use((req, res) => res.redirect('/'));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 32 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000
});

/* ---------- helpers ---------- */
const rooms = new Map();
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const isId = v => typeof v === 'string' && /^[a-z0-9]{8,32}$/.test(v);

function newCode() {
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function newRoom() {
  const code = newCode();
  if (!code) return null;
  const room = {
    code, hostPid: null, phase: 'lobby',
    settings: { ...DEFAULT_SETTINGS, categories: DEFAULT_SETTINGS.categories.slice() },
    round: 0, letter: '', usedLetters: [], startsAt: 0, endsAt: 0,
    stoppedBy: null, stopReason: null,
    players: new Map(), history: [], names: {},
    timer: null, hostTimer: null, lastActive: Date.now()
  };
  rooms.set(code, room);
  return room;
}
const isOn = p => p.sockets.size > 0;
const connectedPlayers = room => [...room.players.values()].filter(isOn);
const orderedPlayers = room => [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);

function totals(room) {
  const t = {};
  for (const h of room.history) for (const [pid, arr] of Object.entries(h.pts)) t[pid] = (t[pid] || 0) + arr.reduce((a, b) => a + b, 0);
  return t;
}

/* Each filled answer starts at POINTS. Every other player who votes it invalid
   takes away an equal share. Players who are gone and never voted don't count. */
function scoreRound(room) {
  const res = {};
  const n = room.settings.categories.length;
  const all = [...room.players.values()];
  for (const p of all) {
    res[p.pid] = Array.from({ length: n }, (_, ci) => {
      const a = (p.answers[ci] || '').trim();
      if (!a) return 0;
      const voters = all.filter(v => v.pid !== p.pid && (isOn(v) || v.invalid.size > 0));
      if (!voters.length) return POINTS;
      const inv = voters.filter(v => v.invalid.has(p.pid + '|' + ci)).length;
      return Math.round(POINTS * (voters.length - inv) / voters.length);
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
    serverNow: Date.now(),
    stoppedBy: room.stoppedBy,
    stopReason: room.stopReason,
    players: orderedPlayers(room).map(p => ({
      pid: p.pid,
      name: p.name,
      connected: isOn(p),
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

function startRound(room, n) {
  clearTimer(room);
  room.round = n;
  room.letter = pickLetter(room);
  room.usedLetters.push(room.letter);
  room.phase = 'playing';
  room.startsAt = Date.now() + GET_READY_MS;
  room.endsAt = room.startsAt + room.settings.seconds * 1000;
  room.stoppedBy = null;
  room.stopReason = null;
  for (const p of room.players.values()) { p.answers = []; p.invalid = new Set(); p.ready = false; }
  room.timer = setTimeout(() => endRound(room, 'time', null), room.endsAt - Date.now());
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
  room.timer = setTimeout(() => {
    room.timer = null;
    if (room.phase !== 'collecting') return;
    room.phase = 'review';
    broadcast(room);
  }, COLLECT_MS);
}

function advance(room) {
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

function checkAdvance(room) {
  if (room.phase !== 'review') return;
  const on = connectedPlayers(room);
  if (on.length && on.every(p => p.ready)) advance(room);
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
      room.hostTimer = setTimeout(() => { ensureHost(room); broadcast(room); }, HOST_GRACE_MS);
    }
    checkAdvance(room);
  }
  broadcast(room);
}

/* ---------- socket events ---------- */
io.on('connection', socket => {
  socket.data = { code: null, pid: null, tokens: 40, at: Date.now() };

  // A small rate limit: about 15 events a second, bursts of 40.
  const allow = () => {
    const d = socket.data, t = Date.now();
    d.tokens = Math.min(40, d.tokens + (t - d.at) * 0.015);
    d.at = t;
    if (d.tokens < 1) return false;
    d.tokens -= 1;
    return true;
  };
  const on = (event, fn) => socket.on(event, (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
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
    if (pl && pl.secret !== secret) return reply({ ok: false, error: 'Reload the page and try again.' });
    if (!pl) {
      if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: 'This game is full. Twelve players is the limit.' });
      pl = { pid, secret, name, sockets: new Set(), joinedAt: Date.now(), answers: [], invalid: new Set(), ready: false, leftAt: 0 };
      room.players.set(pid, pl);
    }
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
  }

  on('create', (p, reply) => {
    if (rooms.size >= MAX_ROOMS) return reply({ ok: false, error: 'The server is busy. Try again in a few minutes.' });
    if (!str(p.name, 20)) return reply({ ok: false, error: 'Type a name first.' });
    const room = newRoom();
    if (!room) return reply({ ok: false, error: 'Couldn’t make a new game. Try again.' });
    attach(room, p, reply);
    if (!room.players.size) rooms.delete(room.code);
  });

  on('join', (p, reply) => {
    const code = str(p.code, 4).toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: 'There’s no game with that code. Check it, or start a new game.', gone: true });
    attach(room, p, reply);
  });

  on('settings', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.phase !== 'lobby') return reply({ ok: false });
    const s = c.room.settings;
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
    c.room.phase = 'final';
    broadcast(c.room);
    reply({ ok: true });
  });

  on('again', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.phase !== 'final') return reply({ ok: false });
    const room = c.room;
    clearTimer(room);
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
  });

  socket.on('disconnect', () => detachSocket(socket));
});

/* ---------- housekeeping ---------- */
setInterval(() => {
  const t = Date.now();
  for (const room of rooms.values()) {
    const anyone = connectedPlayers(room).length > 0;
    if (!anyone && t - room.lastActive > ROOM_IDLE_MS) { clearTimer(room); clearTimeout(room.hostTimer); rooms.delete(room.code); continue; }
    if (room.phase === 'lobby') {
      let changed = false;
      for (const p of [...room.players.values()]) {
        if (!isOn(p) && p.leftAt && t - p.leftAt > LOBBY_DROP_MS) { room.players.delete(p.pid); delete room.names[p.pid]; changed = true; }
      }
      if (changed) { ensureHost(room); broadcast(room); }
    }
  }
}, 30 * 1000).unref();

server.listen(PORT, () => console.log(`Pencils Down is running on port ${PORT}`));
