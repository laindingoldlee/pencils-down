'use strict';
/*
 * Party games server.
 *
 * Friends meet in a party room (public/index.html), send emotes, and the host picks a game:
 *  - Games that run inside the room live in games/ and plug in through GAMES below
 *    (The Fifth Element so far).
 *  - Pencils Down has its own page and server code (games/pencils-down.js). Starting it
 *    opens a Pencils Down game with the room's code and sends everyone there.
 *
 * Everything is kept in memory. If the server restarts, each page reconnects and the
 * room comes back with the same code; a game that was being played is lost.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const pencilsDownServer = require('./games/pencils-down');
const fifth = require('./games/fifth-element');
const bw11 = require('./games/black-white-eleven');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

const GAMES = { fifth, bw11 };                 // games played inside the room
const ALL_GAMES = ['pencils', 'fifth', 'bw11']; // everything the host can pick
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
const MAX_PLAYERS = 20;
const MAX_ROOMS = 500;
const DROP_MS = 2 * 60 * 1000;            // forget players who left the room more than 2 minutes ago
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;  // forget rooms nobody has been in for 3 hours
const HOST_GRACE_MS = 15 * 1000;          // give a disconnected host 15s to come back
const EMOTE_GAP_MS = 600;                 // one emote per player this often

/* ---------- emotes ---------- */
function loadEmotes() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'art', 'emotes', 'emotes.json'), 'utf8'));
    return (raw.emotes || []).filter(e => e && /^[a-z0-9-]{1,30}$/.test(e.id)).map(e => ({
      id: e.id,
      label: String(e.label || e.id).slice(0, 30),
      emoji: String(e.emoji || '').slice(0, 8),
      src: /^[A-Za-z0-9_.-]+\.(png|gif|svg|webp)$/.test(e.file || '') ? '/art/emotes/' + e.file : ''
    })).slice(0, 24);
  } catch (e) { console.error('Could not read the emote list:', e.message); return []; }
}
const EMOTES = loadEmotes();
/* Recorded announcer sounds for Black, White & Eleven, if any have been added,
   named single-kill, double-kill, triple-kill, quadra-kill, rampage (.mp3/.m4a/.wav/.ogg). */
function loadSounds(dir, urlBase) {
  const out = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^([a-z0-9-]+)\.(mp3|m4a|wav|ogg|webm)$/i);
      if (m) out[m[1].toLowerCase()] = urlBase + f;
    }
  } catch (e) { /* no sounds yet */ }
  return out;
}
const CATALOG = {
  emotes: EMOTES,
  fifth: { themes: fifth.THEMES, deckSizes: fifth.DECK_SIZES },
  bw11: { colors: bw11.COLORS, sounds: loadSounds(path.join(PUBLIC, 'games', 'bw11', 'sounds'), '/games/bw11/sounds/') }
};

