'use strict';
/*
 * Party games server.
 *
 * Friends meet in a party room (public/index.html), send emotes, and the host picks a game:
 *  - Games that run inside the room live in games/ and plug in through GAMES below
 *    (The Fifth Element, Black, White & Eleven, Spellbound Mayhem, The Triple Seven, Countercurrent,
 *    The Ember Crown, The Turning Tide, Signal Salvage, Starlight Signal).
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
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const pencilsDownServer = require('./games/pencils-down');
const fifth = require('./games/fifth-element');
const bw11 = require('./games/black-white-eleven');
const spell = require('./games/spellbound');
const t7 = require('./games/triple-seven');
const ember = require('./games/ember-crown');
const cc = require('./games/countercurrent');
const tide = require('./games/turning-tide');
const ss = require('./games/signal-salvage');
const sl = require('./games/starlight-signal');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

const GAMES = { fifth, bw11, spell, t7, ember, cc, tide, ss, sl };                       // games played inside the room
const ALL_GAMES = ['pencils', 'fifth', 'bw11', 'spell', 't7', 'ember', 'cc', 'tide', 'ss', 'sl']; // everything the host can pick
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
const MAX_PLAYERS = 20;
const MAX_ROOMS = 500;
const DROP_MS = 2 * 60 * 1000;            // forget players who left the room more than 2 minutes ago
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;  // forget rooms nobody has been in for 3 hours
const HOST_GRACE_MS = 15 * 1000;          // give a disconnected host 15s to come back
const EMOTE_GAP_MS = 600;                 // one emote per player this often
const MAX_BOTS = 8;
const BOT_NAMES = ['Ada', 'Bolt', 'Cog', 'Dot', 'Echo', 'Fizz', 'Gizmo', 'Hex', 'Iris', 'Jinx', 'Kilo', 'Luma'];

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
/* Pictures in a folder, by name without the extension (The Ember Crown, Countercurrent, The Turning Tide, Signal Salvage and Starlight Signal). */
function loadArt(dir, urlBase) {
  const out = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^([a-z0-9-]+)\.(webp|png|jpe?g|svg|gif)$/i);
      if (m && !out[m[1].toLowerCase()]) out[m[1].toLowerCase()] = urlBase + f;
    }
  } catch (e) { /* no art yet */ }
  return out;
}
const CATALOG = {
  emotes: EMOTES,
  fifth: { themes: fifth.THEMES, deckSizes: fifth.DECK_SIZES },
  bw11: { colors: bw11.COLORS, sounds: loadSounds(path.join(PUBLIC, 'games', 'bw11', 'sounds'), '/games/bw11/sounds/') },
  ember: {
    art: loadArt(path.join(PUBLIC, 'games', 'ember-crown', 'art'), '/games/ember-crown/art/'),
    sounds: loadSounds(path.join(PUBLIC, 'games', 'ember-crown', 'sounds'), '/games/ember-crown/sounds/')
  },
  cc: { art: loadArt(path.join(PUBLIC, 'games', 'countercurrent', 'art'), '/games/countercurrent/art/') },
  tide: {
    art: loadArt(path.join(PUBLIC, 'games', 'tide', 'art'), '/games/tide/art/'),
    sounds: loadSounds(path.join(PUBLIC, 'games', 'tide', 'sounds'), '/games/tide/sounds/')
  },
  ss: { emblems: ss.EMBLEMS, names: ss.NAMES, specialists: ss.SPECIALISTS, protocols: ss.PROTOCOLS, art: loadArt(path.join(PUBLIC, 'games', 'ss', 'art'), '/games/ss/art/') },
  sl: {
    flipTimes: sl.FLIP_TIMES,
    art: loadArt(path.join(PUBLIC, 'games', 'starlight', 'art'), '/games/starlight/art/'),
    sounds: loadSounds(path.join(PUBLIC, 'games', 'starlight', 'sounds'), '/games/starlight/sounds/')
  },
};