/* ---------- web server ---------- */
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/catalog.json', (req, res) => { res.set('Cache-Control', 'no-cache'); res.json(CATALOG); });
app.use(express.static(PUBLIC, {
  maxAge: '5m',
  // Pages and scripts are always re-checked, so an update reaches everyone the next time they open the link.
  setHeaders: (res, file) => { if (/\.(html|js|json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.get(/^\/pencils-down\/[A-Za-z]{4}\/?$/, (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC, 'pencils-down', 'index.html'));
});
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
const pd = pencilsDownServer(io, { codeTaken: c => rooms.has(c) });
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = v => typeof v === 'string' && /^[a-z0-9]{8,32}$/.test(v);
const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Error:', e); } };
const isOn = p => p.sockets.size > 0;
const orderedPlayers = room => [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);

function newCode() {
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c) && !pd.rooms.has(c)) return c;
  }
  return null;
}
function makeRoom(code) {
  const room = {
    code, hostPid: null, players: new Map(),
    selected: 'fifth',
    settings: Object.fromEntries(Object.entries(GAMES).map(([id, G]) => [id, G.defaults()])),
    game: null,          // a game being played inside the room
    pencils: false,      // a Pencils Down game was opened from this room
    hostTimer: null, lastActive: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function publicState(room, forPid) {
  return {
    code: room.code,
    you: forPid,
    hostPid: room.hostPid,
    players: orderedPlayers(room).map(p => ({ pid: p.pid, name: p.name, connected: isOn(p) })),
    selected: room.selected,
    settings: room.settings,
    pencils: room.pencils,
    game: room.game ? GAMES[room.game.id].view(room.game, forPid) : null,
    serverNow: Date.now()
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
function gameCtx(room) {
  return {
    broadcast: () => broadcast(room),
    fx: data => io.to(room.code).emit('fx', data),
    playerIds: () => [...room.players.keys()],
    onlineIds: () => [...room.players.values()].filter(isOn).map(p => p.pid)
  };
}
function endGame(room) {
  if (room.game) { GAMES[room.game.id].stop(room.game); room.game = null; }
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
  if (room.game) GAMES[room.game.id].playersChanged(room.game);
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
    if (room.game) GAMES[room.game.id].playersChanged(room.game);
  }
  broadcast(room);
}

/* ---------- socket events ---------- */
io.on('connection', socket => {
  socket.data = { code: null, pid: null, tokens: 60, at: Date.now(), emoteAt: 0 };

  // A small flood guard: about 20 events a second, bursts of 60.
  const allow = () => {
    const d = socket.data, t = Date.now();
    d.tokens = Math.min(60, d.tokens + (t - d.at) * 0.02);
    d.at = t;
    if (d.tokens < 1) return false;
    d.tokens -= 1;
    return true;
  };
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
      if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: `This room is full. ${MAX_PLAYERS} players is the limit.` });
      pl = { pid, secret, name, sockets: new Set(), joinedAt: Date.now(), leftAt: 0 };
      room.players.set(pid, pl);
    }
    if (!pl.secret) pl.secret = secret;
    if (socket.data.code && (socket.data.code !== room.code || socket.data.pid !== pid)) detachSocket(socket);
    pl.name = name;
    pl.leftAt = 0;
    pl.sockets.add(socket.id);
    socket.data.code = room.code;
    socket.data.pid = pid;
    socket.join(room.code);
    if (room.hostPid === pid) clearTimeout(room.hostTimer);
    if (!room.hostPid || !room.players.has(room.hostPid)) room.hostPid = pid;
    if (room.game) GAMES[room.game.id].playerJoined(room.game, pid);
    reply({ ok: true, code: room.code });
    broadcast(room);
  }

  on('create', (p, reply) => {
    if (rooms.size >= MAX_ROOMS) return reply({ ok: false, error: 'The server is busy. Try again in a few minutes.' });
    if (!str(p.name, 20)) return reply({ ok: false, error: 'Type a name first.' });
    const code = newCode();
    if (!code) return reply({ ok: false, error: 'Couldn’t make a new room. Try again.' });
    const room = makeRoom(code);
    attach(room, p, reply);
    if (!room.players.size) rooms.delete(room.code);
  }, { noResync: true });

  on('join', (p, reply) => {
    const code = str(p.code, 4).toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, gone: true, error: 'There’s no room with that code. Check it, or start a new room.' });
    attach(room, p, reply);
  }, { noResync: true });

  // The server restarted and forgot the room: the first page back brings it back with the same code.
  on('restore', (p, reply) => {
    const code = str(p.code, 4).toUpperCase();
    if (rooms.has(code)) return attach(rooms.get(code), p, reply);
    if (!/^[A-Z]{4}$/.test(code) || pd.rooms.has(code)) return reply({ ok: false, gone: true, error: 'That room has closed. Start a new one.' });
    if (rooms.size >= MAX_ROOMS) return reply({ ok: false, gone: true, error: 'The server is busy. Try again in a few minutes.' });
    const room = makeRoom(code);
    if (p.selected && ALL_GAMES.includes(p.selected)) room.selected = p.selected;
    if (p.settings && typeof p.settings === 'object') {
      for (const [id, G] of Object.entries(GAMES)) {
        if (p.settings[id] && typeof p.settings[id] === 'object') room.settings[id] = G.cleanSettings(p.settings[id], room.settings[id]);
      }
    }
    if (isId(p.hostPid) && p.hostPid !== p.pid) {
      // Hold the host's place for a moment so they get it back when their page reconnects.
      room.hostPid = p.hostPid;
      room.players.set(p.hostPid, { pid: p.hostPid, secret: null, name: str(p.hostName, 20) || 'Host', sockets: new Set(), joinedAt: 0, leftAt: Date.now() });
      room.hostTimer = setTimeout(safe(() => { ensureHost(room); broadcast(room); }), HOST_GRACE_MS);
    }
    console.log(`Brought back room ${code} after a restart`);
    attach(room, p, reply);
    if (!room.players.size) rooms.delete(code);
  }, { noResync: true });

  on('select', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.game || !ALL_GAMES.includes(p.game)) return reply({ ok: false });
    c.room.selected = p.game;
    reply({ ok: true });
    broadcast(c.room);
  });

  on('settings', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.game || !GAMES[p.game] || !p.patch || typeof p.patch !== 'object') return reply({ ok: false });
    c.room.settings[p.game] = GAMES[p.game].cleanSettings(p.patch, c.room.settings[p.game]);
    reply({ ok: true });
    broadcast(c.room);
  });

  on('start', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.game) return reply({ ok: false });
    const room = c.room;
    if (room.selected === 'pencils') {
      pd.prepareRoom(room.code, c.me.pid);
      room.pencils = true;
      io.to(room.code).emit('goto', { url: '/pencils-down/' + room.code });
      reply({ ok: true });
      broadcast(room);
      return;
    }
    const G = GAMES[room.selected];
    if (!G) return reply({ ok: false });
    const online = [...room.players.values()].filter(isOn).length;
    if (online < G.minPlayers) return reply({ ok: false, error: `${G.name} needs at least ${G.minPlayers} players.` });
    if (room.pencils) { pd.returnToParty(room.code); room.pencils = false; }
    room.game = G.start(gameCtx(room), room.settings[room.selected]);
    reply({ ok: true });
    broadcast(room);
  });

  // A move in the game being played.
  on('pick', (p, reply) => {
    const c = ctx();
    if (!c || !c.room.game) return reply({ ok: false }, true);
    const r = GAMES[c.room.game.id].pick(c.room.game, c.me.pid, p);
    reply(r);
  }, { noResync: true });

  on('again', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || !c.room.game || c.room.game.phase !== 'final') return reply({ ok: false });
    const id = c.room.game.id;
    endGame(c.room);
    c.room.game = GAMES[id].start(gameCtx(c.room), c.room.settings[id]);
    reply({ ok: true });
    broadcast(c.room);
  });

  on('toRoom', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost) return reply({ ok: false });
    endGame(c.room);
    if (c.room.pencils) { pd.returnToParty(c.room.code); c.room.pencils = false; }
    reply({ ok: true });
    broadcast(c.room);
  });

  on('emote', (p, reply) => {
    const c = ctx();
    const t = Date.now();
    if (!c || !EMOTES.some(e => e.id === p.id) || t - socket.data.emoteAt < EMOTE_GAP_MS) return reply({ ok: false });
    socket.data.emoteAt = t;
    io.to(c.room.code).emit('emote', { pid: c.me.pid, id: p.id });
    reply({ ok: true });
  }, { noResync: true });

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
    removePlayer(c.room, c.me.pid);
    broadcast(c.room);
    reply({ ok: true });
  }, { noResync: true });

  socket.on('disconnect', safe(() => detachSocket(socket)));
});

/* ---------- housekeeping ---------- */
setInterval(safe(() => {
  const t = Date.now();
  for (const room of rooms.values()) {
    const anyone = [...room.players.values()].some(isOn);
    if (!anyone && t - room.lastActive > ROOM_IDLE_MS) {
      endGame(room); clearTimeout(room.hostTimer);
      rooms.delete(room.code);
      continue;
    }
    // While a Pencils Down game is open everyone is on its page, so keep their places.
    if (room.game || room.pencils) continue;
    let changed = false;
    for (const p of [...room.players.values()]) {
      if (!isOn(p) && p.leftAt && t - p.leftAt > DROP_MS) { room.players.delete(p.pid); changed = true; }
    }
    if (changed) { ensureHost(room); broadcast(room); }
  }
}), 30 * 1000).unref();

// Log anything unexpected and keep running, so one error never wipes every game.
process.on('uncaughtException', e => console.error('Unexpected error (server kept running):', e));
process.on('unhandledRejection', e => console.error('Unexpected promise error:', e));

// If the server can't start at all (for example the port is taken), stop so the host can restart it.
server.on('error', e => { console.error('Could not start the server:', e); process.exit(1); });
server.listen(PORT, () => console.log(`Party games are running on port ${PORT}`));