/* ---------- web server ---------- */
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/catalog.json', (req, res) => { res.set('Cache-Control', 'no-cache'); res.json(CATALOG); });
/* A QR code for a room's invite link, so friends in the same room can scan it. */
app.get(/^\/qr\/([A-Za-z]{4})\.svg$/, (req, res) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^[A-Za-z0-9.:-]{1,200}$/.test(host) || !/^https?$/.test(proto)) return res.status(400).end();
  QRCode.toString(`${proto}://${host}/${req.params[0].toUpperCase()}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#221A4D', light: '#FFFFFF' } })
    .then(svg => { res.set('Cache-Control', 'public, max-age=3600'); res.type('image/svg+xml').send(svg); })
    .catch(() => res.status(500).end());
});
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
const pd = pencilsDownServer(io, {
  codeTaken: c => rooms.has(c),
  emotes: EMOTES.map(e => e.id),
  // A Pencils Down game opened from a party room counts toward the room's scoreboard.
  onFinal: (code, winners, names) => {
    const room = rooms.get(code);
    if (room) { recordWin(room, 'pencils', winners, names); broadcast(room); }
  }
});
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = v => typeof v === 'string' && /^[a-z0-9]{8,32}$/.test(v);
const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Error:', e); } };
// Bots count as connected players; they have no page of their own.
const isOn = p => p.bot || p.sockets.size > 0;
const isHuman = p => !p.bot && p.sockets.size > 0;
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
    wins: [],            // tonight's results, for the room scoreboard
    reactions: {},       // fastest reaction per player tonight, per game: { fifth: { pid: {...} }, sl: {...} }
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
    players: orderedPlayers(room).map(p => ({ pid: p.pid, name: p.name, connected: isOn(p), color: p.color, bot: !!p.bot })),
    selected: room.selected,
    settings: room.settings,
    pencils: room.pencils,
    wins: room.wins,
    reactions: Object.entries(room.reactions).map(([game, byPid]) => ({
      game, name: GAME_NAMES[game] || game, list: Object.values(byPid).sort((a, b) => a.best - b.best)
    })),
    game: room.game ? GAMES[room.game.id].view(room.game, forPid) : null,
    serverNow: Date.now()
  };
}
const GAME_NAMES = { pencils: 'Pencils Down', fifth: 'The Fifth Element', bw11: 'Black, White & Eleven', spell: 'Spellbound Mayhem', t7: 'The Triple Seven', sl: 'Starlight Signal' };
function recordWin(room, game, winners, names) {
  room.wins.push({ game, name: GAME_NAMES[game] || game, at: Date.now(),
    winners: winners.map(pid => ({ pid, name: (names && names[pid]) || (room.players.get(pid) || {}).name || 'Someone' })) });
  if (room.wins.length > 60) room.wins.shift();
}
function broadcast(room) {
  room.lastActive = Date.now();
  // A game that just finished goes on the room scoreboard, once.
  const g = room.game;
  if (g && !g.recorded && GAMES[g.id].result) {
    const w = GAMES[g.id].result(g);
    if (w) {
      g.recorded = true;
      recordWin(room, g.id, w);
      // Speed games (The Fifth Element, Starlight Signal): keep each player's fastest reaction of the night.
      if (GAMES[g.id].reactionStats) {
        const byPid = room.reactions[g.id] || (room.reactions[g.id] = {});
        for (const r of GAMES[g.id].reactionStats(g)) {
          if (r.best == null) continue;
          const cur = byPid[r.pid];
          const name = (room.players.get(r.pid) || {}).name || 'Someone';
          if (!cur || r.best < cur.best) byPid[r.pid] = { pid: r.pid, name, best: r.best };
        }
      }
    }
  }
  for (const p of room.players.values()) {
    if (!p.sockets.size) continue;
    const st = publicState(room, p.pid);
    for (const sid of p.sockets) io.to(sid).emit('state', st);
  }
}
/* ---------- bots ----------
   A game that supports bots exports bot(game, pid). It looks at the game from that
   player's seat and returns the move to make ({ move, delay }) or null when the bot has
   nothing to do. The server waits a moment, asks again (the game may have moved on) and
   plays the move through the game's normal pick(), so bots follow exactly the same rules. */
const BOT_MS = [1100, 2400];
function driveBots(room) {
  const g = room.game;
  if (!g) return;
  const G = GAMES[g.id];
  if (!G.bot) return;
  room.botTimers = room.botTimers || {};
  for (const p of room.players.values()) {
    if (!p.bot || room.botTimers[p.pid]) continue;
    let plan = null;
    try { plan = G.bot(g, p.pid); } catch (e) { console.error(`${G.name} bot error:`, e); }
    if (!plan) continue;
    const delay = plan.delay != null ? plan.delay : BOT_MS[0] + crypto.randomInt(BOT_MS[1] - BOT_MS[0]);
    room.botTimers[p.pid] = setTimeout(safe(() => botAct(room, g, p.pid, 0)), delay);
  }
}
function botAct(room, g, pid, tries) {
  delete room.botTimers[pid];
  if (room.game !== g || !room.players.has(pid)) return;
  const G = GAMES[g.id];
  let plan = null;
  try { plan = G.bot(g, pid); } catch (e) { console.error(`${G.name} bot error:`, e); }
  if (plan) {
    const r = G.pick(g, pid, plan.move);
    if (r && r.ok === false) {
      // Shouldn't happen; try a couple more times, then leave it to the next change in the game.
      if (tries < 3) room.botTimers[pid] = setTimeout(safe(() => botAct(room, g, pid, tries + 1)), 800);
      if (tries === 0) console.error(`${G.name} bot move refused:`, JSON.stringify(plan.move), r.error || '');
      return;
    }
  }
  driveBots(room);
}
function stopBots(room) {
  for (const t of Object.values(room.botTimers || {})) clearTimeout(t);
  room.botTimers = {};
}
function addBot(room) {
  const used = new Set([...room.players.values()].map(p => p.name));
  const name = BOT_NAMES.map(n => 'Bot ' + n).find(n => !used.has(n)) || 'Bot ' + (room.players.size + 1);
  let pid;
  do { pid = 'bot' + crypto.randomBytes(6).toString('hex'); } while (room.players.has(pid));
  room.players.set(pid, { pid, secret: null, name, bot: true, sockets: new Set(), joinedAt: Date.now(), leftAt: 0 });
}

function gameCtx(room) {
  return {
    broadcast: () => { broadcast(room); driveBots(room); },
    fx: data => io.to(room.code).emit('fx', data),
    playerIds: () => [...room.players.keys()],
    onlineIds: () => [...room.players.values()].filter(isOn).map(p => p.pid)
  };
}
function endGame(room) {
  stopBots(room);
  if (room.game) { GAMES[room.game.id].stop(room.game); room.game = null; }
}

function ensureHost(room) {
  const host = room.players.get(room.hostPid);
  if (host && isHuman(host)) return;
  const next = orderedPlayers(room).find(isHuman);
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
    if (pl && pl.bot) return reply({ ok: false, error: 'Reload the page and try again.' });
    if (pl && pl.secret && pl.secret !== secret) return reply({ ok: false, error: 'Reload the page and try again.' });
    if (!pl) {
      if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: `This room is full. ${MAX_PLAYERS} players is the limit.` });
      pl = { pid, secret, name, sockets: new Set(), joinedAt: Date.now(), leftAt: 0 };
      room.players.set(pid, pl);
    }
    if (!pl.secret) pl.secret = secret;
    if (socket.data.code && (socket.data.code !== room.code || socket.data.pid !== pid)) detachSocket(socket);
    pl.name = name;
    if (Number.isInteger(p.color) && p.color >= 0 && p.color < 12) pl.color = p.color;
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
    // The host's settings from last time, remembered by their browser.
    if (p.prefs && typeof p.prefs === 'object') {
      if (ALL_GAMES.includes(p.prefs.selected)) room.selected = p.prefs.selected;
      const ps = p.prefs.settings;
      if (ps && typeof ps === 'object') for (const [id, G] of Object.entries(GAMES)) {
        if (ps[id] && typeof ps[id] === 'object') { try { room.settings[id] = G.cleanSettings(ps[id], room.settings[id]); } catch (e) { /* keep defaults */ } }
      }
    }
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
      pd.prepareRoom(room.code, c.me.pid, [...room.players.values()].filter(x => x.bot).map(x => ({ pid: x.pid, name: x.name })));
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
    const why = G.canStart && G.canStart(room.settings[room.selected], online);
    if (why) return reply({ ok: false, error: why });
    if (room.pencils) { pd.returnToParty(room.code); room.pencils = false; }
    room.game = G.start(gameCtx(room), room.settings[room.selected]);
    reply({ ok: true });
    broadcast(room);
    driveBots(room);
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
    if (!c || !c.isHost || !c.room.game || !['final', 'over'].includes(c.room.game.phase)) return reply({ ok: false });
    const id = c.room.game.id;
    endGame(c.room);
    c.room.game = GAMES[id].start(gameCtx(c.room), c.room.settings[id]);
    reply({ ok: true });
    broadcast(c.room);
    driveBots(c.room);
  });

  // The host ends the game being played now and shows its final result (games that support it).
  on('endNow', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || !c.room.game || !GAMES[c.room.game.id].endNow) return reply({ ok: false });
    GAMES[c.room.game.id].endNow(c.room.game);
    reply({ ok: true });
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

  on('addBot', (p, reply) => {
    const c = ctx();
    if (!c || !c.isHost || c.room.game) return reply({ ok: false });
    const bots = [...c.room.players.values()].filter(x => x.bot).length;
    if (bots >= MAX_BOTS) return reply({ ok: false, error: `${MAX_BOTS} bots is the limit.` });
    if (c.room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: 'The room is full.' });
    addBot(c.room);
    reply({ ok: true });
    broadcast(c.room);
  });

  // The host hands the host role to someone else in the room.
  on('makeHost', (p, reply) => {
    const c = ctx();
    const target = c && c.room.players.get(p.pid);
    if (!c || !c.isHost || !target || target.pid === c.me.pid || !isHuman(target)) return reply({ ok: false });
    c.room.hostPid = target.pid;
    clearTimeout(c.room.hostTimer);
    reply({ ok: true });
    broadcast(c.room);
  });

  // Change your own name or avatar color.
  on('profile', (p, reply) => {
    const c = ctx();
    if (!c) return reply({ ok: false });
    if (p.name !== undefined) {
      const name = str(p.name, 20);
      if (!name) return reply({ ok: false, error: 'Type a name first.' });
      c.me.name = name;
    }
    if (p.color !== undefined) c.me.color = Number.isInteger(p.color) && p.color >= 0 && p.color < 12 ? p.color : undefined;
    reply({ ok: true });
    broadcast(c.room);
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
    const anyone = [...room.players.values()].some(isHuman);
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
